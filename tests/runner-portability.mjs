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

const entry = await loadModule(new URL("../packages/journey-runner/src/index.ts", import.meta.url));
await entry.link((specifier, referencingModule) => {
  assert.ok(specifier.startsWith("."), `Runner requires an external runtime import: ${specifier}`);
  return loadModule(new URL(specifier.replace(/\.js$/, ".ts"), referencingModule.identifier));
});
await entry.evaluate();

const calls = [];
const result = await entry.namespace.runJourney({
  plan: { id: "portable-plan", operations: [] },
  profiles: [{ id: "portable-profile" }],
  environment: {
    setup() { calls.push("setup"); },
    teardown() { calls.push("teardown"); }
  },
  adapter: {
    name: "portable-adapter",
    createExecution() {
      return {
        start() { calls.push("start"); },
        close() { calls.push("close"); }
      };
    }
  }
});
assert.equal(result.ok, true, JSON.stringify(result.errors));
assert.deepEqual(calls, ["setup", "start", "close", "teardown"]);
