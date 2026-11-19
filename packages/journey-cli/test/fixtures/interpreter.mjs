/** A report interpreter for the host's fixture observer: it derives data and node metrics, or fails on request. */
export const journeyMeshInterpreter = {
  kind: "fixture",
  parse: (options) => options,
  interpret({ test, output }, settings) {
    if (settings.fail) throw new Error("Fixture interpretation failure");
    return {
      nodes: test.result.evidence.executions.flatMap((execution) => execution.operations.map((operation) => ({ executionId: execution.executionId, operationId: operation.operationId, metrics: { kind: "fixture", observed: true } }))),
      data: [{ name: "fixture.json", format: "fixture/derived", label: "Fixture report", value: { message: output.evidence.message } }]
    };
  }
};
