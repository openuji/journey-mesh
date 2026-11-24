import assert from "node:assert/strict";
import test from "node:test";
import type { JourneyPlanOperation, TransitionPlanOperation } from "@openuji/journey-execution-model";
import { bindingForOperation, clientBindings, parseClientBindings, transitionValueForOperation, validateConfiguredOperations } from "../src/client.js";

const base = { id: "operation", sequence: 0, actorId: "learner", touchpointId: "campus", entry: { id: "entry", stateId: "state" }, entryBinding: { id: "binding", value: "course" } };
const operation = { ...base, kind: "control-flow", transition: { id: "flow", from: "state", to: "state" } } satisfies JourneyPlanOperation;
const transition = (id: string) => ({
  ...base, kind: "transition", transition: { id, from: "state", to: "state" },
  from: { id: "state", type: "State" }, to: { id: "state", type: "State" }, surface: { id: "surface" },
  activation: { transitionId: id, eventId: "event", from: { id: "state", type: "State" }, to: { id: "state", type: "State" }, surfaceId: "surface", requiredInputModalityProfiles: [], bindings: [] },
  effects: []
}) satisfies TransitionPlanOperation;

const options = {
  touchpoints: { campus: { baseURL: "https://moodle.example/campus/" } },
  users: { learner: { username: "learner", password: "secret" } },
  entries: { course: "/course/view.php?id=2" },
  transitionValues: { site: { source: "touchpoint.baseURL" as const }, login: { source: "user.username" as const }, literal: "hello" }
};
const routes = (entry: string, id: string) => { if (!entry.startsWith("/")) throw new Error(`Route ${id} must be relative`); };

test("bindings resolve an operation's entry, touchpoint and user, and are deeply frozen", () => {
  const bindings = clientBindings(options, { application: "Moodle", validateEntry: routes });
  const binding = bindingForOperation(bindings, operation);
  assert.deepEqual(binding, { entry: "/course/view.php?id=2", touchpoint: { baseURL: "https://moodle.example/campus/" }, user: { username: "learner", password: "secret" } });
  assert.ok(Object.isFrozen(bindings) && Object.isFrozen(bindings.users.learner) && Object.isFrozen(binding));
  options.users.learner.password = "changed";
  assert.equal(bindingForOperation(bindings, operation).user.password, "secret", "bindings are a copy of the options");
  options.users.learner.password = "secret";
});

test("transition values come from literals, the touchpoint or the user", () => {
  const bindings = clientBindings(options, { application: "Moodle", validateEntry: routes });
  assert.equal(transitionValueForOperation(bindings, transition("site")), "https://moodle.example/campus");
  assert.equal(transitionValueForOperation(bindings, transition("login")), "learner");
  assert.equal(transitionValueForOperation(bindings, transition("literal")), "hello");
  assert.equal(transitionValueForOperation(bindings, transition("unconfigured")), undefined);
});

test("errors name the bound application", () => {
  assert.throws(() => clientBindings({ ...options, touchpoints: {} }, { application: "Moodle", validateEntry: routes }), /^Error: Moodle client requires at least one touchpoint$/);
  assert.throws(() => clientBindings({ ...options, entries: { course: "https://elsewhere" } }, { application: "Moodle", validateEntry: routes }), /Route course must be relative/);
  assert.throws(() => clientBindings({ ...options, transitionValues: { bad: { source: "user.email" as never } } }, { application: "Moodle", validateEntry: routes }), /Invalid Moodle transition value source for bad/);
  const bindings = clientBindings(options, { application: "Moodle", validateEntry: routes });
  assert.throws(() => bindingForOperation(bindings, { ...operation, actorId: "teacher" }), /No Moodle user for teacher/);
});

test("plugin options parse into bindings, and every operation must be configured before startup", () => {
  const raw = { touchpoints: { campus: { baseURL: "https://moodle.example" } }, users: { learner: { username: "learner", password: "secret", label: "Learner" } }, entries: { course: "/course" }, transitionValues: { login: { source: "user.username" } } };
  assert.deepEqual(parseClientBindings(raw), { touchpoints: raw.touchpoints, users: raw.users, transitionValues: raw.transitionValues });
  validateConfiguredOperations(raw, [operation]);
  assert.throws(() => validateConfiguredOperations(raw, [{ ...operation, touchpointId: "mobile" }]), /Missing touchpoint mobile/);
});
