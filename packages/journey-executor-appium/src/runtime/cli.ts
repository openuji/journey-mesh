import { spawn } from "node:child_process";
import { resolve } from "node:path";
import {
  ensureUiAutomator2Driver, ensureXcuitestDriver,
  ownAutomationVersions, ownXcuitestAutomationVersions, resolveAppiumEntry
} from "./appium-server.js";
import { defaultCapture, defaultForeground } from "./process.js";
import { runCommand, type CliDefinition } from "@openuji/journey-plugin/cli";

/** The command-line contract; its help is committed as contract/journey-executor-appium.help.txt. */
export const cli: CliDefinition = {
  program: "journey-executor-appium",
  commands: {
    "appium serve": {
      arguments: [], options: { "--address": { value: "<addr>", default: "127.0.0.1" }, "--port": { value: "<port>", default: "4723" }, "--log": { value: "<path>" } },
      description: ["Run the Appium server in the foreground, for a caller that owns its process lifecycle, such as CI. With --log, debug output goes to that file."]
    },
    "appium ensure-driver": {
      arguments: [], options: { "--driver": { value: "<uiautomator2|xcuitest>", default: "uiautomator2" } },
      description: ["Install the pinned UiAutomator2 or XCUITest driver into APPIUM_HOME (default: a driver-specific, version-keyed directory under .tmp/) if it is missing."]
    }
  },
  notes: ["To keep Appium running across tests, use the configured service instead:", "  journey-mesh services up|down <config.yaml> --service appium"],
  exits: { 0: "Success.", 1: "The command failed.", 2: "Invalid arguments." }
};

async function serve(options: Readonly<Record<string, string>>): Promise<void> {
  const appium = resolveAppiumEntry();
  const address = options["--address"];
  const port = options["--port"];
  const args = [appium, "--address", address, "--port", port, "--log-level", options["--log"] ? "warn:debug" : "warn", ...(options["--log"] ? ["--log", options["--log"]] : [])];
  await new Promise<void>((done, reject) => {
    const child = spawn(process.execPath, args, { stdio: "inherit", env: process.env });
    let stopping = false;
    const forward = (signal: NodeJS.Signals) => { stopping = true; child.kill(signal); };
    process.once("SIGTERM", () => forward("SIGTERM"));
    process.once("SIGINT", () => forward("SIGINT"));
    child.once("error", reject);
    child.once("exit", (code, signal) => (code === 0 || stopping) ? done() : reject(new Error(`appium exited with ${code ?? signal}`)));
  });
}

async function ensureDriver(options: Readonly<Record<string, string>>): Promise<void> {
  const driver = options["--driver"];
  if (driver !== "uiautomator2" && driver !== "xcuitest") {
    throw new Error(`Unsupported Appium driver ${driver}; expected uiautomator2 or xcuitest`);
  }
  const appiumHome = process.env.APPIUM_HOME ?? await defaultAppiumHome(driver);
  const env = { ...process.env, APPIUM_HOME: appiumHome };
  const ports = { appiumHome, capture: defaultCapture(env, process.cwd()), foreground: defaultForeground(env, process.cwd()) };
  if (driver === "xcuitest") await ensureXcuitestDriver(ports);
  else await ensureUiAutomator2Driver(ports);
}

async function defaultAppiumHome(driver: "uiautomator2" | "xcuitest"): Promise<string> {
  if (driver === "xcuitest") {
    const { appium, xcuitest } = await ownXcuitestAutomationVersions();
    return resolve(process.cwd(), `.tmp/appium-${appium}-xcuitest-${xcuitest}`);
  }
  const { appium, uiautomator2 } = await ownAutomationVersions();
  return resolve(process.cwd(), `.tmp/appium-${appium}-${uiautomator2}`);
}

export async function main(args: readonly string[]): Promise<number> {
  return runCommand(cli, args, async ({ name, options }) => {
    if (name === "appium serve") await serve(options);
    else await ensureDriver(options);
  });
}
