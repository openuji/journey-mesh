/** Test interpreter: the `fixture-nodes` observer records node metrics directly in its evidence. */
export const journeyMeshInterpreter = {
  kind: "fixture-nodes",
  interpret({ output }) {
    if (output.evidence.fail) throw new Error("Fixture interpreter failure");
    return { nodes: output.evidence.nodes, data: output.evidence.data ?? [] };
  }
};
