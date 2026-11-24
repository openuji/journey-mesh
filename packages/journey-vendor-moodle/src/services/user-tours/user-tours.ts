import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { startedService, type JourneyService } from "@openuji/journey-plugin";
import { composeCommand, type ComposeStack } from "@openuji/journey-service-docker/compose";
import { execute, type Command } from "@openuji/journey-service-git";
import { importToursScript } from "./import-script.js";

export type UserToursOptions = Readonly<{
  /** Where temporary files are staged before they are copied into the container. */
  directory: string;
  /** The Compose service that runs Moodle. */
  service: string;
  /** Tour exports (Moodle's tour JSON), imported in this order. */
  tours: readonly string[];
  /** Disable every tour that was not imported here, such as the tours Moodle ships. */
  disableOthers: boolean;
}>;

type Tour = Readonly<{ id: number; name: string; enabled: boolean; imported: boolean }>;

/** Imports user tours into the Moodle site of a running stack (the `stack` input) and verifies the result. */
export function userToursService(options: UserToursOptions, run: Command = execute, inputs: Readonly<Record<string, unknown>> = {}): JourneyService {
  options = structuredClone(options);
  if (!options.tours.length) throw new Error("tours must list at least one tour export");
  return {
    name: "moodle-user-tours",
    async start(input) {
      const stack = inputs.stack as ComposeStack | undefined;
      if (!stack) throw new Error("Missing stack");
      // Any Compose stack satisfies the contract; this one must actually run the Moodle service.
      if (!stack.services.includes(options.service)) throw new Error(`Stack ${stack.project} has no service ${options.service}`);
      const exports = await Promise.all(options.tours.map(async (path) => {
        const text = await readFile(path, "utf8");
        const name = (JSON.parse(text) as { name?: unknown }).name;
        if (typeof name !== "string" || !name) throw new Error(`${path} is not a user tour export`);
        return { path, name, text, sha256: createHash("sha256").update(text).digest("hex") };
      }));
      await mkdir(options.directory, { recursive: true });
      const staging = await mkdtemp(join(options.directory, "tours-"));
      const remote = `/tmp/journey-user-tours-${randomUUID()}`;
      const docker = (...args: string[]) => run("docker", [...composeCommand(stack), ...args], options.directory, input?.signal);
      try {
        await writeFile(join(staging, "import.php"), importToursScript);
        await docker("exec", "-T", options.service, "mkdir", "-p", remote);
        await docker("cp", join(staging, "import.php"), `${options.service}:${remote}/import.php`);
        const files: string[] = [];
        for (const [index, tour] of exports.entries()) {
          const file = `${remote}/tour-${index}.json`;
          await writeFile(join(staging, `tour-${index}.json`), tour.text);
          await docker("cp", join(staging, `tour-${index}.json`), `${options.service}:${file}`);
          files.push(file);
        }
        const output = await docker("exec", "-T", "-u", "www-data", "-w", "/var/www/html", options.service, "php", `${remote}/import.php`,
          ...(options.disableOthers ? ["--disable-others"] : []), ...files);
        const tours = (JSON.parse(output) as { tours: Tour[] }).tours;
        for (const tour of exports) {
          const imported = tours.filter((item) => item.imported && item.name === tour.name);
          if (imported.length !== 1 || !imported[0]!.enabled) throw new Error(`Tour ${tour.name} was not imported and enabled`);
        }
        const stillEnabled = tours.filter((item) => !item.imported && item.enabled);
        if (options.disableOthers && stillEnabled.length) throw new Error(`Tours still enabled: ${stillEnabled.map((item) => item.name).join(", ")}`);
        return startedService({}, {
          service: options.service,
          imported: exports.map((tour) => ({ file: basename(tour.path), name: tour.name, sha256: tour.sha256, id: tours.find((item) => item.imported && item.name === tour.name)!.id })),
          disabled: tours.filter((item) => !item.imported && !item.enabled).map((item) => item.name)
        });
      } finally {
        await docker("exec", "-T", options.service, "rm", "-rf", remote).catch(() => {});
        await rm(staging, { recursive: true, force: true });
      }
    }
  };
}
