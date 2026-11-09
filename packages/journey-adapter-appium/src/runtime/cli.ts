import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { ensureUiAutomator2Driver, ownAutomationVersions, resolveAppiumEntry } from "./appium-server.js";
import { defaultCapture, defaultForeground } from "./process.js";

const help = `Usage:
  journey-adapter-appium appium serve [--address <addr>] [--port <port>] [--log <path>]
  journey-adapter-appium appium ensure-driver

serve runs the Appium server in the foreground (for a caller that owns its own
process lifecycle, e.g. CI). ensure-driver installs the pinned UiAutomator2
driver into APPIUM_HOME (or a version-keyed default under .tmp/) if missing.
Neither command manages the long-running appium:up/appium:down state file;
use "journey-mesh runtime up|down <config.yaml> --runtime appium" for that.`;

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
  const args = [appium, "--address", address, "--port", port, "--log-level", "warn", ...(flags.log ? ["--log", flags.log] : [])];
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
  if (!args.length || args.includes("--help")) { console.log(help); return 0; }
  const [group, action, ...flags] = args;
  try {
    if (group !== "appium" || !["serve", "ensure-driver"].includes(action ?? "")) throw new Error(help);
    if (action === "serve") await serve(parseFlags(flags));
    else await ensureDriver();
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "journey-adapter-appium failed");
    return 1;
  }
}
