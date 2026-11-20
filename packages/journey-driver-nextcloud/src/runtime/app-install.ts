import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, posix } from "node:path";
import { randomUUID } from "node:crypto";
import { execute, type Command } from "@openuji/journey-service-git";
import { startedService, sourceIdentity, type JourneyService, type SourceIdentity } from "@openuji/journey-plugin";
import type { AppBuild, ManagedStack } from "./contracts.js";

export type InstallOptions = Readonly<{ directory: string; services: readonly string[]; enable: boolean }>;
type AppList = { enabled?: Record<string, string>; disabled?: Record<string, string> };
export function appInstall(options: InstallOptions, run: Command = execute, inputs: Readonly<Record<string, unknown>> = {}): JourneyService {
  options = structuredClone(options);
  return {
    name: "nextcloud-app-install",
    async start(input) {
      const app = inputs.app as AppBuild | undefined;
      const stack = inputs.stack as ManagedStack | undefined;
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
          const listApps = async (): Promise<AppList> => JSON.parse(await occ("app:list", "--output=json"));
          const current = await listApps();
          const exists = Object.hasOwn(current.enabled ?? {}, app.id) || Object.hasOwn(current.disabled ?? {}, app.id);
          const appPath = exists ? await occ("app:getpath", app.id) : `/var/www/html/custom_apps/${app.id}`;
          if (!posix.isAbsolute(appPath) || posix.normalize(appPath) !== appPath || posix.basename(appPath) !== app.id) throw new Error("Invalid installed app path");
          // Replace the selected copy in place so bundled apps cannot shadow it and deleted files do not survive.
          await docker("exec", "-T", service, "mkdir", "-p", posix.dirname(appPath));
          await docker("exec", "-T", service, "rm", "-rf", "--", appPath);
          await docker("cp", exported, `${service}:${appPath}`);
          await docker("exec", "-T", service, "chown", "-R", "www-data:www-data", appPath);
          if (await occ("app:getpath", app.id) !== appPath) throw new Error("Installed app path mismatch");
          const sha = await docker("exec", "-T", service, "cat", posix.join(appPath, ".journey-source-sha"));
          if (sha !== expected.sourceSha) throw new Error("Installed app source mismatch");
          if (options.enable) await occ("app:enable", app.id);
          const apps = await listApps();
          if ((options.enable ? apps.enabled?.[app.id] : apps.enabled?.[app.id] ?? apps.disabled?.[app.id]) !== expected.version) throw new Error("Installed app version mismatch");
        }
        return startedService({ identity: expected }, expected);
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
