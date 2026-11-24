// An adapter with a discovery mode: in a discovery run every state it reaches is reported as a finding.
const adapter = (name, onState) => ({
  name,
  createExecution({ context: execution }) {
    return {
      start() {}, openEntry() {}, performTransition() {}, recordControlFlow() {}, close() {},
      async assertState(operation) { await onState?.(execution, operation); }
    };
  }
});

export const journeyMeshPlugin = {
  kind: "adapter", automation: { id: "fixture" },
  parse(options) { return options; },
  create(options) { return adapter(options.name); },
  discovery: {
    create(options, context, dependencies, { rediscover, findings }) {
      return adapter(options.name, (execution, operation) => findings.record({
        profileId: execution.profile.id, operationId: operation.id, transitionId: operation.state.id, modalityId: "fixture", status: "found", steps: [],
        note: JSON.stringify({ mode: context.mode, rediscover, observers: dependencies.observers.length })
      }));
    }
  }
};
