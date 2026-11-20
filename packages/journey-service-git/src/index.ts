import { runOwnedProcess } from "@openuji/journey-plugin/node";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { startedService, type JourneyService, type SourceIdentity } from "@openuji/journey-plugin";

export type Command = (command: string, args: readonly string[], cwd: string, signal?: AbortSignal) => Promise<string>;
export const execute: Command = (command, args, cwd, signal) => runOwnedProcess(command, args, { cwd, signal, stdoutOnly: true });
export type GitOptions = Readonly<{ repository: string; directory: string; sha?: string; pullRequest?: number }>;
export function validateGitSource(options: GitOptions): void {
  const url = new URL(options.repository);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("repository must be an HTTPS URL without credentials");
  if ((options.sha === undefined) === (options.pullRequest === undefined)) throw new Error("Choose exactly one of sha or pullRequest");
  if (options.sha !== undefined && !/^[a-f0-9]{40}$/.test(options.sha)) throw new Error("sha must be an exact commit");
  if (options.pullRequest !== undefined && (!Number.isSafeInteger(options.pullRequest) || options.pullRequest < 1)) throw new Error("pullRequest must be a positive integer");
}
export function gitSource(options: GitOptions, run: Command = execute): JourneyService {
  options = structuredClone(options);
  validateGitSource(options);
  return {
    name: "git-source",
    async start(input) {
      const command = (args: string[], cwd = options.directory) => run("git", args, cwd, input?.signal);
      await mkdir(dirname(options.directory), { recursive: true });
      const top = await command(["rev-parse", "--show-toplevel"]).catch((error) => { input.signal?.throwIfAborted(); return undefined; });
      const reused = top && resolve(top) === resolve(options.directory);
      if (reused) {
        if (await command(["remote", "get-url", "origin"]) !== options.repository) throw new Error("Checkout origin does not match repository");
        if (await command(["status", "--porcelain", "--untracked-files=normal"])) throw new Error("Refusing to use a modified source checkout");
      } else await command(["clone", "--no-checkout", "--filter=blob:none", options.repository, options.directory], dirname(options.directory));
      await command(["fetch", "origin", options.sha ?? `refs/pull/${options.pullRequest}/head`]);
      const sourceSha = await command(["rev-parse", "FETCH_HEAD^{commit}"]);
      if (!/^[a-f0-9]{40}$/.test(sourceSha) || options.sha && sourceSha !== options.sha) throw new Error("Source SHA mismatch");
      await command(["checkout", "--detach", sourceSha]);
      if (await command(["rev-parse", "HEAD"]) !== sourceSha) throw new Error("Source SHA mismatch");
      await command(["submodule", "update", "--init", "--depth", "1"]);
      const identity = Object.freeze({ repository: options.repository, sourceSha, ...(options.pullRequest === undefined ? {} : { pullRequest: options.pullRequest }) });
      return startedService({ source: Object.freeze({ directory: options.directory, identity }), identity }, identity);
    }
  };
}
