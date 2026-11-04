import { booleanOption, knownOptions, requiredString, type JourneyMeshPlugin, type JourneyObserverComponent } from "@openuji/journey-runtime/plugin";
import { androidAccessibilityObserver } from "./index.js";
export const journeyMeshPlugin: JourneyMeshPlugin<JourneyObserverComponent> = {
  apiVersion: 1, kind: "observer", runtime: "appium",
  validate(options) {
    knownOptions(options, ["reportId", "strict", "screenshots"]);
    requiredString(options.reportId, "reportId"); booleanOption(options.strict); booleanOption(options.screenshots, true);
  },
  create(options, context) {
    const observer = androidAccessibilityObserver({
      reportId: options.reportId as string, strict: booleanOption(options.strict), screenshots: booleanOption(options.screenshots, true),
      writeArtifact: (input) => context.artifacts.write(input), readArtifact: (artifact) => context.artifacts.read(artifact)
    });
    return { observer, reporter: observer };
  }
};
