import { appendFile } from "node:fs/promises";

export const journeyMeshPlugin = {
  apiVersion: 1, kind: "runtime",
  validate(options) { if (!options.name || !options.log) throw new Error("Fixture runtime needs name and log"); },
  create(options, context) {
    const log = (event) => appendFile(context.resolvePath(options.log), JSON.stringify({ event, name: options.name }) + "\n");
    return {
      name: options.name,
      async up() {
        await log("up");
        if (options.failUp) throw new Error(`Fixture runtime ${options.name} up failure`);
      },
      async down() {
        await log("down");
        if (options.failDown) throw new Error(`Fixture runtime ${options.name} down failure`);
      }
    };
  }
};
