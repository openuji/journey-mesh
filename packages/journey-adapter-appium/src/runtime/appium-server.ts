import { createRequire } from "node:module";
import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Capture, Foreground } from "./process.js";

const require = createRequire(import.meta.url);

/**
 * appium's package.json declares `"bin": { "appium": "index.js" }` but
 * `"main": "./build/lib/main.js"` — the CLI (server + `driver` subcommands)
 * lives at the bin entry, not main. appium declares no `exports` map, so an
 * arbitrary subpath like this resolves through plain Node resolution.
 */
export function resolveAppiumEntry(): string {
  return require.resolve("appium/index.js");
}

/** `--source=local` installs from a directory; appium-uiautomator2-driver explicitly exports its own package.json. */
export function resolveUiAutomator2DriverSource(): string {
  return dirname(require.resolve("appium-uiautomator2-driver/package.json"));
}

/** This package's own declared pins are the single source of truth — no separate manifest to drift. */
export async function ownAutomationVersions(): Promise<{ appium: string; uiautomator2: string }> {
  const packageJsonPath = require.resolve("../../package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as { dependencies?: Record<string, string> };
  const appium = packageJson.dependencies?.appium;
  const uiautomator2 = packageJson.dependencies?.["appium-uiautomator2-driver"];
  if (!appium || !uiautomator2) throw new Error(`${packageJsonPath} is missing its appium/appium-uiautomator2-driver pins`);
  return { appium, uiautomator2 };
}

/**
 * Installs the pinned UiAutomator2 driver into appiumHome if it's missing,
 * and rejects a mismatched install. `capture`/`foreground` must already be
 * bound to an environment with APPIUM_HOME=appiumHome.
 */
export async function ensureUiAutomator2Driver({ appiumHome, capture, foreground }: {
  appiumHome: string; capture: Capture; foreground: Foreground;
}): Promise<void> {
  await mkdir(appiumHome, { recursive: true });
  const { uiautomator2 } = await ownAutomationVersions();
  const appium = resolveAppiumEntry();
  const driverSource = resolveUiAutomator2DriverSource();
  const installed = JSON.parse((await capture(process.execPath, [appium, "driver", "list", "--installed", "--json"], { timeout: 60_000 })).stdout) as {
    uiautomator2?: { version: string };
  };
  const driver = installed.uiautomator2;
  if (driver && driver.version !== uiautomator2) {
    throw new Error(`APPIUM_HOME contains UiAutomator2 ${driver.version}; expected ${uiautomator2}`);
  }
  if (!driver) await foreground(process.execPath, [appium, "driver", "install", "--source=local", driverSource]);
}
