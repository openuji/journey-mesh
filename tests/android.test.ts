import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DOMParser } from "@xmldom/xmldom";
import { select } from "xpath";
import { parse as parseYaml } from "yaml";
import { toPlaywrightObservationLocator } from "@openuji/journey-adapter-playwright";
import {
  appiumAdapter, appiumAdapterName, appiumCommandForModality, appiumLocatorQuery,
  appiumObservationQuery, touchTapInputModalityId, xpathLiteral,
  type AppiumJourneyDriver, type AppiumSession
} from "@openuji/journey-adapter-appium";
import { nextcloudAndroidDriver } from "@openuji/journey-driver-nextcloud-android";
import { normalizedBaseURL as legacyBaseURL } from "@openuji/journey-driver-nextcloud";
import { normalizedBaseURL } from "@openuji/journey-driver-nextcloud/service";
import { compileUjgJourneyPlan } from "@openuji/journey-model-ujg";
import {
  androidAccessibilityObserver, buildAndroidAccessibilityReport, checkAndroidHierarchy, loadAndroidReportResources,
  parseAndroidHierarchy, redactAndroidHierarchy, renderAndroidAccessibilityReport,
  type AndroidArtifactWriter
} from "@openuji/journey-observer-android-accessibility";
import { defaultProfile, inputModalityProfile, keyboardOnlyProfile, touchpointProfile } from "@openuji/journey-profiles";
import {
  reportJourneyResult, runJourney, touchpointAdapter, type JourneyAdapter,
  type JourneyExecutionDescriptor, type JourneyPlan, type JourneyPlanOperation,
  type ResolvedAccessibleLocator, type StatePlanOperation, type TransitionPlanOperation
} from "@openuji/journey-runner";
import { nextcloudEnvironment } from "./nextcloud-environment.js";

const androidUrl = new URL("../examples/nextcloud-filesharing/ujg/filesharing.android.ujg.jsonld", import.meta.url);
const androidPlan = await compileUjgJourneyPlan(androidUrl);
const state = androidPlan.operations.find((operation): operation is StatePlanOperation => operation.kind === "state" && operation.state.id === "urn:state:bob-incoming-share-visible")!;
const transition = androidPlan.operations.find((operation): operation is TransitionPlanOperation => operation.kind === "transition" && operation.transition.id === "urn:transition:bob-accepts-share")!;
const touch = () => inputModalityProfile({ id: "touch", modalityPreference: [touchTapInputModalityId] });
const planWith = (...operations: JourneyPlanOperation[]): JourneyPlan => ({ id: "native-test", operations });
const goodXml = '<hierarchy><android.widget.Button class="android.widget.Button" text="Accept" enabled="true" displayed="true" clickable="true" bounds="[0,0][96,96]"/></hierarchy>';
const badXml = '<hierarchy><node class="android.widget.Button" text="" enabled="true" visible-to-user="true" clickable="true" bounds="[0,0][40,40]"/></hierarchy>';

class NativeSession implements AppiumSession {
  readonly id = "native-session";
  readonly calls: string[] = [];
  xml = goodXml;
  matches = async (_query: string): Promise<readonly { elementId: string }[]> => [{ elementId: "target" }];
  screenshotError = false;
  closeError = false;
  async findElements(query: string) { this.calls.push("find"); return this.matches(query); }
  async tap(_id: string) { this.calls.push("tap"); }
  async setValue(_id: string, _value: string) { this.calls.push("type"); }
  async source() { this.calls.push("source"); return this.xml; }
  async screenshot() {
    this.calls.push("screenshot");
    if (this.screenshotError) throw new Error("Screenshot unavailable");
    return "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=";
  }
  async deviceMetrics() { return { densityDpi: 320 }; }
  async execute(_command: string, _args: Readonly<Record<string, unknown>>) { return undefined; }
  async close() { this.calls.push("close"); if (this.closeError) throw new Error("Session close failed"); }
}

function driver(options: { calls?: string[]; failStart?: boolean; failClose?: boolean; sessions?: number } = {}): AppiumJourneyDriver {
  return { name: "native-test-driver", createExecution({ context }) {
    let session: AppiumSession;
    return {
      async start() {
        for (let i = 0; i < (options.sessions ?? 1); i++) session = await context.createSession({ capabilities: {} });
        if (options.failStart) throw new Error("Driver startup failed");
      },
      openEntry() { options.calls?.push("entry"); },
      sessionForOperation() { options.calls?.push("session"); return session; },
      afterTransition() { options.calls?.push("after"); },
      recordControlFlow() { options.calls?.push("control"); },
      close() { options.calls?.push("driver-close"); if (options.failClose) throw new Error("Driver close failed"); }
    };
  } };
}
function memoryWriter() {
  const artifacts = new Map<string, string | Uint8Array>();
  const write: AndroidArtifactWriter = async ({ name, data }) => {
    artifacts.set(name, data);
    return { path: `/artifacts/${name}`, href: name };
  };
  return { artifacts, write, async read(artifact: { path: string }) {
    const data = artifacts.get(artifact.path.slice("/artifacts/".length));
    if (data === undefined) throw new Error(`Missing artifact ${artifact.path}`);
    return data;
  } };
}
function descriptor(plan: JourneyPlan, runId = "native-run"): JourneyExecutionDescriptor {
  return { runId, executionId: "touch-01", profile: { id: "touch" }, plan };
}
function neutralAdapter(name = appiumAdapterName, fail?: string): JourneyAdapter {
  return { name, createExecution: () => ({
    start() {}, openEntry() {}, assertState(operation) { if (operation.id === fail) throw new Error("Functional failure"); },
    performTransition() {}, recordControlFlow() {}, close() {}
  }) };
}
async function functionalResult(plan: JourneyPlan, runId = "native-run") {
  return runJourney({ plan, runId, profiles: [touch()], adapter: neutralAdapter() });
}

test("Android model preserves Alice and domain effects and declares native UI actions explicitly", async () => {
  const web = await compileUjgJourneyPlan(new URL("../examples/nextcloud-filesharing/ujg/filesharing.ujg.jsonld", import.meta.url));
  const alice = (plan: JourneyPlan) => plan.operations.filter((operation) => operation.actorId === "urn:user:alice").map(({ id: _id, ...operation }) => operation);
  assert.deepEqual(alice(androidPlan), alice(web));
  assert.notEqual(androidPlan.id, web.id);
  const bob = androidPlan.operations.filter((operation) => operation.actorId === "urn:user:bob");
  assert.ok(bob.some((operation) => operation.kind === "transition" && operation.transition.id === "urn:transition:bob-returns-to-files"));
  assert.ok(bob.some((operation) => operation.kind === "transition" && operation.transition.id === "urn:transition:bob-opens-shares-navigation"));
  assert.ok(bob.some((operation) => operation.entryBinding?.value === "nextcloud.android.notifications"));
  for (const operation of bob) {
    if (operation.kind === "state") assert.doesNotThrow(() => appiumObservationQuery(operation.target.bindings));
    if (operation.kind === "transition") {
      assert.doesNotThrow(() => appiumObservationQuery(operation.activation.bindings));
      assert.equal((await touch().selectInputModality!(operation, {} as never)).modality.id, touchTapInputModalityId);
    }
  }
  const effects = (plan: JourneyPlan) => plan.operations.flatMap((operation) => operation.kind === "transition" ? operation.effects : []);
  assert.deepEqual(effects(androidPlan), effects(web));
  const author = parseYaml(await readFile(new URL("../examples/nextcloud-filesharing/ujg/filesharing.android.ujg.yaml", import.meta.url), "utf8"));
  const document = JSON.parse(await readFile(androidUrl, "utf8"));
  assert.equal(author.ujgTarget, "1.0-rc1");
  for (const [id, value] of Object.entries(author.accessible.locators)) {
    const { "@id": _id, "@type": _type, ...locator } = document.nodes.find((node: { "@id": string }) => node["@id"] === id);
    assert.deepEqual(locator, value);
  }
});

test("native query compilation is pure, escapes names, and rejects unsupported semantics", () => {
  const locator: ResolvedAccessibleLocator = { id: "target", role: "button", accessibleName: `Alice's "Accept"`, features: [], contexts: [] };
  const before = structuredClone(locator);
  assert.equal(appiumLocatorQuery(locator), appiumLocatorQuery(locator));
  assert.ok(appiumLocatorQuery(locator).includes("concat("));
  assert.deepEqual(locator, before);
  assert.equal(xpathLiteral("Accept"), "'Accept'");
  assert.throws(() => appiumLocatorQuery({ ...locator, role: "web-dialog" }), /does not support role/);
  assert.throws(() => appiumLocatorQuery({ ...locator, accessibleDescription: "hint" }), /accessibleDescription/);
  assert.throws(() => appiumLocatorQuery({ ...locator, features: [{ id: "feature", name: "css", value: "selector" }] }), /AccessibleFeature css/);
  assert.throws(() => appiumObservationQuery([]), /ObservationBinding/);
  assert.throws(() => appiumObservationQuery([{ ...state.target.bindings[0]!, surfaceInstanceResolver: {
    id: "unsupported-resolver", instanceKeyFeature: { id: "key", name: "instance-key", value: "concrete" }
  } }]), /SurfaceInstanceResolver/);
  assert.throws(() => appiumObservationQuery([{ ...state.target.bindings[0]!, locators: [] }]), /must define a locator/);
  assert.equal(appiumCommandForModality(touchTapInputModalityId), "tap");
  assert.throws(() => appiumCommandForModality("observability:pointer"), /does not support input modality/);
});

test("native XPath queries match the captured controls and absence states", async () => {
  const captures = await Promise.all(["pending-offer", "accepted-offer", "shared-file", "navigation-sidebar"].map(async (name) =>
    new DOMParser().parseFromString(await readFile(new URL(`../examples/nextcloud-filesharing/android/fixtures/${name}.xml`, import.meta.url), "utf8"), "application/xml")));
  const count = (query: string, document: (typeof captures)[number]) => {
    const selected = select(query, document as unknown as Node);
    assert.ok(Array.isArray(selected));
    return selected.length;
  };
  const bindings = (id: string) => {
    const operation = androidPlan.operations.find((operation) => operation.kind === "state" ? operation.state.id === id : operation.transition.id === id)!;
    assert.ok(operation.kind !== "control-flow");
    return operation.kind === "state" ? operation.target.bindings : operation.activation.bindings;
  };
  const pendingQuery = appiumObservationQuery(state.target.bindings);
  assert.equal(count(pendingQuery, captures[0]!), 1);
  assert.equal(count(pendingQuery, captures[1]!), 0);
  assert.equal(count(appiumObservationQuery(transition.activation.bindings), captures[0]!), 1);
  assert.equal(count(appiumObservationQuery(bindings("urn:transition:bob-returns-to-files")), captures[1]!), 1);
  assert.equal(count(appiumObservationQuery(bindings("urn:transition:bob-opens-shares-navigation")), captures[2]!), 1);
  assert.equal(count(appiumObservationQuery(bindings("urn:transition:bob-opens-shares-overview")), captures[3]!), 1);
  assert.equal(count(appiumObservationQuery(bindings("urn:state:bob-shared-report-visible")), captures[2]!), 1);
});

test("native binding intersection, union, and ordered ancestor scopes use node identity", () => {
  const feature = (id: string): ResolvedAccessibleLocator => ({ id, features: [{ id, name: "resource-id", value: id }], contexts: [] });
  const name = `Alice's "Accept"`;
  const target: ResolvedAccessibleLocator = { id: "target", role: "button", accessibleName: name, features: [], contexts: [feature("outer"), feature("inner")] };
  const xml = '<hierarchy><node resource-id="outer"><node resource-id="inner"><node class="android.widget.Button" displayed="true" text="Alice&apos;s &quot;Accept&quot;" enabled="true"/></node></node><node resource-id="inner"><node resource-id="outer"><node class="android.widget.Button" displayed="true" text="Alice&apos;s &quot;Accept&quot;" enabled="false"/></node></node><node class="android.widget.Button" displayed="true" text="Other"/></hierarchy>';
  const document = new DOMParser().parseFromString(xml, "application/xml");
  const selected = (query: string) => {
    const nodes = select(query, document as unknown as Node);
    assert.ok(Array.isArray(nodes));
    return nodes;
  };
  assert.equal(selected(appiumLocatorQuery(target)).length, 1);
  const binding = { ...state.target.bindings[0]!, locators: [target, { id: "enabled", features: [{ id: "enabled", name: "enabled", value: "true" }], contexts: [] }] };
  assert.equal(selected(appiumObservationQuery([binding, binding])).length, 1);
  const other = { ...binding, id: "other", locators: [{ ...target, accessibleName: "Other", contexts: [] }] };
  assert.equal(selected(appiumObservationQuery([binding, other])).length, 2);
});

test("nested locator contexts stay inside the complete preceding scope", () => {
  const feature = (id: string): ResolvedAccessibleLocator => ({ id, features: [{ id, name: "resource-id", value: id }], contexts: [] });
  const inner = { ...feature("inner"), contexts: [feature("nested")] };
  const locator: ResolvedAccessibleLocator = { id: "target", role: "button", accessibleName: "Accept", features: [], contexts: [feature("outer"), inner] };
  const control = (id: string) => `<node class="android.widget.Button" displayed="true" text="Accept" resource-id="${id}"/>`;
  const xml = `<hierarchy>
    <node resource-id="outer"><node resource-id="nested"><node resource-id="inner">${control("correct")}</node></node></node>
    <node resource-id="nested"><node resource-id="outer"><node resource-id="inner">${control("escaped")}</node></node></node>
    <node resource-id="outer"><node resource-id="inner"><node resource-id="nested">${control("reversed")}</node></node></node>
    <node resource-id="outer"><node resource-id="nested"/><node resource-id="inner">${control("sibling")}</node></node>
  </hierarchy>`;
  const document = new DOMParser().parseFromString(xml, "application/xml");
  const binding = { ...state.target.bindings[0]!, locators: [locator] };
  for (const query of [appiumLocatorQuery(locator), appiumObservationQuery([binding])]) {
    const matched = select(query, document as unknown as Node);
    assert.ok(Array.isArray(matched));
    assert.deepEqual(matched.map((node) => (node as Element).getAttribute("resource-id")), ["correct"]);
  }
});

test("Appium deduplicates matches and enforces exact state counts", async () => {
  const session = new NativeSession();
  session.matches = async () => [{ elementId: "same" }, { elementId: "same" }];
  const adapter = appiumAdapter({ driver: driver(), sessionFactory: async () => session, assertionTimeoutMs: 0 });
  const passed = await runJourney({ plan: planWith(state), profiles: [touch()], adapter });
  assert.equal(passed.ok, true);
  session.matches = async () => [{ elementId: "one" }, { elementId: "two" }];
  const failed = await runJourney({ plan: planWith(state), profiles: [touch()], adapter });
  assert.equal(failed.ok, false);
  assert.match(failed.errors[0]!.message, /expected 1 matches, found 2/);
  assert.equal(failed.evidence.executions[0]!.operations[0]!.adapter?.name, appiumAdapterName);
  const absent = { ...state, target: { ...state.target, expectedMatchCount: 0 } };
  session.matches = async () => [];
  assert.equal((await runJourney({ plan: planWith(absent), profiles: [touch()], adapter })).ok, true);
});

test("web and native translators share unconstrained feature and resolver rules", async () => {
  const locator: ResolvedAccessibleLocator = { id: "button", role: "button", accessibleName: "Accept", features: [], contexts: [] };
  const base = { ...state.target.bindings[0]!, locators: [locator] };
  const feature = (name: string, value: string) => ({ ...base, locators: [{ ...locator, features: [{ id: name, name, value }] }] });
  const resolver = (value: string) => ({ ...base, surfaceInstanceResolver: {
    id: "resolver", instanceKeyFeature: { id: "instance", name: "instance-key", value }
  } });
  const cases = [
    { label: "no extra constraint", binding: base, accepted: true },
    { label: "wildcard native feature", binding: feature("enabled", "*"), accepted: true },
    { label: "wildcard instance feature", binding: feature("file-id", "*"), accepted: true },
    { label: "wildcard role option", binding: feature("expanded", "*"), accepted: true },
    { label: "wildcard resolver", binding: resolver("*"), accepted: true },
    { label: "concrete resolver", binding: resolver("42"), accepted: false },
    { label: "unmapped concrete feature", binding: feature("custom-feature", "value"), accepted: false }
  ];
  const document = new DOMParser().parseFromString('<hierarchy><node class="android.widget.Button" text="Accept" enabled="false" displayed="true"/></hierarchy>', "application/xml");
  for (const { label, binding, accepted } of cases) {
    const before = structuredClone(binding);
    const calls: Array<{ role: string; name?: RegExp; expanded?: boolean }> = [];
    const root = { getByRole(role: string, options: { name?: RegExp; expanded?: boolean }) {
      calls.push({ role, ...options });
      return root;
    } };
    const [web, native] = await Promise.allSettled([
      toPlaywrightObservationLocator(root as never, [binding]),
      Promise.resolve().then(() => appiumObservationQuery([binding]))
    ]);
    assert.equal(web.status, accepted ? "fulfilled" : "rejected", `${label}: web`);
    assert.equal(native.status, accepted ? "fulfilled" : "rejected", `${label}: native`);
    if (native.status === "fulfilled") {
      const matched = select(native.value, document as unknown as Node);
      assert.ok(Array.isArray(matched));
      assert.equal(matched.length, 1, label);
      assert.equal(calls[0]!.role, "button");
      assert.equal(calls[0]!.expanded, undefined);
      assert.ok(calls[0]!.name!.test("Accept"));
    }
    assert.deepEqual(binding, before);
  }
});

test("native queries count visible targets even when invisible nodes are included in the source", () => {
  const locator: ResolvedAccessibleLocator = { id: "button", role: "button", accessibleName: "Accept", features: [], contexts: [] };
  const xml = '<hierarchy><node class="android.widget.Button" text="Accept" displayed="false"/><node class="android.widget.Button" text="Accept" displayed="true" resource-id="visible"/></hierarchy>';
  const document = new DOMParser().parseFromString(xml, "application/xml");
  const matched = select(appiumLocatorQuery(locator), document as unknown as Node);
  assert.ok(Array.isArray(matched));
  assert.deepEqual(matched.map((node) => (node as Element).getAttribute("resource-id")), ["visible"]);
  const hidden = new DOMParser().parseFromString(xml.replace('displayed="true"', 'displayed="false"'), "application/xml");
  assert.deepEqual(select(appiumObservationQuery([{ ...state.target.bindings[0]!, locators: [locator] }]), hidden as unknown as Node), []);
});

test("native preflight validates only routed operations before shared fixtures or Alice's actions", async () => {
  const alice = androidPlan.operations.find((operation) => operation.actorId === "urn:user:alice")!;
  const invalid = { ...state, target: { ...state.target, bindings: state.target.bindings.map((binding) => ({
    ...binding, locators: binding.locators.map((locator) => ({ ...locator, role: "unsupported-role" }))
  })) } };
  const calls: string[] = [];
  const native = appiumAdapter({ driver: driver(), sessionFactory: async () => { calls.push("session"); return new NativeSession(); } });
  const adapter = touchpointAdapter({ [alice.touchpointId]: {
    name: "web", createExecution() { calls.push("web-create"); return neutralAdapter().createExecution({} as never); }
  }, [state.touchpointId]: native });
  const failed = await runJourney({ plan: planWith(alice, invalid), profiles: [touch()], adapter,
    environment: { setup() { calls.push("setup"); }, verifyEffect() { calls.push("effect"); } }
  });
  assert.equal(failed.ok, false);
  assert.match(failed.errors[0]!.message, /unsupported-role/);
  assert.deepEqual(calls, []);
  const valid = await runJourney({ plan: planWith(alice, state), profiles: [touch()], adapter });
  assert.equal(valid.ok, true, JSON.stringify(valid.errors));
  assert.deepEqual(calls, ["web-create", "session"]);
});

test("native preflight leaves no-input locator semantics to the driver", async () => {
  const automatic = { ...transition, activation: { ...transition.activation, requiredInputModalityProfiles: [], bindings: [] } };
  const calls: string[] = [];
  const result = await runJourney({ plan: planWith(automatic), profiles: [{ id: "automatic" }],
    adapter: appiumAdapter({ driver: driver({ calls }), sessionFactory: async () => new NativeSession() })
  });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.ok(calls.includes("after"));
});

test("unsupported modalities fail before native target resolution", async () => {
  const session = new NativeSession();
  const unsupported = { ...transition, activation: { ...transition.activation, requiredInputModalityProfiles: [{ id: "swipe", modalities: [{ id: "native:swipe" }] }] } };
  const calls: string[] = [];
  const result = await runJourney({ plan: planWith(unsupported),
    profiles: [inputModalityProfile({ id: "swipe", modalityPreference: ["native:swipe"] })],
    adapter: appiumAdapter({ driver: driver({ calls }), sessionFactory: async () => session }) });
  assert.equal(result.ok, false);
  assert.match(result.errors[0]!.message, /native:swipe/);
  assert.equal(session.calls.includes("find"), false);
  assert.equal(session.calls.includes("tap"), false);
  assert.equal(calls.includes("session"), false);
});

test("no-input transitions wait without a target or tap and verify effects afterwards", async () => {
  const session = new NativeSession();
  const automatic = { ...transition, activation: { ...transition.activation, requiredInputModalityProfiles: [] } };
  const calls: string[] = [];
  const result = await runJourney({ plan: planWith(automatic), profiles: [{ id: "automatic" }],
    adapter: appiumAdapter({ driver: driver({ calls }), sessionFactory: async () => session,
      executionObservers: [{ name: "observations", observeOperation: ({ stage }) => { calls.push(stage); } }] }),
    environment: { verifyEffect() { calls.push("effect"); } } });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ["entry", "after", "transition-completed", "effect", "driver-close"]);
  assert.deepEqual(session.calls, ["close"]);
});

test("partial startup cleanup attempts driver and every session in reverse order, once", async () => {
  const calls: string[] = [];
  const one = new NativeSession(), two = new NativeSession();
  one.close = async () => { calls.push("one"); throw new Error("First session close failed"); };
  two.close = async () => { calls.push("two"); throw new Error("Second session close failed"); };
  const sessions = [one, two];
  const adapter = appiumAdapter({ driver: driver({ failStart: true, failClose: true, sessions: 2 }), sessionFactory: async () => sessions.shift()! });
  const result = await runJourney({ plan: planWith(state), profiles: [touch()], adapter });
  assert.equal(result.ok, false);
  assert.match(result.errors[0]!.message, /Driver startup failed.*Driver close failed.*Second session close failed.*First session close failed/s);
  assert.deepEqual(calls, ["two", "one"]);
  const execution = appiumAdapter({ driver: driver(), sessionFactory: async () => one }).createExecution({ context: { ...descriptor(planWith(state)), profile: touch() } });
  await assert.rejects(async () => execution.assertState(state), /not started/);
  await execution.start();
  await assert.rejects(async () => execution.start(), /cannot start/);
  await assert.rejects(async () => execution.close({ executionFailed: true }), /First session close/);
  await execution.close({ executionFailed: true });
  assert.equal(calls.filter((call) => call === "one").length, 2);
});

test("Nextcloud Android registers sessions before login failures and leaves cleanup to Appium", async () => {
  const session = new NativeSession();
  const native = nextcloudAndroidDriver({
    touchpoints: { [state.touchpointId]: { baseURL: "http://example.test" } },
    users: { [state.actorId]: { username: "bob", password: "example" } },
    devices: { [state.touchpointId]: { capabilities: { "appium:udid": "dedicated", "appium:app": "/test/nextcloud.apk" } } },
    entries: { "nextcloud.android.notifications": () => {} },
    login: async () => { throw new Error("Native login failed"); }
  });
  const result = await runJourney({ plan: planWith(state), profiles: [touch()], adapter: appiumAdapter({ driver: native, sessionFactory: async () => session }) });
  assert.equal(result.ok, false);
  assert.match(result.errors[0]!.message, /Native login failed/);
  assert.equal(session.calls.filter((call) => call === "close").length, 1);
});

test("hierarchy checks normalize Android XML, preserve grouping, and leave unknowns unassessed", () => {
  const grouped = '<hierarchy><node class="android.view.ViewGroup" enabled="true" visible-to-user="true" clickable="true" bounds="[0,0][96,96]"><node text="Accept" visible-to-user="true" clickable="false"/></node></hierarchy>';
  assert.deepEqual(checkAndroidHierarchy(parseAndroidHierarchy(grouped), { densityDpi: 320 }).map((check) => check.status), ["passed", "passed"]);
  assert.deepEqual(checkAndroidHierarchy(parseAndroidHierarchy(badXml), { densityDpi: 320 }).map((check) => check.status), ["finding", "finding"]);
  assert.equal(checkAndroidHierarchy(parseAndroidHierarchy(goodXml), {}).find((check) => check.rule === "touch-target-size")!.status, "unassessed");
  assert.ok(checkAndroidHierarchy(parseAndroidHierarchy('<hierarchy><node clickable="true" text="Accept"/></hierarchy>'), {}).every((check) => check.status === "unassessed"));
  assert.equal(checkAndroidHierarchy(parseAndroidHierarchy(goodXml.replace('displayed="true"', 'displayed="false"')), { densityDpi: 320 }).length, 0);
  assert.throws(() => parseAndroidHierarchy("<hierarchy>"), /Invalid Android hierarchy/);
  assert.throws(() => parseAndroidHierarchy("<other/>"), /hierarchy root/);
  assert.throws(() => parseAndroidHierarchy('<!DOCTYPE hierarchy [<!ENTITY x "secret">]><hierarchy/>'), /document types/);
  const password = '<hierarchy><node password="true" text="secret" content-desc="secret"/></hierarchy>';
  assert.doesNotMatch(redactAndroidHierarchy(password), /secret/);
  assert.equal(parseAndroidHierarchy(password)[0]!.text, "[redacted]");
});

test("captured native fixtures establish the actual acceptance and mounted-file controls", async () => {
  const capture = async (name: string) => parseAndroidHierarchy(await readFile(new URL(`../examples/nextcloud-filesharing/android/fixtures/${name}.xml`, import.meta.url), "utf8"));
  const texts = (nodes: ReturnType<typeof parseAndroidHierarchy>): string[] => nodes.flatMap((node) => [node.text ?? "", ...texts(node.children)]);
  assert.ok(texts(await capture("pending-offer")).includes("Accept"));
  assert.ok(!texts(await capture("accepted-offer")).includes("Accept"));
  assert.ok(texts(await capture("shared-file")).includes("report.pdf"));
});

test("evidence and reports are detached pure snapshots and reads never seed facts", async () => {
  const writer = memoryWriter(), session = new NativeSession();
  const observer = androidAccessibilityObserver({ reportId: "native", writeArtifact: writer.write, readArtifact: writer.read, screenshots: true, now: () => "2026-11-03T00:00:00Z" });
  const operation = structuredClone(state), plan = planWith(operation);
  const started = observer.evidence;
  await observer.onExecutionStarted!({ execution: descriptor(plan) });
  const initialLabel = operation.state.label;
  session.source = async () => { operation.state.label = "Changed during I/O"; return goodXml; };
  await observer.observeOperation!({ execution: descriptor(plan), stage: "state-asserted", operation, session, targets: [{ elementId: "target" }], expectedMatchCount: 1 });
  const facts = observer.evidence;
  assert.equal(started.length, 0);
  assert.equal(facts.length, 2);
  assert.strictEqual(observer.evidence, facts);
  const captured = facts[1]!;
  assert.equal(captured.kind, "operation-observed");
  if (captured.kind === "operation-observed" && captured.evidence.operation.kind === "state") assert.equal(captured.evidence.operation.state.label, initialLabel);
  assert.ok(Object.isFrozen(facts));
  assert.equal(Reflect.set(captured, "changed", true), false);
  const result = await functionalResult(plan);
  const input = { reportId: "native", createdAt: "2026-11-03T00:00:00Z", result, evidence: facts, strict: false };
  const first = buildAndroidAccessibilityReport(input);
  assert.deepEqual(buildAndroidAccessibilityReport(input), first);
  const resources = await loadAndroidReportResources(first, writer.read);
  const beforeResources = structuredClone(resources);
  assert.ok(Object.isFrozen(resources));
  assert.equal(renderAndroidAccessibilityReport(first, resources), renderAndroidAccessibilityReport(first, resources));
  assert.deepEqual(resources, beforeResources);
  assert.strictEqual(observer.evidence, facts);
  assert.equal(observer.latestReport, undefined);
  const attributed = (name?: string) => ({ ...result, evidence: { executions: result.evidence.executions.map((execution) => ({
    ...execution, operations: execution.operations.map(({ adapter: _adapter, ...operation }) => ({ ...operation, ...(name ? { adapter: { name } } : {}) }))
  })) } });
  assert.equal(buildAndroidAccessibilityReport({ ...input, result: attributed("foreign-adapter") }).items[0]!.status, "checked");
  const unobserved = facts.filter((fact) => fact.kind === "execution-started");
  const legacy = buildAndroidAccessibilityReport({ ...input, result: attributed(), evidence: unobserved });
  assert.equal(legacy.items[0]!.status, "skipped");
  assert.equal(legacy.items[0]!.outcome?.kind, "passed");
  await reportJourneyResult({ result, reporters: [observer] });
  assert.ok(observer.latestReportPath);
  assert.ok(Object.isFrozen(observer.latestReport!.items));
  assert.strictEqual(observer.evidence, facts);
});

test("native capture failures retain hierarchy and screenshot facts before failing the operation", async () => {
  for (const failure of ["screenshot", "hierarchy"] as const) {
    const session = new NativeSession();
    if (failure === "screenshot") session.screenshotError = true; else session.xml = "<broken>";
    const writer = memoryWriter();
    const observer = androidAccessibilityObserver({ reportId: "failure", writeArtifact: writer.write, readArtifact: writer.read, screenshots: true });
    const result = await runJourney({ plan: planWith(state), profiles: [touch()], adapter: appiumAdapter({ driver: driver(), sessionFactory: async () => session, executionObservers: [observer] }) });
    assert.equal(result.ok, false);
    assert.match(result.errors[0]!.message, /evidence collection failed/);
    const fact = observer.evidence[1]!;
    assert.equal(fact.kind, "operation-observed");
    if (fact.kind === "operation-observed") {
      assert.equal(fact.evidence.hierarchy?.kind, failure === "hierarchy" ? "failed" : "captured");
      assert.equal(fact.evidence.screenshot?.kind, failure === "screenshot" ? "failed" : "captured");
    }
    const reporting = await reportJourneyResult({ result, reporters: [observer] });
    assert.equal(reporting.errors.length, 0);
    assert.equal(observer.latestReport!.items[0]!.status, "error");
    assert.equal(observer.latestReport!.items[0]!.outcome?.kind, "failed");
    assert.equal(session.calls.at(-1), "close");
  }
});

test("strict findings use all scans, isolate runs, and publish artifacts before reporting failure", async () => {
  const writer = memoryWriter(), session = new NativeSession();
  const observer = androidAccessibilityObserver({ reportId: "strict", writeArtifact: writer.write, readArtifact: writer.read, strict: true });
  const plan = planWith(state), execution = descriptor(plan);
  await observer.onExecutionStarted!({ execution });
  session.xml = badXml;
  await observer.observeOperation!({ execution, operation: state, stage: "state-asserted", expectedMatchCount: 1, targets: [], session });
  session.xml = goodXml;
  await observer.observeOperation!({ execution, operation: state, stage: "state-asserted", expectedMatchCount: 1, targets: [], session });
  const result = await functionalResult(plan);
  const reporting = await reportJourneyResult({ result, reporters: [observer] });
  assert.equal(result.ok, true);
  assert.equal(reporting.errors.length, 1);
  assert.match(reporting.errors[0]!.message, /2 potential/);
  assert.equal(observer.latestReport!.summary.findings, 0);
  assert.ok([...writer.artifacts.keys()].some((name) => name.endsWith(".html")));
  assert.ok(observer.latestEvidencePath);
  const next = descriptor(plan, "second-run");
  await observer.onExecutionStarted!({ execution: next });
  await observer.observeOperation!({ execution: next, operation: state, stage: "state-asserted", expectedMatchCount: 1, targets: [], session });
  const second = await reportJourneyResult({ result: await functionalResult(plan, "second-run"), reporters: [observer] });
  assert.equal(second.errors.length, 0);
  assert.equal(observer.latestReport!.items.length, 1);
  assert.equal(observer.latestReport!.runId, "second-run");
});

test("artifact failure preserves the last fully published native bundle", async () => {
  const writer = memoryWriter();
  let failHtml = false;
  const observer = androidAccessibilityObserver({ reportId: "atomic", writeArtifact: async (input) => {
    if (failHtml && input.name.endsWith(".html")) throw new Error("Artifact write failed");
    return writer.write(input);
  } });
  const plan = planWith(state), execution = descriptor(plan);
  await observer.onExecutionStarted!({ execution });
  const result = await functionalResult(plan);
  assert.equal((await reportJourneyResult({ result, reporters: [observer] })).errors.length, 0);
  const previous = observer.latestReport;
  failHtml = true;
  assert.equal((await reportJourneyResult({ result, reporters: [observer] })).errors.length, 1);
  assert.strictEqual(observer.latestReport, previous);
});

test("native HTML retains its evidence after attachment copies are renamed and originals removed", async () => {
  const directory = await mkdtemp(join(tmpdir(), "journey-native-report-"));
  const original = join(directory, "original");
  const copies = [join(directory, "attachments", "renamed-attachment.html"), join(directory, "html-report", "data", "renamed-report.html")];
  await mkdir(original);
  for (const copy of copies) await mkdir(join(copy, ".."), { recursive: true });
  const session = new NativeSession();
  // XML must be shown as text, including content that resembles active HTML.
  session.xml = goodXml.replace('text="Accept"', 'text="&lt;script&gt;unsafe&lt;/script&gt;"');
  const observer = androidAccessibilityObserver({ reportId: "portable", screenshots: true,
    async writeArtifact({ name, data, contentType }) {
      const path = join(original, name);
      await writeFile(path, data);
      if (contentType === "text/html") for (const copy of copies) await copyFile(path, copy);
      return { path, href: name };
    }
  });
  try {
    const plan = planWith(...Array.from({ length: 18 }, (_, index) => ({ ...state, id: `portable-state-${index}` })));
    const execution = descriptor(plan);
    await observer.onExecutionStarted!({ execution });
    for (const operation of plan.operations) {
      assert.ok(operation.kind === "state");
      await observer.observeOperation!({ execution, operation, stage: "state-asserted", expectedMatchCount: 1, targets: [], session });
    }
    const facts = observer.evidence;
    const outcome = await reportJourneyResult({ result: await functionalResult(plan), reporters: [observer] });
    assert.deepEqual(outcome.errors, []);
    await rm(original, { recursive: true });
    for (const copy of copies) {
      const document = new DOMParser().parseFromString(await readFile(copy, "utf8"), "text/html");
      const links = [...document.getElementsByTagName("a")];
      assert.equal(links.length, 36);
      for (const link of links) {
        const href = link.getAttribute("href")!;
        assert.ok(href.startsWith("#"), `External dependency in copied HTML: ${href}`);
        assert.ok(document.getElementById(href.slice(1)));
      }
      const hierarchies = [...document.getElementsByTagName("pre")];
      assert.equal(hierarchies.length, 18);
      assert.ok(hierarchies.every((hierarchy) => hierarchy.textContent === session.xml));
      assert.equal(document.getElementsByTagName("script").length, 0);
      const images = [...document.getElementsByTagName("img")];
      assert.equal(images.length, 18);
      const expectedImage = `data:image/png;base64,${await session.screenshot()}`;
      assert.ok(images.every((image) => image.getAttribute("src") === expectedImage));
    }
    assert.strictEqual(observer.evidence, facts);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("unreadable evidence fails reporting before publishing a native HTML bundle", async () => {
  const writer = memoryWriter(), session = new NativeSession();
  const observer = androidAccessibilityObserver({ reportId: "missing-evidence", writeArtifact: writer.write,
    readArtifact: async () => { throw new Error("Evidence file missing"); }
  });
  const plan = planWith(state), execution = descriptor(plan);
  await observer.onExecutionStarted!({ execution });
  await observer.observeOperation!({ execution, operation: state, stage: "state-asserted", expectedMatchCount: 1, targets: [], session });
  const facts = observer.evidence;
  const result = await functionalResult(plan);
  const reporting = await reportJourneyResult({ result, reporters: [observer] });
  assert.equal(result.ok, true);
  assert.match(reporting.errors[0]!.message, /Evidence file missing/);
  assert.equal(observer.latestReport, undefined);
  assert.ok(![...writer.artifacts.keys()].some((name) => name.endsWith(".html")));
  assert.strictEqual(observer.evidence, facts);
});

test("mixed native reports distinguish foreign attempts, native failures, and unreached operations", async () => {
  const webState = { ...state, id: "web-state", touchpointId: "web" };
  const nativeAfter = { ...state, id: "native-after" };
  for (const failing of ["web", "native"] as const) {
    const session = new NativeSession();
    if (failing === "native") session.matches = async () => [];
    const writer = memoryWriter();
    const observer = androidAccessibilityObserver({ reportId: "mixed-failure", writeArtifact: writer.write, readArtifact: writer.read });
    const result = await runJourney({ plan: planWith(webState, state, nativeAfter), profiles: [touch()], adapter: touchpointAdapter({
      web: neutralAdapter("web-test-adapter", failing === "web" ? webState.id : undefined),
      [state.touchpointId]: appiumAdapter({ driver: driver(), sessionFactory: async () => session, assertionTimeoutMs: 0, executionObservers: [observer] })
    }) });
    await reportJourneyResult({ result, reporters: [observer] });
    assert.equal(result.ok, false);
    assert.equal(observer.latestReport!.items[0]!.status, "not-applicable");
    assert.match(observer.latestReport!.items[0]!.reason!, /web-test-adapter/);
    assert.equal(observer.latestReport!.items[0]!.outcome?.kind, failing === "web" ? "failed" : "passed");
    assert.equal(observer.latestReport!.items[1]!.status, "skipped");
    assert.equal(observer.latestReport!.items[2]!.status, "skipped");
    assert.equal(observer.latestReport!.items[2]!.outcome, undefined);
  }
});

test("mixed profiles isolate native sessions and run shared setup/effects/cleanup once each", async () => {
  const sessions: NativeSession[] = [], calls: string[] = [];
  const native = appiumAdapter({ driver: driver(), sessionFactory: async () => {
    const session = new NativeSession();
    let accepted = false;
    session.tap = async () => { accepted = true; };
    session.matches = async (query) => query.includes("notification-subject") || query.includes("id/subject") ? accepted ? [] : [{ elementId: "subject" }] : [{ elementId: "target" }];
    sessions.push(session);
    return session;
  } });
  const profiles = [defaultProfile(), keyboardOnlyProfile()].map((web) => touchpointProfile({ id: `${web.id}-web-touch-android`, profiles: { "urn:touchpoint:nextcloud-a": web, "urn:touchpoint:nextcloud-b": touch() } }));
  const result = await runJourney({ plan: androidPlan, profiles,
    adapter: touchpointAdapter({ "urn:touchpoint:nextcloud-a": neutralAdapter("web-test-adapter"), "urn:touchpoint:nextcloud-b": native }),
    environment: {
      setup: (context) => { calls.push(`${context.profile.id}:setup`); },
      verifyEffect: ({ context, effect }) => { calls.push(`${context.profile.id}:${effect.id}`); },
      teardown: ({ context, executionFailed }) => { assert.equal(executionFailed, false); calls.push(`${context.profile.id}:cleanup`); }
    }
  });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(sessions.length, 2);
  assert.notStrictEqual(sessions[0], sessions[1]);
  assert.ok(sessions.every((session) => session.calls.filter((call) => call === "close").length === 1));
  assert.deepEqual(calls, profiles.flatMap((profile) => [`${profile.id}:setup`, `${profile.id}:urn:effect:alice-confirm-share`, `${profile.id}:urn:effect:bob-accept-share`, `${profile.id}:cleanup`]));
  const bobOperations = new Set(androidPlan.operations.filter((operation) => operation.actorId === "urn:user:bob").map((operation) => operation.id));
  assert.ok(result.evidence.executions.every((execution) => execution.operations.filter((operation) => bobOperations.has(operation.operationId)).every((operation) => operation.adapter?.name === appiumAdapterName)));
});

test("service helpers preserve legacy exports without importing browser code", async () => {
  assert.strictEqual(legacyBaseURL, normalizedBaseURL);
  assert.equal(normalizedBaseURL({ baseURL: "http://example.test/" }).href, "http://example.test/");
  const service = await readFile(new URL("../packages/journey-driver-nextcloud/src/service.ts", import.meta.url), "utf8");
  assert.doesNotMatch(service, /playwright|journey-adapter/);
});

test("shared cleanup declines pending offers at their pending endpoint", async () => {
  const originalFetch = globalThis.fetch;
  const preserve = process.env.NEXTCLOUD_PRESERVE_FIXTURES;
  delete process.env.NEXTCLOUD_PRESERVE_FIXTURES;
  const deleted: string[] = [];
  globalThis.fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (init?.method === "DELETE") { deleted.push(path); return new Response(null, { status: 204 }); }
    const data = path.endsWith("/remote_shares/pending") ? [{ id: "pending-offer", name: "/report.pdf" }]
      : path.endsWith("/remote_shares") ? [{ id: "accepted-share", name: "/report.pdf" }] : [];
    return new Response(JSON.stringify({ ocs: { data } }), { status: 200 });
  };
  try {
    await nextcloudEnvironment.teardown!({ context: {} as never, executionFailed: true });
    assert.ok(deleted.includes("/ocs/v2.php/apps/files_sharing/api/v1/remote_shares/pending/pending-offer"));
    assert.ok(deleted.includes("/ocs/v2.php/apps/files_sharing/api/v1/remote_shares/accepted-share"));
    assert.ok(!deleted.includes("/ocs/v2.php/apps/files_sharing/api/v1/remote_shares/pending-offer"));
  } finally {
    globalThis.fetch = originalFetch;
    if (preserve === undefined) delete process.env.NEXTCLOUD_PRESERVE_FIXTURES; else process.env.NEXTCLOUD_PRESERVE_FIXTURES = preserve;
  }
});
