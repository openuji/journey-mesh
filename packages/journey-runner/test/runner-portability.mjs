import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createContext, SourceTextModule } from "node:vm";
import ts from "typescript";

// The loader runs in Node; the runner's own module graph has neither Node
// builtins nor process/Buffer/require globals available.
const context = createContext({ performance });
const modules = new Map();

async function loadModule(url) {
  if (modules.has(url.href)) return modules.get(url.href);
  const source = await readFile(url, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
  });
  const module = new SourceTextModule(outputText, { context, identifier: url.href });
  modules.set(url.href, module);
  return module;
}

const entry = await loadModule(new URL("../src/index.ts", import.meta.url));
await entry.link((specifier, referencingModule) => {
  assert.ok(specifier.startsWith("."), `Runner requires an external runtime import: ${specifier}`);
  return loadModule(new URL(specifier.replace(/\.js$/, ".ts"), referencingModule.identifier));
});
await entry.evaluate();

const modality = { id: "portable:activate" };
const modalityProfile = { id: "portable:input", modalities: [modality] };
const vertex = { id: "portable:state", type: "State" };
const surface = { id: "portable:surface" };
const base = {
  actorId: "portable:actor", touchpointId: "portable:touchpoint",
  entry: { id: "portable:entry", stateId: vertex.id },
  entryBinding: { id: "portable:entry-binding", value: "opaque-entry" }
};
const effect = { id: "portable:effect", producedRefs: [], consumedRefs: [], produced: [], consumed: [] };
const input = {
  ...base, id: "input", kind: "transition", surface, from: vertex, to: vertex,
  transition: { id: "portable:transition", from: vertex.id, to: vertex.id },
  activation: {
    transitionId: "portable:transition", eventId: "portable:activate", surfaceId: surface.id,
    from: vertex, to: vertex, requiredInputModalityProfiles: [modalityProfile], bindings: []
  },
  effects: [effect]
};
const automatic = {
  ...input, id: "automatic", effects: [],
  activation: { ...input.activation, requiredInputModalityProfiles: [] }
};
const plan = {
  id: "portable-plan", operations: [
    {
      ...base, id: "state", kind: "state", state: vertex, surface,
      target: {
        expectedMatchCount: 0, bindings: [],
        observation: { stateId: vertex.id, surfaceId: surface.id, expectedMatchCount: 0, bindings: [] }
      }
    },
    input, automatic,
    { ...base, id: "control", kind: "control-flow", transition: { id: "portable:flow", from: vertex.id, to: vertex.id } }
  ]
};

async function exercise(failTransition) {
  const calls = [];
  const progress = [];
  const result = await entry.namespace.runJourney({
    runId: failTransition ? "portable-failure" : "portable-success",
    plan,
    profiles: [{
      id: "portable-profile",
      selectInputModality(operation, execution) {
        assert.equal(operation, input);
        calls.push("select");
        return { profileId: execution.profile.id, inputModalityProfile: modalityProfile, modality };
      }
    }],
    progress: [{ publish(event) { progress.push(event.type); } }],
    environment: {
      setup() { calls.push("setup"); },
      verifyEffect(verification) {
        assert.equal(verification.effect, effect);
        assert.equal(verification.decision.modality.id, modality.id);
        calls.push("effect");
      },
      teardown({ executionFailed }) { calls.push(`teardown:${executionFailed}`); }
    },
    adapter: {
      name: "portable-adapter",
      createExecution() {
        return {
          start() { calls.push("start"); },
          openEntry() { calls.push("entry"); },
          assertState() { calls.push("state"); },
          performTransition(operation, decision) {
            calls.push(operation.id);
            if (operation === input) {
              assert.equal(decision.modality.id, modality.id);
              if (failTransition) throw new Error("Portable transition failed");
            } else {
              assert.equal(decision, undefined);
            }
          },
          recordControlFlow() { calls.push("control"); },
          close({ executionFailed }) { calls.push(`close:${executionFailed}`); }
        };
      }
    }
  });
  return { result, calls, progress };
}

const passed = await exercise(false);
assert.equal(passed.result.ok, true, JSON.stringify(passed.result.errors));
assert.deepEqual(passed.calls, ["setup", "start", "entry", "state", "select", "input", "effect", "automatic", "control", "close:false", "teardown:false"]);
assert.equal(passed.progress.filter((event) => event === "operation-completed").length, 4);
assert.equal(passed.result.evidence.executions[0].operations.length, 4);
assert.equal(passed.result.evidence.executions[0].operations[1].adapter.name, "portable-adapter");
assert.ok(Object.isFrozen(passed.result.evidence.executions[0].operations));

const failed = await exercise(true);
assert.equal(failed.result.ok, false);
assert.match(failed.result.errors[0].message, /Portable transition failed/);
assert.deepEqual(failed.calls, ["setup", "start", "entry", "state", "select", "input", "close:true", "teardown:true"]);
assert.ok(failed.progress.includes("operation-failed"));
assert.equal(failed.result.evidence.executions[0].operations[1].outcome.kind, "failed");
