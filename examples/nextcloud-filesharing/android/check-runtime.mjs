import { appendFile, readFile } from "node:fs/promises";

const json = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
const runtime = await json("./runtime.json");
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
console.log("Android runtime manifest's API level and system image agree.");
