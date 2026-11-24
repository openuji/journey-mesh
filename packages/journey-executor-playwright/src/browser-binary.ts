import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { chromium } from "playwright";

const exec = promisify(execFile);
let ensured: Promise<void> | undefined;

/**
 * Playwright does not auto-download browser binaries; chromium.launch()
 * throws a clear but unactionable-without-a-terminal error if they're
 * missing. This installs Chromium once per process, lazily, so running a
 * journey never requires a separate manual `playwright install` step.
 *
 * playwright's package.json declares an `exports` map that does not list
 * "./cli.js", so that subpath can't be resolved directly; its "./package.json"
 * subpath IS exported, so the CLI entry is found via its own `bin` field.
 */
export function ensureChromiumInstalled(): Promise<void> {
  ensured ??= installChromiumOnce();
  return ensured;
}

async function installChromiumOnce(): Promise<void> {
  if (existsSync(chromium.executablePath())) return;
  const packageJsonPath = createRequire(import.meta.url).resolve("playwright/package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as { bin?: Record<string, string> };
  const cli = packageJson.bin?.playwright;
  if (!cli) throw new Error("Could not locate the playwright CLI entry to install Chromium");
  await exec(process.execPath, [resolve(dirname(packageJsonPath), cli), "install", "chromium"], { maxBuffer: 16 * 1024 * 1024 });
}
