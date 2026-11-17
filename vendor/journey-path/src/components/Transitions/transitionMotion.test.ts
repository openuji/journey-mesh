import { describe, expect, it } from "vitest"
import {
  defaultBranchEntranceAnimationConfig,
  getBranchEntranceSchedule
} from "./transitionMotion"

describe("branch entrance animation schedule", () => {
  it("stacks path and node animation timings by label index", () => {
    expect(getBranchEntranceSchedule(["Login", "MFA", "Recovery"])).toEqual([
      {
        ...defaultBranchEntranceAnimationConfig,
        label: "Login",
        pathDelayMs: 0,
        nodeDelayMs: 260
      },
      {
        ...defaultBranchEntranceAnimationConfig,
        label: "MFA",
        pathDelayMs: 70,
        nodeDelayMs: 330
      },
      {
        ...defaultBranchEntranceAnimationConfig,
        label: "Recovery",
        pathDelayMs: 140,
        nodeDelayMs: 400
      }
    ])
  })

  it("uses caller-provided timing defaults", () => {
    expect(getBranchEntranceSchedule(["A", "B"], {
      pathDurationMs: 100,
      nodeDurationMs: 50,
      staggerMs: 25,
      pathEasing: "linear",
      nodeEasing: "ease"
    })).toEqual([
      {
        label: "A",
        pathDelayMs: 0,
        nodeDelayMs: 100,
        pathDurationMs: 100,
        nodeDurationMs: 50,
        staggerMs: 25,
        pathEasing: "linear",
        nodeEasing: "ease"
      },
      {
        label: "B",
        pathDelayMs: 25,
        nodeDelayMs: 125,
        pathDurationMs: 100,
        nodeDurationMs: 50,
        staggerMs: 25,
        pathEasing: "linear",
        nodeEasing: "ease"
      }
    ])
  })
})
