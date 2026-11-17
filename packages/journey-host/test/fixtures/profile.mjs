// Minimal profile plugin used by the runtime integration suite.
export const journeyMeshPlugin = {
  kind: "profile", parse() {},
  create() { return { id: "fixture-profile" }; }
};
