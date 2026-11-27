import { appendFile } from "node:fs/promises";
import { serviceLifecycle } from "@openuji/journey-plugin";
export const journeyMeshPlugin = {
  kind: "runtime-observer",
  parse: (options) => options,
  create(_options, context) {
    return {
      start(source) {
        source.subscribe(serviceLifecycle, ({ source: service, value }) => appendFile(context.resolvePath("lifecycle"), `${service} ${value.phase}\n`), { name: "lifecycle fixture" });
      },
      close() {}
    };
  }
};
