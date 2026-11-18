import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { execute, type Command } from "@openuji/journey-service-git";
import { sourceIdentity, type JourneyService, type SourceIdentity } from "@openuji/journey-plugin";
import type { AppBuild, ManagedStack } from "./contracts.js";

export type InstallOptions = Readonly<{ directory: string; services: readonly string[]; enable: boolean }>;
export function appInstall(options: InstallOptions, run: Command = execute): JourneyService {
  options = structuredClone(options);
  let identity: SourceIdentity | undefined;
  return {
    name: "nextcloud-app-install", provenance: () => identity,
    async up(input) {
      identity = undefined;
      const app = input?.inputs?.app as AppBuild | undefined;
      const stack = input?.inputs?.stack as ManagedStack | undefined;
      if (!app || !/^[a-z_]+$/.test(app.id) || !stack) throw new Error("Missing app build or managed stack");
      const expected = sourceIdentity(app.identity);
      if (!expected.version) throw new Error("Missing app version");
      if (options.services.some((service) => !stack.services.includes(service))) throw new Error("Unknown app installation service");
      await mkdir(options.directory, { recursive: true });
      const temporary = await mkdtemp(join(options.directory, "install-"));
      const container = `journey-app-${randomUUID()}`;
      const command = (args: string[], signal = input?.signal) => run("docker", args, options.directory, signal);
      let attempted = false;
      let failure: unknown;
      try {
        attempted = true;
        await command(["create", "--name", container, app.image, "true"]);
        const exported = join(temporary, app.id);
        await command(["cp", `${container}:/opt/journey-app`, exported]);
        const compose = ["compose", "--project-name", stack.project, "--env-file", stack.envFile, ...stack.composeFiles.flatMap((file) => ["-f", file])];
        for (const service of options.services) {
          const docker = (...args: string[]) => command([...compose, ...args]);
          const occ = (...args: string[]) => docker("exec", "-T", "-u", "www-data", service, "php", "occ", ...args);
          await docker("exec", "-T", service, "mkdir", "-p", "/var/www/html/custom_apps");
          await docker("cp", exported, `${service}:/var/www/html/custom_apps/`);
          await docker("exec", "-T", service, "chown", "-R", "www-data:www-data", `/var/www/html/custom_apps/${app.id}`);
          const sha = await docker("exec", "-T", service, "cat", `/var/www/html/custom_apps/${app.id}/.journey-source-sha`);
          if (sha !== expected.sourceSha) throw new Error("Installed app source mismatch");
          if (options.enable) await occ("app:enable", app.id);
          const apps = JSON.parse(await occ("app:list", "--output=json"));
          if ((options.enable ? apps.enabled?.[app.id] : apps.enabled?.[app.id] ?? apps.disabled?.[app.id]) !== expected.version) throw new Error("Installed app version mismatch");
        }
        identity = expected;
        return { identity };
      } catch (error) { failure = error; throw error; }
      finally {
        const failures: unknown[] = [];
        try { if (attempted) await command(["rm", "-f", container], AbortSignal.timeout(30_000)); } catch (error) { failures.push(error); }
        try { await rm(temporary, { recursive: true, force: true }); } catch (error) { failures.push(error); }
        if (failures.length) throw new AggregateError([...(failure ? [failure] : []), ...failures], "App installation cleanup failed");
      }
    }
  };
}
