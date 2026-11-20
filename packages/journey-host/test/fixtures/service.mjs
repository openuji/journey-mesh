import { appendFile } from "node:fs/promises";
import { startedService } from "@openuji/journey-plugin";
import { ownershipPath, readJsonRecord, writeJsonRecord, removeOwnership } from "@openuji/journey-plugin/node";
async function stop(options, context) {
  await appendFile(context.resolvePath(options.log), JSON.stringify({ event: "down", name: options.name }) + "\n");
  if (options.failDown) throw new Error(`Fixture service ${options.name} down failure`);
  await removeOwnership(ownershipPath(context.configPath, context.componentId));
}
export const journeyMeshPlugin = {
  kind: "service",
  parse(options) { if (!options.name || !options.log) throw new Error("Fixture service needs name and log"); return options; },
  create(options, context) {
    return { name: options.name, async start() {
      await appendFile(context.resolvePath(options.log), JSON.stringify({ event: "up", name: options.name }) + "\n");
      await writeJsonRecord(ownershipPath(context.configPath, context.componentId), options);
      try {
        if (options.identity) await context.artifacts.write({ name: `${options.name}.identity.json`, data: JSON.stringify(options.identity), contentType: "application/json" });
        if (options.failUp) throw new Error(`Fixture service ${options.name} up failure`);
        return startedService({}, options.identity, () => stop(options, context));
      } catch (error) { await stop(options, context); throw error; }
    } };
  },
  async stopConfigured(context) {
    const options = await readJsonRecord(ownershipPath(context.configPath, context.componentId));
    if (options) await stop(options, context);
  }
};
