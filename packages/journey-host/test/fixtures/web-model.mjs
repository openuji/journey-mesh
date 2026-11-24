// A one-state Web journey a browser executor can validate: the page's main landmark is observable.
export const journeyMeshPlugin = {
  kind: "model",
  parse() {},
  create() {
    return {
      resolveOperation(plan, selector) { const operation = plan.operations.find((op) => op.id === selector); if (!operation) throw new Error("Unknown fixture operation"); return operation; },
      async compile(_source, selection) {
        const binding = { id: "main-binding", surfaceId: "course", eventId: "presence", requiredInputModalityProfiles: [], locators: [{ id: "main", role: "main", features: [], contexts: [] }] };
        return { id: "web-plan", operations: [{
          id: `${selection}-arrival`, sequence: 0, kind: "state", actorId: selection, touchpointId: "campus",
          entry: { id: "entry", stateId: "course" }, entryBinding: { id: "entry-binding", value: "2" },
          state: { id: "course" }, surface: { id: "course" },
          target: { expectedMatchCount: 1, bindings: [binding], observation: { stateId: "course", surfaceId: "course", expectedMatchCount: 1, bindings: [binding] } }
        }] };
      }
    };
  }
};
