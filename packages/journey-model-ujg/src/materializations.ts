import type { DiscoveredMaterialization, MaterializationWrite } from "@openuji/journey-plugin";
import { unsupported, type UjgJsonDocument } from "./document.js";
import { registry } from "./versions/index.js";

/**
 * Declare discovered paths in a UJG JSON-LD document, so that a found path becomes model content an
 * author reviews like any other. The document's own UJG version writes them; a version that cannot
 * (any but 1.0 RC4 today) is rejected rather than given nodes of another version.
 */
export function declareDiscoveredMaterializations(document: unknown, found: readonly DiscoveredMaterialization[]): { document: UjgJsonDocument; writes: MaterializationWrite[] } {
  const compiler = registry.select(document);
  if (!compiler.declareMaterializations) unsupported(`UJG ${compiler.version} documents cannot take discovered steps`);
  return compiler.declareMaterializations(document, found);
}
