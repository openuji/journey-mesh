import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export type CaptureResult = { stdout: string; stderr: string; failed?: boolean };
export type Capture = (command: string, args: readonly string[], options?: { optional?: boolean; timeout?: number }) => Promise<CaptureResult>;
export type Foreground = (command: string, args: readonly string[]) => Promise<void>;

export function defaultCapture(environment: NodeJS.ProcessEnv, cwd: string): Capture {
  return async (command, args, { optional = false, timeout = 30_000 } = {}) => {
    try { return await exec(command, args, { cwd, env: environment, timeout, maxBuffer: 4 * 1024 * 1024 }); }
    catch (error) {
      const err = error as NodeJS.ErrnoException & { stderr?: string };
      if (optional) return { stdout: "", stderr: String(err.stderr ?? ""), failed: true };
      throw new Error(`${command} failed${err.code === "ENOENT" ? " (command not found)" : ""}: ${String(err.stderr || err.message).trim()}`);
    }
  };
}

export function defaultForeground(environment: NodeJS.ProcessEnv, cwd: string): Foreground {
  return (command, args) => new Promise((done, reject) => {
    const child = spawn(command, args, { cwd, env: environment, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0 ? done() : reject(new Error(`${command} exited with ${code ?? signal}`)));
  });
}
