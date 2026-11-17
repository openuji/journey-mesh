import type { BranchTransitionItem } from "./branchModel"

export type TransitionPathStatus = "main" | "branch"

export interface TransitionPathDescriptor {
  id: string;
  sourceId: string;
  targetId: string;
  status: TransitionPathStatus;
}

export const createTransitionPathId = (sourceId: string, targetId: string) => {
  return `${encodeURIComponent(sourceId)}->${encodeURIComponent(targetId)}`
}

export const getTransitionPathDescriptors = (
  path: string[],
  activeBranch: BranchTransitionItem | undefined
): TransitionPathDescriptor[] => {
  const mainPaths = path.slice(1).map((targetId, index) => {
    const sourceId = path[index]

    return {
      id: createTransitionPathId(sourceId, targetId),
      sourceId,
      targetId,
      status: "main" as const
    }
  })

  const branchPaths = activeBranch ? (activeBranch.branch || []).map((item) => {
    return {
      id: createTransitionPathId(activeBranch.id, item.id),
      sourceId: activeBranch.id,
      targetId: item.id,
      status: "branch" as const
    }
  }) : []

  return [...mainPaths, ...branchPaths]
}
