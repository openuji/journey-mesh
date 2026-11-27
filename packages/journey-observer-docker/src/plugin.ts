import { defineRuntimeObserverPlugin, knownOptions, optionsObject, positiveNumber, requiredString } from "@openuji/journey-plugin";
import { isAbsolute } from "node:path";
import { createDockerRuntimeObserver, type DockerObservationOptions } from "./index.js";

export const journeyMeshPlugin = defineRuntimeObserverPlugin({
  kind: "runtime-observer",
  parse(options): DockerObservationOptions {
    knownOptions(options, ["containerLogs", "tail", "timeoutMs", "files", "progress"]);
    if (options.containerLogs !== undefined && typeof options.containerLogs !== "boolean") throw new Error("containerLogs must be a boolean");
    if (options.progress !== undefined && typeof options.progress !== "boolean") throw new Error("progress must be a boolean");
    const tail = positiveNumber(options.tail, 2000);
    if (!Number.isSafeInteger(tail)) throw new Error("tail must be an integer");
    if (options.files !== undefined && !Array.isArray(options.files)) throw new Error("files must be an array");
    const names = new Set<string>();
    const files = ((options.files ?? []) as unknown[]).map((raw) => {
      const file = optionsObject(raw, "files"); knownOptions(file, ["name", "path"]);
      const name = requiredString(file.name, "files.name");
      const path = requiredString(file.path, "files.path");
      if (!/^[a-zA-Z0-9_-]+$/.test(name) || names.has(name)) throw new Error("Capture names must be unique file-name segments");
      if (!isAbsolute(path)) throw new Error("Capture paths must be absolute container paths");
      names.add(name); return { name, path };
    });
    return { containerLogs: options.containerLogs !== false, tail, timeoutMs: positiveNumber(options.timeoutMs, 10_000), files, progress: options.progress === true };
  },
  create(options, context) { return createDockerRuntimeObserver(options, context.artifacts); }
});
