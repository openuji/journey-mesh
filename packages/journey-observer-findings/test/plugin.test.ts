import assert from "node:assert/strict";
import test from "node:test";
import type { JourneyConfigContext } from "@openuji/journey-plugin";
import { journeyMeshPlugin } from "../src/plugin.js";

const context = { configPath: "/mesh.yaml", testId: "t", operations: [], env: {}, resolvePath: (path: string) => path, resolveOperation: () => { throw new Error("unused"); } } as unknown as JourneyConfigContext;

test("the observer needs nothing but its output id: findings come from the model", async () => {
  assert.deepEqual(await journeyMeshPlugin.parse({}, context), { id: "findings" });
  assert.deepEqual(await journeyMeshPlugin.parse({ id: "failures" }, context), { id: "failures" });
});

test("a findings file is not an option: nothing is declared next to the model", async () => {
  await assert.rejects(async () => journeyMeshPlugin.parse({ findings: "findings.yaml" }, context), /findings/);
});
