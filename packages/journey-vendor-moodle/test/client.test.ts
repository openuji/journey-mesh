import assert from "node:assert/strict";
import test from "node:test";
import type { JourneyPlanOperation, TransitionPlanOperation } from "@openuji/journey-execution-model";
import { moodleWebClient } from "../src/web/client.js";
import { journeyMeshPlugin } from "../src/web/plugin.js";

const base = { id: "operation", sequence: 0, actorId: "admin", touchpointId: "site", entry: { id: "entry", stateId: "state" }, entryBinding: { id: "binding", value: "dashboard" } };
const operation = { ...base, kind: "control-flow", transition: { id: "flow", from: "state", to: "state" } } satisfies JourneyPlanOperation;
const login = { ...base, kind: "transition", transition: { id: "username", from: "state", to: "state" }, from: { id: "state", type: "State" }, to: { id: "state", type: "State" },
  surface: { id: "login" }, activation: { transitionId: "username", eventId: "event", from: { id: "state", type: "State" }, to: { id: "state", type: "State" }, surfaceId: "login", requiredInputModalityProfiles: [], bindings: [] },
  effects: [] } satisfies TransitionPlanOperation;
const options = (baseURL = "http://localhost:18090") => ({
  touchpoints: { site: { baseURL } }, users: { admin: { username: "admin", password: "Journey-Mesh-1" } },
  entries: { dashboard: "/my/", login: "/login/index.php" }, transitionValues: { username: { source: "user.username" as const } }
});

test("entries resolve deterministically below the site's wwwroot, including a site below a path", () => {
  assert.deepEqual(moodleWebClient(options()).resolveEntry(operation), { kind: "url", url: "http://localhost:18090/my/" });
  assert.deepEqual(moodleWebClient(options("https://school.example/moodle/")).resolveEntry(operation), { kind: "url", url: "https://school.example/moodle/my/" });
  assert.equal(moodleWebClient(options()).resolveTransitionValue(login), "admin");
});

test("bindings are validated before execution and errors name Moodle", () => {
  assert.throws(() => moodleWebClient({ ...options(), entries: { dashboard: "https://elsewhere.example/" } }), /Moodle web entry dashboard must be a path relative to the site/);
  assert.throws(() => moodleWebClient({ ...options(), entries: { dashboard: "//elsewhere/" } }), /must be a path relative to the site/);
  assert.throws(() => moodleWebClient({ ...options(), touchpoints: {} }), /^Error: Moodle client requires at least one touchpoint$/);
  assert.throws(() => moodleWebClient(options()).resolveEntry({ ...operation, actorId: "teacher" }), /No Moodle user for teacher/);
});

test("the plugin implements the Web client contract and checks every operation's bindings", () => {
  assert.equal(journeyMeshPlugin.clientContract.id, "@openuji/journey-platform-web/client/v1");
  const context = { operations: [operation] } as never;
  assert.deepEqual(journeyMeshPlugin.parse(options() as never, context), { ...options(), transitionValues: options().transitionValues });
  assert.throws(() => journeyMeshPlugin.parse({ ...options(), touchpoints: { other: { baseURL: "http://localhost" } } } as never, context), /Missing touchpoint site/);
});
