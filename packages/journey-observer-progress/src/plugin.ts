import { defineRuntimeObserverPlugin, knownOptions, positiveNumber } from "@openuji/journey-plugin";
import { createProgressRuntimeObserver, type ProgressObservationOptions } from "./index.js";

export const journeyMeshPlugin = defineRuntimeObserverPlugin({
  kind: "runtime-observer",
  parse(options): ProgressObservationOptions {
    knownOptions(options, ["heartbeatMs"]);
    return { heartbeatMs: positiveNumber(options.heartbeatMs, 60_000) };
  },
  create(options) { return createProgressRuntimeObserver(options); }
});
