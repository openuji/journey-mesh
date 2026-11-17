export const journeyMeshPlugin = {
  kind: "reporter", parse: (options) => options,
  create(options) { return { name: "fixture/report", async report({ bundle, artifacts }) {
    await artifacts.write({ name: "fixture-evidence.txt", data: JSON.stringify(bundle.outputs), contentType: "text/plain" });
    if (options.fail) throw new Error("Fixture report failure");
  } }; }
};
