import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { ensureUiAutomator2Driver, ownAutomationVersions, resolveAppiumEntry } from "./appium-server.js";
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
      arguments: [],
      description: ["Install the pinned UiAutomator2 driver into APPIUM_HOME (default: a version-keyed directory under .tmp/) if it is missing."]
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
    // This wrapper is itself a spawned Node process (via tsx), not the
    // appium server directly — a caller like run-ci.sh signals *this*
    // process (its `$!`), which by default would exit without the deeper
    // appium process ever seeing the signal. Forward it explicitly, and
    // treat an exit we requested as success regardless of its code/signal.
    let stopping = false;
    const forward = (signal: NodeJS.Signals) => { stopping = true; child.kill(signal); };
    process.once("SIGTERM", () => forward("SIGTERM"));
    process.once("SIGINT", () => forward("SIGINT"));
    child.once("error", reject);
    child.once("exit", (code, signal) => (code === 0 || stopping) ? done() : reject(new Error(`appium exited with ${code ?? signal}`)));
  });
}

async function ensureDriver(): Promise<void> {
  const appiumHome = process.env.APPIUM_HOME ?? await defaultAppiumHome();
  const env = { ...process.env, APPIUM_HOME: appiumHome };
  await ensureUiAutomator2Driver({
    appiumHome,
    capture: defaultCapture(env, process.cwd()),
    foreground: defaultForeground(env, process.cwd())
  });
}

async function defaultAppiumHome(): Promise<string> {
  const { appium, uiautomator2 } = await ownAutomationVersions();
  return resolve(process.cwd(), `.tmp/appium-${appium}-${uiautomator2}`);
}

export async function main(args: readonly string[]): Promise<number> {
  return runCommand(cli, args, async ({ name, options }) => {
    if (name === "appium serve") await serve(options);
    else await ensureDriver();
  });
}
