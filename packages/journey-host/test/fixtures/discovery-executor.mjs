// An executor with a discovery mode: in a discovery run every state it reaches is reported as a finding.
const executor = (name, onState) => ({
  name,
  createSession({ context: execution }) {
    return {
      start() {}, openEntry() {}, performTransition() {}, recordControlFlow() {}, close() {},
      async assertState(operation) { await onState?.(execution, operation); }
    };
  }
});

export const journeyMeshPlugin = {
  kind: "executor", observationContract: { id: "fixture" },
  parse(options) { return options; },
  create(options) { return executor(options.name); },
  discovery: {
    create(options, context, dependencies, { rediscover, findings }) {
      return executor(options.name, (execution, operation) => findings.record({
        profileId: execution.profile.id, operationId: operation.id, transitionId: operation.state.id, modalityId: "fixture", status: "found", steps: [],
        note: JSON.stringify({ mode: context.mode, rediscover, observers: dependencies.observers.length })
      }));
    }
  }
};
