import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const runtime = JSON.parse(await readFile(new URL("./runtime.json", import.meta.url), "utf8"));
const directory = new URL("../.android/", import.meta.url);
const target = new URL(runtime.nextcloud.apk, directory);
const digest = (data) => createHash("sha256").update(data).digest("hex");
await mkdir(directory, { recursive: true });
const existing = await readFile(target).catch(() => undefined);
if (!existing || digest(existing) !== runtime.nextcloud.sha256) {
  const response = await fetch(runtime.nextcloud.url);
  if (!response.ok) throw new Error(`APK download failed: HTTP ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (digest(data) !== runtime.nextcloud.sha256) throw new Error("APK checksum does not match the pinned runtime manifest");
  const temporary = new URL(`${runtime.nextcloud.apk}.partial`, directory);
  try { await writeFile(temporary, data); await rename(temporary, target); }
  finally { await rm(temporary, { force: true }); }
}
console.log(fileURLToPath(target));
