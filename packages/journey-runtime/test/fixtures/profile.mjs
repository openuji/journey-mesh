// Minimal profile plugin used by the runtime integration suite.
export const journeyMeshPlugin = {
  apiVersion: 1, kind: "profile", validate() {},
  create() { return { id: "fixture-profile" }; }
};
