import assert from "node:assert/strict";
import test from "node:test";
import { keyboardTextEntryInputModalityId } from "@openuji/journey-execution-model";
import {
  appiumExecutor,
  appiumCommandForModality,
  appiumLocatorQuery,
  initialAppiumLifecycleState,
  reduceAppiumLifecycle,
  touchTapInputModalityId,
  type AppiumSession
} from "../src/index.js";
import { runJourney, type JourneyPlan, type StatePlanOperation, type TransitionPlanOperation } from "@openuji/journey-runner";

const locator = { id: "field", role: "textbox", accessibleName: "Account", features: [], contexts: [] };
const binding = {
  id: "binding", surfaceId: "surface", eventId: "event", requiredInputModalityProfiles: [], locators: [locator]
};
const vertex = { id: "state", type: "State" as const };
const base = {
  actorId: "actor", touchpointId: "touchpoint",
  entry: { id: "entry", stateId: "state" }, entryBinding: { id: "entry-binding", value: "application" }
};
const state: StatePlanOperation = {
  ...base, id: "state-operation", sequence: 0, kind: "state", state: vertex, surface: { id: "surface" },
  target: { expectedMatchCount: 1, bindings: [binding], observation: { stateId: "state", surfaceId: "surface", expectedMatchCount: 1, bindings: [binding] } }
};
const inputProfile = { id: "text-entry", modalities: [{ id: keyboardTextEntryInputModalityId }] };
const transition: TransitionPlanOperation = {
  ...base, id: "transition-operation", sequence: 1, kind: "transition",
  transition: { id: "username", from: "state", to: "state" }, from: vertex, to: vertex, surface: { id: "surface" },
  activation: { transitionId: "username", eventId: "event", from: vertex, to: vertex, surfaceId: "surface", requiredInputModalityProfiles: [inputProfile], bindings: [binding] },
  effects: []
};
const plan: JourneyPlan = { id: "plan", operations: [state, transition] };

class Session implements AppiumSession {
  readonly id = "session";
  readonly calls: string[] = [];
  closeError?: Error;
  async findElements(_query: string) { this.calls.push("find"); return [{ elementId: "target" }]; }
  async tap(_id: string) { this.calls.push("tap"); }
  async setValue(_id: string, value: string) { this.calls.push(`type:${value}`); }
  async source() { this.calls.push("source"); return "<hierarchy/>"; }
  async screenshot() { this.calls.push("screenshot"); return ""; }
  async deviceMetrics() { return {}; }
  async activateApplication(id: string) { this.calls.push(`activate:${id}`); }
  async terminateApplication(id: string) { this.calls.push(`terminate:${id}`); }
  async clearApplication(id: string) { this.calls.push(`clear:${id}`); }
  async openDeepLink(url: string) { this.calls.push(`deep-link:${url}`); }
  async close() { this.calls.push("close"); if (this.closeError) throw this.closeError; }
}

const client = Object.freeze({
  name: "pure-client",
  resolveEntry: () => Object.freeze({ kind: "application" as const }),
  resolveTransitionValue: () => "alice"
});
const options = (session: Session) => ({
  client,
  application: { apk: "/application.apk", package: "test.application", activity: "test.Activity" },
  devices: { touchpoint: { udid: "device-1" } },
  sessionFactory: async () => session,
  assertionTimeoutMs: 0
});

test("native query and modality compilation are deterministic", () => {
  const before = structuredClone(locator);
  assert.equal(appiumLocatorQuery(locator), appiumLocatorQuery(locator));
  assert.deepEqual(locator, before);
  assert.equal(appiumCommandForModality(touchTapInputModalityId), "tap");
  assert.equal(appiumCommandForModality(keyboardTextEntryInputModalityId), "type");
  assert.throws(() => appiumCommandForModality("unsupported"), /does not support/);
});

test("native queries support Android hint attributes exposed for web form controls", () => {
  assert.equal(appiumLocatorQuery({
    id: "account-field",
    role: "textbox",
    features: [{ id: "account-hint", name: "hint", value: "Account name or email" }],
    contexts: []
  }), "//*[(@class='android.widget.EditText') and @hint='Account name or email' and @displayed='true']");
});

test("Appium owns fresh installation, Chrome reset, deterministic application entry, and text input", async () => {
  const session = new Session();
  let capabilities: Readonly<Record<string, unknown>> | undefined;
  const result = await runJourney({
    plan,
    profiles: [{ id: "profile", selectInputModality: () => ({ profileId: "profile", inputModalityProfile: inputProfile, modality: inputProfile.modalities[0]! }) }],
    executor: appiumExecutor({ ...options(session), sessionFactory: async (input) => { capabilities = input.capabilities; return session; } })
  });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(capabilities?.["appium:fullReset"], true);
  assert.equal(capabilities?.["appium:noReset"], false);
  assert.equal(capabilities?.["appium:udid"], "device-1");
  assert.deepEqual(session.calls, [
    "terminate:com.android.chrome", "clear:com.android.chrome", "activate:test.application",
    "find", "tap", "find", "find", "tap", "find", "type:alice", "close"
  ]);
});

test("complete construction values reach the Appium session", async () => {
  const session = new Session();
  let input: Record<string, unknown> | undefined;
  const result = await runJourney({
    plan,
    profiles: [{ id: "profile", selectInputModality: () => ({ profileId: "profile", inputModalityProfile: inputProfile, modality: inputProfile.modalities[0]! }) }],
    executor: appiumExecutor({
      ...options(session),
      application: { apk: "/built.apk", package: "test.application", activity: "test.Activity" },
      devices: { touchpoint: { udid: "emulator-5556" } },
      connection: { hostname: "127.0.0.1", port: 4799, path: "/" },
      sessionFactory: async (value) => { input = value; return session; }
    })
  });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const capabilities = input?.capabilities as Record<string, unknown>;
  assert.equal(capabilities["appium:app"], "/built.apk");
  assert.equal(capabilities["appium:udid"], "emulator-5556");
  assert.equal(input?.port, 4799);
});

test("a platform prompt disappearing before its tap does not fail the modeled state", async () => {
  const session = new Session();
  const taps: string[] = [];
  session.findElements = async (query) => [{ elementId: query.includes("permission_allow_button") ? "prompt" : "target" }];
  session.tap = async (id) => {
    taps.push(id);
    if (id === "prompt") throw Object.assign(new Error("Prompt was dismissed"), { name: "stale element reference" });
  };
  const result = await runJourney({
    plan: { ...plan, operations: [state] }, profiles: [{ id: "profile" }], executor: appiumExecutor(options(session))
  });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(taps, ["prompt"]);
  assert.equal(session.calls.at(-1), "close");
});

test("platform interruption handling preserves session failures", async () => {
  const session = new Session();
  session.tap = async () => { throw Object.assign(new Error("Session is gone"), { name: "invalid session id" }); };
  const result = await runJourney({
    plan: { ...plan, operations: [state] }, profiles: [{ id: "profile" }], executor: appiumExecutor(options(session))
  });
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.errors), /Session is gone/);
});

test("stale modeled actions still fail without being retried", async () => {
  const session = new Session();
  let taps = 0;
  session.findElements = async (query) => query.includes("permission_allow_button") ? [] : [{ elementId: "target" }];
  session.tap = async () => { taps++; throw Object.assign(new Error("Modeled target is stale"), { name: "stale element reference" }); };
  const touchProfile = { id: "touch", modalities: [{ id: touchTapInputModalityId }] };
  const result = await runJourney({
    plan: { ...plan, operations: [{ ...transition, activation: { ...transition.activation, requiredInputModalityProfiles: [touchProfile] } }] },
    profiles: [{ id: "profile", selectInputModality: () => ({ profileId: "profile", inputModalityProfile: touchProfile, modality: touchProfile.modalities[0]! }) }],
    executor: appiumExecutor(options(session))
  });
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.errors), /Modeled target is stale/);
  assert.equal(taps, 1);
});

test("an execution without a resolved APK or UDID, or with a shared device, fails when it starts", async () => {
  const start = async (overrides: Record<string, unknown>) => appiumExecutor({ ...options(new Session()), ...overrides })
    .createSession({ context: { runId: "run", executionId: "execution", plan: { id: "plan", operations: [] }, profile: { id: "profile" } } }).start();
  await assert.rejects(start({ application: { apk: "", package: "p", activity: "a" } }), /requires an APK/);
  await assert.rejects(start({ devices: { touchpoint: { udid: "" } } }), /has no UDID/);
  await assert.rejects(start({ devices: { a: { udid: "same" }, b: { udid: "same" } } }), /its own Appium device/);
});

test("lifecycle reducer replaces frozen states and rejects late registration", () => {
  const created = initialAppiumLifecycleState();
  const starting = reduceAppiumLifecycle(created, { type: "start" });
  const started = reduceAppiumLifecycle(starting, { type: "started" });
  const closed = reduceAppiumLifecycle(reduceAppiumLifecycle(started, { type: "close" }), { type: "closed" });
  assert.notStrictEqual(created, starting);
  assert.equal(created.status, "created");
  assert.ok(Object.isFrozen(closed.resources));
  assert.throws(() => reduceAppiumLifecycle(closed, { type: "register", resource: {} as never }), /Cannot register/);
});

test("cleanup is idempotent and reports its own close failures", async () => {
  const session = new Session();
  session.closeError = new Error("session close failed");
  const executor = appiumExecutor(options(session));
  const execution = executor.createSession({ context: { runId: "run", executionId: "execution", profile: { id: "profile" }, plan } });
  await execution.start();
  await execution.openEntry(state);
  await assert.rejects(async () => execution.close({ executionFailed: true }), /session close failed/);
  await execution.close({ executionFailed: true });
  assert.equal(session.calls.filter((call) => call === "close").length, 1);
});

test("an Appium startup failure is reported once and not relabeled as cleanup failure", async () => {
  const result = await runJourney({
    plan,
    profiles: [{ id: "startup-failure" }],
    executor: appiumExecutor({
      ...options(new Session()),
      executionObservers: [{
        name: "failing-start-observer",
        onExecutionStarted() { throw new Error("Appium startup failed"); }
      }]
    })
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors.map((error) => error.message), ["Appium startup failed"]);
});

test("duplicate allocation compensation keeps the original session tracked", async () => {
  const sessions: Session[] = [];
  const execution = appiumExecutor({
    ...options(new Session()),
    sessionFactory: async () => {
      const session = new Session();
      sessions.push(session);
      return session;
    }
  }).createSession({ context: { runId: "run", executionId: "duplicate-allocation", profile: { id: "profile" }, plan } });
  await execution.start();
  const outcomes = await Promise.allSettled([execution.openEntry(state), execution.openEntry(state)]);
  assert.deepEqual(outcomes.map((outcome) => outcome.status).sort(), ["fulfilled", "rejected"]);
  assert.match((outcomes.find((outcome) => outcome.status === "rejected") as PromiseRejectedResult).reason.message, /Duplicate Appium resource/);
  await execution.close({ executionFailed: true });
  assert.equal(sessions.length, 2);
  assert.deepEqual(sessions.map((session) => session.calls.filter((call) => call === "close").length), [1, 1]);
});

test("a session allocated after cancellation is transactionally closed", async () => {
  const controller = new AbortController();
  let deliver!: (session: never) => void;
  let closed = 0;
  const pending = new Promise<never>((done) => { deliver = done; });
  const result = await runJourney({
    plan: { id: "cancelled-plan", operations: [state] },
    profiles: [{ id: "cancelled" }],
    signal: controller.signal,
    executor: appiumExecutor({
      client,
      application: { apk: "/application.apk", package: "test.application", activity: "test.Activity" },
      devices: { touchpoint: { udid: "device-1" } },
      sessionFactory() {
        controller.abort(new Error("Cancel session startup"));
        return pending;
      }
    })
  });
  assert.equal(result.ok, false);
  deliver({ async close() { closed++; } } as never);
  await new Promise<void>((done) => setImmediate(done));
  assert.equal(closed, 1);
});

test("native action observations retain commands when a later state assertion fails", async () => {
  const session = new Session();
  const actions: import("@openuji/journey-core").JourneyInputAction[] = [];
  const failedState = { ...state, target: { ...state.target, expectedMatchCount: 0 } };
  const result = await runJourney({ plan: { id: "action-observation", operations: [transition, failedState] }, profiles: [{ id: "touch", selectInputModality() { return { profileId: "touch", inputModalityProfile: inputProfile, modality: inputProfile.modalities[0] }; } }], executor: appiumExecutor({ ...options(session), executionObservers: [{ name: "action-log", onAction(action) { actions.push(action); } }] }) });
  assert.equal(result.ok, false);
  assert.deepEqual(actions.map((action) => action.status), ["attempted", "completed"]);
  assert.equal(actions[0].id, actions[1].id);
  assert.equal(actions[0].operationId, transition.id);
  assert.equal(Object.isFrozen(actions[0]), true);
  assert.doesNotMatch(JSON.stringify(actions), /alice/);
});

test("installation verification precedes modeled interaction and a mismatch closes the allocated session", async () => {
  const session = new Session();
  let verified = 0;
  const result = await runJourney({ plan, profiles: [{ id: "profile", selectInputModality: () => ({ profileId: "profile", inputModalityProfile: inputProfile, modality: inputProfile.modalities[0]! }) }],
    executor: appiumExecutor({ ...options(session), preserveApkSignature: true,
      sessionFactory: async (input) => { assert.equal(input.capabilities["appium:noSign"], true); return session; },
      verifyInstallation: async ({ udid, execution }) => { verified++; assert.equal(udid, "device-1"); assert.equal(execution.profile.id, "profile"); throw new Error("installed APK mismatch"); }
    }) });
  assert.equal(result.ok, false); assert.equal(verified, 1);
  assert.deepEqual(session.calls, ["close"]);
  assert.match(JSON.stringify(result.errors), /installed APK mismatch/);
});

test("declared materializations are refused, not tapped past", async () => {
  const touch = { id: "urn:material:touch", transitionId: "username", modality: { id: touchTapInputModalityId }, steps: [{ id: "urn:step:tap", kind: "activation" as const }] };
  const executor = appiumExecutor(options(new Session()));
  assert.throws(() => executor.describeOperation!({ ...transition, materializations: [touch] }), /Appium does not perform TransitionMaterialization urn:material:touch \(urn:openuji:input:touch-tap\) yet/);
  assert.doesNotThrow(() => executor.describeOperation!({ ...transition, materializations: [{ ...touch, modality: { id: "observability:keyboard" } }] }));
  const session = new Session();
  const result = await runJourney({
    plan: { id: "plan", operations: [state, transition] },
    profiles: [{ id: "selected", selectInputModality: () => ({ profileId: "selected", inputModalityProfile: inputProfile, modality: inputProfile.modalities[0]!, materialization: { ...touch, modality: inputProfile.modalities[0]! } }) }],
    executor: appiumExecutor(options(session))
  });
  assert.equal(result.ok, false);
  assert.match(result.errors[0]!.message, /Appium does not perform TransitionMaterialization urn:material:touch yet/);
  // The fixture's platform-prompt handling may tap during the state check; the transition itself must not type.
  assert.equal(session.calls.some((call) => call.startsWith("type:")), false, session.calls.join(","));
});
