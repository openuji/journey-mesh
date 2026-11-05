import { knownOptions, type JourneyMeshPlugin, type JourneyModelCompiler } from "@openuji/journey-runtime/plugin";
import { compileUjgJourneyPlan } from "./index.js";
export const journeyMeshPlugin: JourneyMeshPlugin<JourneyModelCompiler> = {
  apiVersion: 1, kind: "model",
  validate(options) { knownOptions(options, []); },
  create() { return { compile: (source, journeyId) => compileUjgJourneyPlan(source, { journeyId }) }; }
};
