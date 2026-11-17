import { describe, expect, it } from "vitest"
import type {
  LaneOwner,
  MeasuredLaneNode
} from "./JourneyPath.lanes"
import { createMeasuredLaneSegments } from "./JourneyPath.lanes"

const fallbackOwner: LaneOwner = {
  id: "journey",
  label: "Journey",
  tone: "accent"
}

const stepOne: LaneOwner = {
  id: "step:one",
  label: "First step",
  number: 1,
  tone: "accent"
}

const stepTwo: LaneOwner = {
  id: "step:two",
  label: "Second step",
  number: 2,
  tone: "success"
}

const phaseOne: LaneOwner = {
  id: "phase:one",
  label: "First phase",
  number: 1,
  tone: "accent"
}

const phaseTwo: LaneOwner = {
  id: "phase:two",
  label: "Second phase",
  number: 2,
  tone: "success"
}

const node = (
  occurrenceId: string,
  left: number,
  right: number,
  step?: LaneOwner,
  phase?: LaneOwner
): MeasuredLaneNode => ({
  occurrenceId,
  stateId: occurrenceId,
  left,
  right,
  ...(step ? { step } : {}),
  ...(phase ? { phase } : {})
})

describe("createMeasuredLaneSegments", () => {
  it("creates one full-width segment when all states share a step", () => {
    const segments = createMeasuredLaneSegments({
      fallbackOwner,
      getOwner: (item) => item.step,
      nodes: [
        node("state:two", 220, 300, stepOne),
        node("state:one", 20, 120, stepOne)
      ],
      width: 400
    })

    expect(segments).toEqual([
      {
        ...stepOne,
        id: "step:one:0",
        left: 0,
        width: 400
      }
    ])
  })

  it("cuts step segments at the midpoint between adjacent state cards", () => {
    const segments = createMeasuredLaneSegments({
      fallbackOwner,
      getOwner: (item) => item.step,
      nodes: [
        node("state:one", 20, 120, stepOne),
        node("state:two", 220, 300, stepTwo)
      ],
      width: 420
    })

    expect(segments).toEqual([
      {
        ...stepOne,
        id: "step:one:0",
        left: 0,
        width: 170
      },
      {
        ...stepTwo,
        id: "step:two:1",
        left: 170,
        width: 250
      }
    ])
  })

  it("cuts phase segments independently from step segments", () => {
    const segments = createMeasuredLaneSegments({
      fallbackOwner,
      getOwner: (item) => item.phase,
      nodes: [
        node("state:one", 20, 120, stepOne, phaseOne),
        node("state:two", 220, 300, stepTwo, phaseOne),
        node("state:three", 360, 460, stepTwo, phaseTwo)
      ],
      width: 520
    })

    expect(segments).toEqual([
      {
        ...phaseOne,
        id: "phase:one:0",
        left: 0,
        width: 330
      },
      {
        ...phaseTwo,
        id: "phase:two:1",
        left: 330,
        width: 190
      }
    ])
  })

  it("falls back to the journey lane when context is missing", () => {
    const segments = createMeasuredLaneSegments({
      fallbackOwner,
      getOwner: (item) => item.step,
      nodes: [
        node("state:one", 20, 120),
        node("state:two", 220, 300)
      ],
      width: 400
    })

    expect(segments).toEqual([
      {
        ...fallbackOwner,
        id: "journey:0",
        left: 0,
        width: 400
      }
    ])
  })

  it("clamps overlapping cuts and never creates negative widths", () => {
    const segments = createMeasuredLaneSegments({
      fallbackOwner,
      getOwner: (item) => item.step,
      nodes: [
        node("state:one", 20, 220, stepOne),
        node("state:two", 100, 150, stepTwo),
        node("state:three", 110, 140, stepOne)
      ],
      width: 120
    })

    expect(segments.map((segment) => segment.width)).toEqual([120, 0, 0])
    expect(segments.every((segment) => segment.width >= 0)).toBe(true)
  })
})
