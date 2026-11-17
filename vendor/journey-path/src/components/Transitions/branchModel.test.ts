import { describe, expect, it } from "vitest"
import {
  getEdgeBranch,
  getNextVisibleIds
} from "./branchModel"
import type { BranchTransitionItem } from "./branchModel"

const graph: BranchTransitionItem[] = [
  {
    id: "Auth required",
    branch: [
      {
        id: "Login",
        branch: [
          { id: "Succeeded" },
          {
            id: "Recovery",
            branch: [
              { id: "Email" },
              { id: "SMS" },
              { id: "Auth required", cycle: true }
            ]
          }
        ]
      },
      { id: "MFA" }
    ]
  }
]

describe("branch model", () => {
  it("finds a nested branch by id", () => {
    expect(getEdgeBranch(graph, "Recovery")).toEqual({
      id: "Recovery",
      branch: [
        { id: "Email" },
        { id: "SMS" },
        { id: "Auth required", cycle: true }
      ]
    })
  })

  it("returns undefined for ids outside the tree", () => {
    expect(getEdgeBranch(graph, "Not here")).toBeUndefined()
  })

  it("keeps the existing path and the next branch choices visible", () => {
    const nextBranch = getEdgeBranch(graph, "Login")
    const ids = getNextVisibleIds(["Auth required"], "Login", nextBranch)

    expect([...ids]).toEqual([
      "Auth required",
      "Login",
      "Succeeded",
      "Recovery"
    ])
  })

  it("preserves cycle metadata without expanding it specially", () => {
    const recovery = getEdgeBranch(graph, "Recovery")

    expect(recovery?.branch?.at(2)).toEqual({ id: "Auth required", cycle: true })
  })
})
