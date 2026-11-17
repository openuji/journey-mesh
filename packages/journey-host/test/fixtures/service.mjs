import { appendFile } from "node:fs/promises";

export const journeyMeshPlugin = {
  kind: "service",
  parse(options) { if (!options.name || !options.log) throw new Error("Fixture service needs name and log"); return options; },
  create(options, context) {
    const log = (event) => appendFile(context.resolvePath(options.log), JSON.stringify({ event, name: options.name }) + "\n");
    return {
      name: options.name,
      async up() {
        await log("up");
        if (options.identity) await context.artifacts.write({ name: `${options.name}.identity.json`, data: JSON.stringify(options.identity), contentType: "application/json" });
        if (options.failUp) throw new Error(`Fixture service ${options.name} up failure`);
      },
      ...(options.identity ? { provenance: () => options.identity } : {}),
      async down() {
        await log("down");
        if (options.failDown) throw new Error(`Fixture service ${options.name} down failure`);
      }
    };
  }
};
