export interface BranchTransitionItem {
  id: string;
  cycle?: boolean;
  branch?: BranchTransitionItem[];
}

export const getEdgeBranch = (
  graph: BranchTransitionItem[],
  lastStateId: string
): BranchTransitionItem | undefined => {
  return graph.reduce((acc: BranchTransitionItem | undefined, item) => {
    if (acc) return acc
    if (item.id === lastStateId) return item
    return getEdgeBranch(item.branch || [], lastStateId)
  }, undefined)
}

export const getNextVisibleIds = (
  currentPath: string[],
  nextId: string,
  nextBranch: BranchTransitionItem | undefined
) => {
  return new Set([
    ...currentPath,
    nextId,
    ...(nextBranch?.branch?.map((item) => item.id) || [])
  ])
}
