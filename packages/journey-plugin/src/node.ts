/** Node-only resource ports. Never re-exported from the browser-safe plugin entry. */
import { createHash, randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { closeSync, openSync } from "node:fs";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

export function ownershipPath(configPath: string, componentId: string): string {
  return resolve(dirname(configPath), ".runtime/services", createHash("sha256").update(configPath + "\0" + componentId).digest("hex").slice(0, 24) + ".json");
}
export async function readJsonRecord<T>(path: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(path, "utf8")) as T; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}
export async function writeJsonRecord(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, JSON.stringify(value) + "\n", { mode: 0o600 }); await rename(temporary, path); }
  finally { await rm(temporary, { force: true }); }
}
export async function removeOwnership(path: string): Promise<void> { await rm(path, { force: true }); }

export type ProcessOptions = Readonly<{ cwd?: string; env?: NodeJS.ProcessEnv; signal?: AbortSignal; timeoutMs?: number; graceMs?: number; killWaitMs?: number; input?: string; stdoutOnly?: boolean; onOutput?: (data: string) => void }>;
/** Own a detached process group. Cancellation is bounded even when the child ignores SIGTERM. */
export async function runOwnedProcess(command: string, args: readonly string[], options: ProcessOptions = {}): Promise<string> {
  options.signal?.throwIfAborted();
  const child = spawn(command, [...args], { cwd: options.cwd, env: options.env, detached: true, stdio: ["pipe", "pipe", "pipe"] });
  child.stdin.end(options.input);
  child.stdin.on("error", () => {});
  let stdout = "";
  let output = "";
  const collect = (data: Buffer) => { const text = String(data); output = (output + text).slice(-2_000_000); options.onOutput?.(text); };
  child.stdout.on("data", (data: Buffer) => { stdout = (stdout + data).slice(-2_000_000); collect(data); }); child.stderr.on("data", collect);
  const closed = new Promise<number | null>((accept, reject) => { child.once("error", reject); child.once("close", accept); });
  const controller = new AbortController();
  const abort = () => controller.abort(options.signal?.reason ?? new Error("Process interrupted"));
  options.signal?.addEventListener("abort", abort, { once: true });
  const timeout = options.timeoutMs === undefined ? undefined : setTimeout(() => controller.abort(new Error(`${command} timed out`)), options.timeoutMs);
  let stopListener: (() => void) | undefined;
  const stopped = new Promise<never>((_accept, reject) => {
    stopListener = () => reject(controller.signal.reason);
    controller.signal.addEventListener("abort", stopListener, { once: true });
  });
  try {
    if (options.signal?.aborted) abort();
    const code = await Promise.race([closed, stopped]);
    if (code !== 0) throw new Error(`${command} exited with ${code}: ${output.slice(-8000)}`);
    return (options.stdoutOnly ? stdout : output).trim();
  } catch (error) {
    if (controller.signal.aborted) {
      try {
        if (child.pid) await stopProcessGroup(child.pid, { graceMs: options.graceMs, killWaitMs: options.killWaitMs });
      } catch (cleanup) { throw new AggregateError([error, cleanup], `Process cancellation failed: ${String(error)}; ${String(cleanup)}`); }
    }
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
    if (stopListener) controller.signal.removeEventListener("abort", stopListener);
  }
}

/** Turns output chunks into whole, non-blank lines without terminal escape codes. `flush` delivers an unterminated last line. */
export function lineReader(onLine: (line: string) => void): Readonly<{ write(chunk: string): void; flush(): void }> {
  let rest = "";
  const deliver = (raw: string) => {
    const line = raw.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "").trimEnd();
    if (line) onLine(line);
  };
  return Object.freeze({
    write(chunk: string) { const lines = (rest + chunk).split(/\r?\n|\r/); rest = lines.pop()!; lines.forEach(deliver); },
    flush() { deliver(rest); rest = ""; }
  });
}

const errorCode = (error: unknown) => (error as NodeJS.ErrnoException).code;

/** EPERM means the group exists but a member cannot be signalled (macOS reports this for a zombie member), so it counts as alive. */
function processGroupAlive(pid: number): boolean {
  try { process.kill(-pid, 0); return true; }
  catch (error) { if (errorCode(error) === "ESRCH") return false; if (errorCode(error) === "EPERM") return true; throw error; }
}

/** Signals the group; when a member refuses the group signal, signals the leader alone. Returns false when nothing could be signalled. */
function signalGroup(pid: number, signal: NodeJS.Signals): boolean {
  for (const target of [-pid, pid]) {
    try { process.kill(target, signal); return true; }
    catch (error) { if (errorCode(error) !== "ESRCH" && errorCode(error) !== "EPERM") throw error; }
  }
  return false;
}

/** Stop an already-verified group, including descendants whose leader has exited. */
export async function stopProcessGroup(pid: number, {
  graceMs = 5000,
  killWaitMs = 5000
}: Readonly<{
  graceMs?: number;
  killWaitMs?: number;
}> = {}): Promise<void> {
  for (const [name, waitMs] of [["SIGTERM", graceMs], ["SIGKILL", killWaitMs]] as const) {
    if (!processGroupAlive(pid)) return;
    signalGroup(pid, name);
    for (let elapsed = 0; elapsed < waitMs && processGroupAlive(pid); elapsed += 100) await delay(Math.min(100, waitMs - elapsed));
  }
  if (processGroupAlive(pid)) throw new Error(`Process group ${pid} did not stop after SIGKILL; the operating system refuses to signal it (EPERM) or it is stuck`);
}

export type TextPublication = Readonly<{ path: string; content: string; previous?: string }>;
/** Compatibility env files are published at the service boundary, with restoration on release. */
export async function publishText(path: string, content: string): Promise<TextPublication> {
  const previous = await readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return undefined; throw error; });
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, content, { mode: 0o600 }); await rename(temporary, path); }
  finally { await rm(temporary, { force: true }); }
  return Object.freeze({ path, content, ...(previous === undefined ? {} : { previous }) });
}
export async function releaseText(publication: TextPublication): Promise<void> {
  const current = await readFile(publication.path, "utf8").catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return undefined; throw error; });
  if (current !== publication.content) return;
  if (publication.previous === undefined) await rm(publication.path, { force: true });
  else await publishText(publication.path, publication.previous);
}

/** Detached background process acquisition; startup errors are observed before returning ownership. */
export async function spawnOwnedProcess(command: string, args: readonly string[], options: { cwd: string; env: NodeJS.ProcessEnv; logPath: string }): Promise<Readonly<{ pid: number }>> {
  const output = openSync(options.logPath, "a", 0o600);
  try {
    const child = spawn(command, [...args], { cwd: options.cwd, env: options.env, detached: true, stdio: ["ignore", output, output] });
    await new Promise<void>((accept, reject) => { child.once("spawn", accept); child.once("error", reject); });
    child.unref();
    return Object.freeze({ pid: child.pid! });
  } finally { closeSync(output); }
}
