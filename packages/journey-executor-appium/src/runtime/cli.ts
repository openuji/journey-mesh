import { spawn } from "node:child_process";
import { resolve } from "node:path";
import {
  ensureUiAutomator2Driver, ensureXcuitestDriver,
  ownAutomationVersions, ownXcuitestAutomationVersions, resolveAppiumEntry
} from "./appium-server.js";
import { defaultCapture, defaultForeground } from "./process.js";

const help = `Usage:
  journey-executor-appium appium serve [--address <addr>] [--port <port>] [--log <path>]
  journey-executor-appium appium ensure-driver [--driver <uiautomator2|xcuitest>]

serve runs the Appium server in the foreground (for a caller that owns its own
process lifecycle, e.g. CI). ensure-driver installs the pinned UiAutomator2 or
XCUITest driver into APPIUM_HOME (or a version-keyed default under .tmp/) if missing.`;

function parseFlags(args: readonly string[]): Record<string, string> {
  const options: Record<string, string> = {};
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    if (!argument.startsWith("--")) throw new Error(`Unknown option ${argument}`);
    const value = args[++index];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}`);
    options[argument.slice(2)] = value;
  }
  return options;
}

async function serve(flags: Record<string, string>): Promise<void> {
  const appium = resolveAppiumEntry();
  const address = flags.address ?? "127.0.0.1";
  const port = flags.port ?? "4723";
  const args = [appium, "--address", address, "--port", port, "--log-level", flags.log ? "warn:debug" : "warn", ...(flags.log ? ["--log", flags.log] : [])];
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

async function ensureDriver(flags: Record<string, string>): Promise<void> {
  const driver = flags.driver ?? "uiautomator2";
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
  if (!args.length || args.includes("--help")) { console.log(help); return 0; }
  const [group, action, ...flags] = args;
  try {
    if (group !== "appium" || !["serve", "ensure-driver"].includes(action ?? "")) throw new Error(help);
    const parsed = parseFlags(flags);
    if (action === "serve") await serve(parsed);
    else await ensureDriver(parsed);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "journey-executor-appium failed");
    return 1;
  }
}
