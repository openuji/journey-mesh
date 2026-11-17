export const journeyMeshPlugin = {
  kind: "observer", automation: { id: "fixture" }, parse() {},
  create() {
    return { observer: {}, output({ result }) { return { id: "fixture", kind: "fixture", measurements: [], evidence: { runId: result.runId, message: "fixture observation" }, errors: [] }; } };
  }
};
