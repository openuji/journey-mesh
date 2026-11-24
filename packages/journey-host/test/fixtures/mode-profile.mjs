// A profile that can only be built in a discovery run, so a test can see the run mode reach profiles.
export const journeyMeshPlugin = {
  kind: "profile", parse() {},
  create(_settings, context) {
    if (context.mode !== "discovery") throw new Error("profile built outside a discovery run");
    return { id: "discovery-profile" };
  }
};
