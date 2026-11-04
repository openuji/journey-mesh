export const journeyMeshPlugin = {
  apiVersion: 1, kind: "observer", runtime: "fixture", validate() {},
  create(options, context) {
    return { observer: {}, reporter: { name: "fixture/report", async report() {
      await context.artifacts.write({ name: "fixture-evidence.txt", data: "fixture observation", contentType: "text/plain" });
      if (options.fail) throw new Error("Fixture report failure");
    } } };
  }
};
