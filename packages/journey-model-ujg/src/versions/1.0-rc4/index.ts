import { unsupported, types, type UjgVersionCompiler } from "../../document.js";
import { compileRc4JourneyPlan } from "./compiler.js";
import { toJourneyMapDocument } from "./journey-map.js";
import { parseRc4Document, specVersion } from "./vocabulary.js";
import { validateRc4Graph } from "./validation.js";

export const rc4Compiler: UjgVersionCompiler = Object.freeze({
  version: specVersion, parse: parseRc4Document, validate: validateRc4Graph,
  compile: compileRc4JourneyPlan,
  view: (graph) => {
    const unsupportedNode = graph.nodes.find((node) => types(node).some((type) => ["AdjacentTransition", "OutgoingTransition", "InvokingTransition", "StateCollection", "EntrySelector"].includes(type)));
    if (unsupportedNode) unsupported(`${unsupportedNode["@id"]}: topology is not supported by map projection`);
    return toJourneyMapDocument({ ...graph.root, nodes: [...graph.nodes] });
  }
});
