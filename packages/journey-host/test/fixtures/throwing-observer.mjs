/** Records every operation it is shown; with `throws`, it then fails. */
export const journeyMeshPlugin = {
  kind: "executor-observer", observationContract: { id: "fixture" }, parse(options) { return options; },
  create(options) {
    const seen = [];
    return {
      observer: {
        async observeOperation({ operationId }) {
          seen.push(operationId);
          if (options.throws) throw new Error("observer broke");
        }
      },
      output: () => ({ id: options.id, kind: "fixture", measurements: [], evidence: { seen }, errors: [] })
    };
  }
};
