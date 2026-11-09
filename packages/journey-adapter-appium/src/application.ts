import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

function digest(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Downloads the APK to `path` if it's missing or its checksum doesn't match,
 * idempotently — exactly like `ensureChromiumInstalled` for Playwright's
 * browser binary. Callers that already verified `path` has a matching
 * checksum pay only the cost of one hash over the cached file.
 */
export async function ensureApk({ path, url, sha256 }: { path: string; url: string; sha256: string }): Promise<void> {
  const existing = await readFile(path).catch(() => undefined);
  if (existing && digest(existing) === sha256) return;
  await mkdir(dirname(path), { recursive: true });
  const response = await fetch(url);
  if (!response.ok) throw new Error(`APK download failed: HTTP ${response.status}`);
  const data = new Uint8Array(await response.arrayBuffer());
  if (digest(data) !== sha256) throw new Error("APK checksum does not match the pinned configuration");
  const temporary = `${path}.partial`;
  try { await writeFile(temporary, data); await rename(temporary, path); }
  finally { await rm(temporary, { force: true }); }
}
