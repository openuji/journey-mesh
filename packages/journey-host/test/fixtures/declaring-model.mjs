import { readFile } from "node:fs/promises";
import { journeyMeshPlugin as model } from "./model.mjs";

// The fixture model, able to declare findings: it reports which source it was asked about and never writes.
export const journeyMeshPlugin = {
  ...model,
  create() {
    return {
      ...model.create(),
      async declareMaterializations(source, found) {
        const text = await readFile(source, "utf8");
        return { document: `${text.trim()} // ${found.length} declared`, writes: found.map((item) => ({ transitionId: item.transitionId, modalityId: item.modalityId, outcome: "added" })) };
      }
    };
  }
};
