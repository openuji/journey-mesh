import { appendFile, readFile } from "node:fs/promises";

const json = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
const runtime = await json("./runtime.json");
const example = await json("../package.json");
const adapter = await json("../../../packages/journey-adapter-appium/package.json");
const declared = {
  appium: example.devDependencies.appium,
  uiautomator2: example.devDependencies["appium-uiautomator2-driver"],
  webdriverio: adapter.dependencies.webdriverio
};
for (const [name, version] of Object.entries(declared)) {
  if (runtime.automation[name] !== version) throw new Error(`Android runtime pin ${name} differs from package.json: ${runtime.automation[name]} / ${version}`);
}
if (!runtime.android.avd) throw new Error("Android runtime manifest requires a managed AVD name");
for (const image of [runtime.android.image, ...Object.values(runtime.android.localImages ?? {})]) {
  const [kind, platform, target, arch, extra] = image.split(";");
  if (kind !== "system-images" || platform !== `android-${runtime.android.api}` || !target || !arch || extra !== undefined) {
    throw new Error("Android runtime API level and system image disagree");
  }
}
if (runtime.android.locale !== "en-US") throw new Error("The checked-in Android UI bindings require en-US");
if (process.argv.includes("--github-output")) {
  if (!process.env.GITHUB_OUTPUT) throw new Error("--github-output requires GITHUB_OUTPUT");
  const [, , target, arch] = runtime.android.image.split(";");
  await appendFile(process.env.GITHUB_OUTPUT, [
    `api-level=${runtime.android.api}`, `target=${target}`, `arch=${arch}`, `profile=${runtime.android.profile}`, ""
  ].join("\n"));
}
console.log("Android runtime manifest matches the pinned dependencies and system image.");
