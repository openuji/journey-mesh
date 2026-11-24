import { booleanOption, defineServicePlugin, knownOptions, requiredString, stringArray } from "@openuji/journey-plugin";
import { composeStackContract } from "@openuji/journey-service-docker/compose";
import { userToursService } from "./user-tours.js";

/** Imports user tour exports into the Moodle site of a `stack` input (`./stack/service`). */
export const journeyMeshPlugin = defineServicePlugin({
  kind: "service", inputs: { stack: composeStackContract },
  parse(options, context) {
    knownOptions(options, ["directory", "service", "tours", "disableOthers"]);
    const tours = stringArray(options.tours, "tours").map((path) => context.resolvePath(path));
    if (!tours.length) throw new Error("tours must list at least one tour export");
    return {
      directory: context.resolvePath(requiredString(options.directory, "directory")),
      service: requiredString(options.service ?? "moodle", "service"),
      tours, disableOthers: booleanOption(options.disableOthers, true)
    };
  },
  create(settings, _context, { inputs }) { return userToursService(settings, undefined, inputs); }
});
