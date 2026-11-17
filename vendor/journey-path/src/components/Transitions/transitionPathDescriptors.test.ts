import { describe, expect, it } from "vitest"
import { getEdgeBranch } from "./branchModel"
import type { BranchTransitionItem } from "./branchModel"
import {
  createTransitionPathId,
  getTransitionPathDescriptors
} from "./transitionPathDescriptors"

const graph: BranchTransitionItem[] = [
  {
    id: "Auth required",
    branch: [
      {
        id: "login",
        branch: [
          { id: "Succeeded" },
          { id: "Password Recover" }
        ]
      },
      { id: "MFA" }
    ]
  }
]

describe("transition path descriptors", () => {
  it("creates branch edges from the active branch source", () => {
    const activeBranch = getEdgeBranch(graph, "Auth required")

    expect(getTransitionPathDescriptors(["Auth required"], activeBranch)).toEqual([
      {
        id: createTransitionPathId("Auth required", "login"),
        sourceId: "Auth required",
        targetId: "login",
        status: "branch"
      },
      {
        id: createTransitionPathId("Auth required", "MFA"),
        sourceId: "Auth required",
        targetId: "MFA",
        status: "branch"
      }
    ])
  })

  it("keeps a selected branch edge ID when it becomes main", () => {
    const selectedEdgeId = createTransitionPathId("Auth required", "login")
    const activeBranch = getEdgeBranch(graph, "login")
    const descriptors = getTransitionPathDescriptors(["Auth required", "login"], activeBranch)

    expect(descriptors.filter((descriptor) => descriptor.id === selectedEdgeId)).toEqual([
      {
        id: selectedEdgeId,
        sourceId: "Auth required",
        targetId: "login",
        status: "main"
      }
    ])
    expect(descriptors).toContainEqual({
      id: createTransitionPathId("login", "Succeeded"),
      sourceId: "login",
      targetId: "Succeeded",
      status: "branch"
    })
    expect(descriptors).toContainEqual({
      id: createTransitionPathId("login", "Password Recover"),
      sourceId: "login",
      targetId: "Password Recover",
      status: "branch"
    })
  })
})
