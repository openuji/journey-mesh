import { readFile } from "node:fs/promises";

export const journeyMeshPlugin = {
  apiVersion: 1, kind: "model",
  validate() {},
  create() { return { async compile(source, selection) {
    const data = JSON.parse(await readFile(source, "utf8"));
    if (!data.journeys.includes(selection)) throw new Error("Unknown fixture journey");
    return {
      id: "fixture-plan", source: { model: "fixture", documentId: source },
      operations: [{
        id: "same-operation-id", sequence: 0, kind: "state",
        actorId: "same-actor", touchpointId: "same-touchpoint",
        entry: { id: "same-entry", stateId: selection }, entryBinding: { id: "same-binding", value: "same-value" },
        state: { id: selection }, surface: { id: `${selection}-surface` },
        source: { references: { graphNodeId: selection, stepId: `${selection}-step` } },
        target: { expectedMatchCount: 0, bindings: [], observation: { stateId: selection, surfaceId: `${selection}-surface`, expectedMatchCount: 0, bindings: [] } }
      }]
    };
  } }; }
};
