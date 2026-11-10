import assert from "node:assert/strict";
import test from "node:test";
import { runJourney, type JourneyPlan } from "@openuji/journey-runner";
import { initialPlaywrightLifecycleState, playwrightAdapter, reducePlaywrightLifecycle, toPlaywrightLocator } from "../src/index.js";

const operation = {
  id: "state-operation", sequence: 0, kind: "state",
  actorId: "actor", touchpointId: "touchpoint",
  entry: { id: "entry", stateId: "state" }, entryBinding: { id: "entry-binding", value: "entry" },
  state: { id: "state" }, surface: { id: "surface" },
  target: {
    expectedMatchCount: 1,
    bindings: [{ id: "binding", surfaceId: "surface", eventId: "presence", requiredInputModalityProfiles: [], locators: [{ id: "main", role: "main", features: [], contexts: [] }] }],
    observation: { stateId: "state", surfaceId: "surface", expectedMatchCount: 1, bindings: [] }
  }
} as const;
const plan = { id: "plan", operations: [operation] } as unknown as JourneyPlan;
const driver = Object.freeze({
  name: "driver",
  resolveEntry: () => Object.freeze({ kind: "url" as const, url: "https://example.test/" }),
  resolveTransitionValue: () => undefined
});

test("Playwright lifecycle reduction is immutable and closed states reject resources", () => {
  const created = initialPlaywrightLifecycleState();
  const starting = reducePlaywrightLifecycle(created, { type: "start" });
  const registered = reducePlaywrightLifecycle(starting, {
    type: "register",
    resource: Object.freeze({ id: "browser", kind: "browser", value: Object.freeze({}) })
  });
  assert.notStrictEqual(created, starting);
  assert.notStrictEqual(starting, registered);
  assert.equal(created.status, "created");
  assert.deepEqual(starting.resources, []);
  assert.ok(Object.isFrozen(registered.resources));
  const closed = reducePlaywrightLifecycle(reducePlaywrightLifecycle(registered, { type: "close" }), { type: "closed" });
  assert.throws(() => reducePlaywrightLifecycle(closed, {
    type: "register", resource: { id: "late", kind: "context", value: {} }
  }), /Cannot register/);
});

test("a browser allocated after cancellation is transactionally closed", async () => {
  const controller = new AbortController();
  let deliver!: (browser: never) => void;
  let closed = 0;
  const pending = new Promise<never>((done) => { deliver = done; });
  const result = await runJourney({
    plan,
    profiles: [{ id: "cancelled" }],
    signal: controller.signal,
    adapter: playwrightAdapter({
      driver,
      browserType: {
        launch() {
          controller.abort(new Error("Cancel browser startup"));
          return pending;
        }
      }
    })
  });
  assert.equal(result.ok, false);
  deliver({ async close() { closed++; } } as never);
  await new Promise<void>((done) => setImmediate(done));
  assert.equal(closed, 1);
});

test("a browser launch failure is reported once and not relabeled as cleanup failure", async () => {
  const result = await runJourney({
    plan,
    profiles: [{ id: "launch-failure" }],
    adapter: playwrightAdapter({
      driver,
      browserType: { async launch() { throw new Error("launch failed"); } }
    })
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors.map((error) => error.message), ["launch failed"]);
});

test("duplicate allocation compensation keeps the original context tracked", async () => {
  const contexts: Array<{ closeCalls: number }> = [];
  const browser = {
    async newContext() {
      const contextRecord = { closeCalls: 0 };
      contexts.push(contextRecord);
      const page = { async goto() {}, async close() {} };
      return {
        async newPage() { return page; },
        async close() { contextRecord.closeCalls++; }
      };
    }
  };
  const execution = playwrightAdapter({ driver, browser: browser as never }).createExecution({
    context: { runId: "run", executionId: "duplicate-allocation", profile: { id: "profile" }, plan }
  });
  await execution.start();
  const outcomes = await Promise.allSettled([execution.openEntry(operation), execution.openEntry(operation)]);
  assert.deepEqual(outcomes.map((outcome) => outcome.status).sort(), ["fulfilled", "rejected"]);
  assert.match((outcomes.find((outcome) => outcome.status === "rejected") as PromiseRejectedResult).reason.message, /Duplicate Playwright resource/);
  await execution.close({ executionFailed: true });
  assert.equal(contexts.length, 2);
  assert.deepEqual(contexts.map((context) => context.closeCalls), [1, 1]);
});

test("unsupported Playwright bindings fail before browser allocation", async () => {
  let launches = 0;
  const invalid = structuredClone(plan);
  const state = invalid.operations[0];
  if (state?.kind !== "state") throw new Error("Expected state fixture");
  state.target.bindings[0]!.locators[0]!.role = "unsupported-provider-role";
  const result = await runJourney({
    plan: invalid,
    profiles: [{ id: "preflight" }],
    adapter: playwrightAdapter({
      driver,
      browserType: { launch() { launches++; throw new Error("must not launch"); } }
    })
  });
  assert.equal(result.ok, false);
  assert.equal(launches, 0);
  assert.match(result.errors[0]!.message, /Unsupported Playwright role/);
});

test("Playwright exact-name features disambiguate partial accessible names", async () => {
  let options: Record<string, unknown> | undefined;
  const roleLocator = Object.freeze({ id: "role-locator" });
  const root = { getByRole(_role: string, value: Record<string, unknown>) { options = value; return roleLocator; } };
  const resolved = await toPlaywrightLocator(root as never, {
    id: "submit", role: "button", accessibleName: "Log in", contexts: [],
    features: [{ id: "exact-name", name: "accessible-name-exact", value: "true" }]
  });
  assert.strictEqual(resolved, roleLocator);
  assert.equal(options?.name, "Log in");
  assert.equal(options?.exact, true);
});
