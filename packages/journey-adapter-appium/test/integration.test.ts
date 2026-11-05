import assert from "node:assert/strict";
import test from "node:test";
import { keyboardTextEntryInputModalityId } from "@openuji/journey-execution-model";
import {
  appiumAdapter,
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
  async findElements() { this.calls.push("find"); return [{ elementId: "target" }]; }
  async tap() { this.calls.push("tap"); }
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

const driver = Object.freeze({
  name: "pure-driver",
  resolveEntry: () => Object.freeze({ kind: "application" as const }),
  resolveTransitionValue: () => "alice"
});
const options = (session: Session) => ({
  driver,
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
    adapter: appiumAdapter({ ...options(session), sessionFactory: async (input) => { capabilities = input.capabilities; return session; } })
  });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(capabilities?.["appium:fullReset"], true);
  assert.equal(capabilities?.["appium:noReset"], false);
  assert.equal(capabilities?.["appium:udid"], "device-1");
  assert.deepEqual(session.calls, [
    "terminate:com.android.chrome", "clear:com.android.chrome", "terminate:test.application", "activate:test.application",
    "find", "tap", "find", "find", "tap", "find", "type:alice", "close"
  ]);
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

test("cleanup is idempotent and preserves earlier and close failures", async () => {
  const session = new Session();
  session.closeError = new Error("session close failed");
  const adapter = appiumAdapter(options(session));
  const execution = adapter.createExecution({ context: { runId: "run", executionId: "execution", profile: { id: "profile" }, plan } });
  await execution.start();
  await execution.openEntry(state);
  await assert.rejects(async () => execution.close({ executionFailed: true }), /session close failed/);
  await execution.close({ executionFailed: true });
  assert.equal(session.calls.filter((call) => call === "close").length, 1);
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
    adapter: appiumAdapter({
      driver,
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
