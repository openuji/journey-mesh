import assert from "node:assert/strict";
import test from "node:test";
import { keyboardTextEntryInputModalityId } from "@openuji/journey-execution-model";
import { appiumCommandForModality } from "../src/index.js";
import {
  appiumIosExecutor,
  appiumIosExecutorName,
  appiumIosLocatorQuery,
  initialIosAppiumLifecycleState,
  reduceIosAppiumLifecycle,
  swipeDownMoveKindId,
  touchInputModalityId,
  touchTapInputModalityId,
  type IosAppiumSession
} from "../src/ios.js";
import { runJourney, type JourneyPlan, type StatePlanOperation, type TransitionPlanOperation } from "@openuji/journey-runner";

const locator = { id: "field", role: "textbox", accessibleName: "Server address", features: [], contexts: [] };
const binding = {
  id: "binding",
  surfaceId: "surface",
  eventId: "event",
  requiredInputModalityProfiles: [],
  locators: [locator]
};
const vertex = { id: "state", type: "State" as const };
const base = {
  actorId: "actor",
  touchpointId: "touchpoint",
  entry: { id: "entry", stateId: "state" },
  entryBinding: { id: "entry-binding", value: "application" }
};
const state: StatePlanOperation = {
  ...base,
  id: "state-operation",
  sequence: 0,
  kind: "state",
  state: vertex,
  surface: { id: "surface" },
  target: {
    expectedMatchCount: 1,
    bindings: [binding],
    observation: { stateId: "state", surfaceId: "surface", expectedMatchCount: 1, bindings: [binding] }
  }
};
const inputProfile = { id: "text-entry", modalities: [{ id: keyboardTextEntryInputModalityId }] };
const transition: TransitionPlanOperation = {
  ...base,
  id: "transition-operation",
  sequence: 1,
  kind: "transition",
  transition: { id: "serverAddress", from: "state", to: "state" },
  from: vertex,
  to: vertex,
  surface: { id: "surface" },
  activation: {
    transitionId: "serverAddress",
    eventId: "event",
    from: vertex,
    to: vertex,
    surfaceId: "surface",
    requiredInputModalityProfiles: [inputProfile],
    bindings: [binding]
  },
  effects: []
};
const plan: JourneyPlan = { id: "plan", operations: [state, transition] };

class Session implements IosAppiumSession {
  readonly id = "ios-session";
  readonly calls: string[] = [];
  closeError?: Error;
  async findElements(query: string) {
    this.calls.push("find");
    if (query.includes("XCUIElementTypeAlert")) return [];
    return [{ elementId: "target" }];
  }
  async tap(_id: string) {
    this.calls.push("tap");
  }
  async swipeDown(id: string) {
    this.calls.push(`swipe-down:${id}`);
  }
  async setValue(_id: string, value: string) {
    this.calls.push(`type:${value}`);
  }
  async source() {
    this.calls.push("source");
    return "<AppiumAUT/>";
  }
  async screenshot() {
    this.calls.push("screenshot");
    return "";
  }
  async deviceMetrics() {
    return { scale: 3, platformVersion: "26.2" };
  }
  async activateApplication(bundleId: string) {
    this.calls.push(`activate:${bundleId}`);
  }
  async terminateApplication(bundleId: string) {
    this.calls.push(`terminate:${bundleId}`);
  }
  async openDeepLink(url: string, bundleId: string) {
    this.calls.push(`deep-link:${bundleId}:${url}`);
  }
  async close() {
    this.calls.push("close");
    if (this.closeError) throw this.closeError;
  }
}

const client = Object.freeze({
  name: "pure-ios-client",
  resolveEntry: () => Object.freeze({ kind: "application" as const }),
  resolveTransitionValue: () => "http://127.0.0.1:18086"
});
const options = (session: Session) => ({
  client,
  application: { app: "/Nextcloud.app", bundleId: "it.twsweb.Nextcloud" },
  devices: { touchpoint: { udid: "sim-1" } },
  sessionFactory: async () => session,
  assertionTimeoutMs: 0
});

test("iOS XCUITest query compilation maps roles, name, label, and visibility deterministically", () => {
  const before = structuredClone(locator);
  const query = appiumIosLocatorQuery(locator);
  assert.equal(query, appiumIosLocatorQuery(locator));
  assert.deepEqual(locator, before);
  assert.match(query, /XCUIElementTypeTextField/);
  assert.match(query, /XCUIElementTypeSecureTextField/);
  assert.match(query, /@visible='true'/);
  assert.equal(
    appiumIosLocatorQuery({
      id: "login-button",
      role: "button",
      features: [{ id: "login-id", name: "name", value: "login" }],
      contexts: []
    }),
    "//*[(@type='XCUIElementTypeButton') and @name='login' and @visible='true']"
  );
  assert.equal(
    appiumIosLocatorQuery({
      id: "file-row",
      role: "row",
      features: [{ id: "file-label", name: "label", value: "report.pdf" }],
      contexts: []
    }),
    "//*[(@type='XCUIElementTypeCell') and @label='report.pdf' and @visible='true']"
  );
  assert.equal(appiumCommandForModality(touchTapInputModalityId), "tap");
  assert.equal(appiumCommandForModality(keyboardTextEntryInputModalityId), "type");
});

test("Appium iOS owns fresh installation, deterministic application and deep-link entry, and text input", async () => {
  const session = new Session();
  let capabilities: Readonly<Record<string, unknown>> | undefined;
  const executor = appiumIosExecutor({
    ...options(session),
    sessionFactory: async (input) => {
      capabilities = input.capabilities;
      return session;
    }
  });
  assert.equal(executor.name, appiumIosExecutorName);
  const result = await runJourney({
    plan,
    profiles: [
      {
        id: "profile",
        selectInputModality: () => ({
          profileId: "profile",
          inputModalityProfile: inputProfile,
          modality: inputProfile.modalities[0]!
        })
      }
    ],
    executor
  });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(capabilities?.["appium:fullReset"], true);
  assert.equal(capabilities?.["appium:noReset"], false);
  assert.equal(capabilities?.["appium:udid"], "sim-1");
  assert.equal(capabilities?.["appium:app"], "/Nextcloud.app");
  assert.equal(capabilities?.["appium:bundleId"], "it.twsweb.Nextcloud");
  assert.equal(capabilities?.["appium:autoAcceptAlerts"], true);
  assert.deepEqual(session.calls, [
    "activate:it.twsweb.Nextcloud",
    "find",
    "find",
    "find",
    "find",
    "type:http://127.0.0.1:18086",
    "close"
  ]);

  const deepLinkSession = new Session();
  const deepLinkResult = await runJourney({
    plan: { id: "deep-link-plan", operations: [state] },
    profiles: [{ id: "profile" }],
    executor: appiumIosExecutor({
      ...options(deepLinkSession),
      client: Object.freeze({
        name: "deep-link-client",
        resolveEntry: () => Object.freeze({ kind: "deep-link" as const, url: "nextcloud://open-file" }),
        resolveTransitionValue: () => undefined
      })
    })
  });
  assert.equal(deepLinkResult.ok, true, JSON.stringify(deepLinkResult.errors));
  assert.equal(deepLinkSession.calls[0], "deep-link:it.twsweb.Nextcloud:nextcloud://open-file");
});

test("an iOS system alert disappearing before its tap does not fail the modeled state", async () => {
  const session = new Session();
  const taps: string[] = [];
  session.findElements = async (query) => [{ elementId: query.includes("XCUIElementTypeAlert") ? "prompt" : "target" }];
  session.tap = async (id) => {
    taps.push(id);
    if (id === "prompt") throw Object.assign(new Error("Alert was dismissed"), { name: "stale element reference" });
  };
  const result = await runJourney({
    plan: { ...plan, operations: [state] },
    profiles: [{ id: "profile" }],
    executor: appiumIosExecutor(options(session))
  });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(taps, ["prompt"]);
  assert.equal(session.calls.at(-1), "close");
});

test("iOS platform interruption handling preserves session failures", async () => {
  const session = new Session();
  session.findElements = async (query) => [{ elementId: query.includes("XCUIElementTypeAlert") ? "prompt" : "target" }];
  session.tap = async () => {
    throw Object.assign(new Error("Session is gone"), { name: "invalid session id" });
  };
  const result = await runJourney({
    plan: { ...plan, operations: [state] },
    profiles: [{ id: "profile" }],
    executor: appiumIosExecutor(options(session))
  });
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.errors), /Session is gone/);
});

test("an execution without a resolved app bundle or UDID, or with a shared device, fails when constructed", async () => {
  assert.throws(
    () => appiumIosExecutor({ ...options(new Session()), application: { app: "", bundleId: "it.twsweb.Nextcloud" } }),
    /requires an app bundle path/
  );
  assert.throws(
    () => appiumIosExecutor({ ...options(new Session()), devices: { touchpoint: { udid: "" } } }),
    /has no UDID/
  );
  assert.throws(
    () => appiumIosExecutor({ ...options(new Session()), devices: { a: { udid: "same" }, b: { udid: "same" } } }),
    /its own Appium iOS device/
  );
});

test("lifecycle reducer replaces frozen states and rejects late registration", () => {
  const created = initialIosAppiumLifecycleState();
  const starting = reduceIosAppiumLifecycle(created, { type: "start" });
  const started = reduceIosAppiumLifecycle(starting, { type: "started" });
  const closed = reduceIosAppiumLifecycle(reduceIosAppiumLifecycle(started, { type: "close" }), { type: "closed" });
  assert.notStrictEqual(created, starting);
  assert.equal(created.status, "created");
  assert.ok(Object.isFrozen(closed.resources));
  assert.throws(() => reduceIosAppiumLifecycle(closed, { type: "register", resource: {} as never }), /Cannot register/);
});

test("installation verification precedes modeled interaction and a mismatch closes the allocated session", async () => {
  const session = new Session();
  let verified = 0;
  const result = await runJourney({
    plan,
    profiles: [
      {
        id: "profile",
        selectInputModality: () => ({
          profileId: "profile",
          inputModalityProfile: inputProfile,
          modality: inputProfile.modalities[0]!
        })
      }
    ],
    executor: appiumIosExecutor({
      ...options(session),
      verifyInstallation: async ({ udid, execution }) => {
        verified++;
        assert.equal(udid, "sim-1");
        assert.equal(execution.profile.id, "profile");
        throw new Error("installed iOS app mismatch");
      }
    })
  });
  assert.equal(result.ok, false);
  assert.equal(verified, 1);
  assert.deepEqual(session.calls, ["close"]);
  assert.match(JSON.stringify(result.errors), /installed iOS app mismatch/);
});

test("declared materializations are refused for unmaterialized modalities on iOS, while urn:openuji:input:touch validates and performs declared steps", async () => {
  const touchTapMaterialization = {
    id: "urn:material:touch-tap",
    transitionId: "serverAddress",
    modality: { id: touchTapInputModalityId },
    steps: [{ id: "urn:step:tap", kind: "activation" as const }]
  };
  const executor = appiumIosExecutor(options(new Session()));
  assert.throws(
    () => executor.describeOperation!({ ...transition, materializations: [touchTapMaterialization] }),
    /Appium iOS does not perform TransitionMaterialization urn:material:touch-tap \(urn:openuji:input:touch-tap\) yet/
  );
  assert.doesNotThrow(() =>
    executor.describeOperation!({ ...transition, materializations: [{ ...touchTapMaterialization, modality: { id: "observability:keyboard" } }] })
  );

  const touchModality = { id: touchInputModalityId, label: "Touch" };
  const touchProfile = { id: "urn:input-modality-profile:touch", modalities: [touchModality] };
  assert.throws(
    () => executor.describeOperation!({
      ...transition,
      activation: { ...transition.activation, requiredInputModalityProfiles: [touchProfile] }
    }),
    /urn:openuji:input:touch requires a TransitionMaterialization/
  );
  assert.throws(
    () => executor.describeOperation!({
      ...transition,
      materializations: [{ id: "urn:material:start", transitionId: "serverAddress", modality: touchModality, startLocator: locator, steps: [{ id: "urn:step:1", kind: "activation" }] }]
    }),
    /does not support materializationStartLocatorRef/
  );
  assert.throws(
    () => executor.describeOperation!({
      ...transition,
      materializations: [{ id: "urn:material:shortcut", transitionId: "serverAddress", modality: touchModality, steps: [{ id: "urn:step:1", kind: "shortcut" }] }]
    }),
    /does not perform ShortcutSteps/
  );
  assert.throws(
    () => executor.describeOperation!({
      ...transition,
      materializations: [{ id: "urn:material:move", transitionId: "serverAddress", modality: touchModality, steps: [{ id: "urn:step:1", kind: "move", moveKind: { id: "operability:nextPage", type: "move" } }] }]
    }),
    /does not support operability:nextPage through urn:openuji:input:touch/
  );

  const touchMaterialization = {
    id: "urn:material:refresh:touch",
    transitionId: "serverAddress",
    modality: touchModality,
    steps: [
      { id: "urn:step:refresh:1", kind: "move" as const, moveKind: { id: swipeDownMoveKindId, type: "move" as const }, locator },
      { id: "urn:step:refresh:2", kind: "activation" as const, locator }
    ]
  };
  const touchOperation: TransitionPlanOperation = {
    ...transition,
    activation: { ...transition.activation, requiredInputModalityProfiles: [touchProfile] },
    materializations: [touchMaterialization]
  };
  assert.doesNotThrow(() => executor.describeOperation!(touchOperation));

  const touchSession = new Session();
  const recordedActions: Array<{ command: string; gesture?: string; stepId?: string; status: string }> = [];
  const touchResult = await runJourney({
    plan: { id: "touch-plan", operations: [state, touchOperation] },
    profiles: [{
      id: "touch",
      selectInputModality: () => ({
        profileId: "touch",
        inputModalityProfile: touchProfile,
        modality: touchModality,
        materialization: touchMaterialization
      })
    }],
    executor: appiumIosExecutor({
      ...options(touchSession),
      executionObservers: [{
        name: "actions",
        onAction: (event) => {
          recordedActions.push({ command: event.command, gesture: event.gesture, stepId: event.stepId, status: event.status });
        }
      }]
    })
  });
  assert.equal(touchResult.ok, true, JSON.stringify(touchResult.errors));
  assert.deepEqual(touchSession.calls.filter((call) => call.startsWith("swipe-down") || call === "tap"), ["swipe-down:target", "tap"]);
  assert.deepEqual(recordedActions, [
    { command: "move", gesture: undefined, stepId: "urn:step:refresh:1", status: "attempted" },
    { command: "move", gesture: "swipe-down", stepId: "urn:step:refresh:1", status: "completed" },
    { command: "activate", gesture: undefined, stepId: "urn:step:refresh:2", status: "attempted" },
    { command: "activate", gesture: "tap", stepId: "urn:step:refresh:2", status: "completed" }
  ]);

  const session = new Session();
  const result = await runJourney({
    plan: { id: "plan", operations: [state, transition] },
    profiles: [
      {
        id: "selected",
        selectInputModality: () => ({
          profileId: "selected",
          inputModalityProfile: inputProfile,
          modality: inputProfile.modalities[0]!,
          materialization: { ...touchTapMaterialization, modality: inputProfile.modalities[0]! }
        })
      }
    ],
    executor: appiumIosExecutor(options(session))
  });
  assert.equal(result.ok, false);
  assert.match(result.errors[0]!.message, /Appium iOS does not perform TransitionMaterialization urn:material:touch-tap yet/);
  assert.equal(session.calls.some((call) => call.startsWith("type:")), false, session.calls.join(","));
});
