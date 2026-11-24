export const journeyMeshPlugin = {
  kind: "executor-observer", observationContract: { id: "fixture" }, parse() {},
  create(_settings, context) {
    return { observer: {}, async output({ result }) {
      await context.artifacts.write({ name: "fixture-evidence.txt", data: "fixture observation", contentType: "text/plain", format: "fixture/evidence" });
      return { id: "fixture", kind: "fixture", measurements: [], evidence: { runId: result.runId, message: "fixture observation" }, errors: [] };
    } };
  }
};
