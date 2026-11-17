import { describe, expect, it } from "vitest"
import {
  createSvgCurve,
  createSvgPath,
  easeProgress,
  getMarkerProgresses,
  getPointOnCurve,
  interpolateCurve,
  toLocalCurve
} from "./transitionGeometry"

describe("transition geometry", () => {
  it("creates a cubic path between two points", () => {
    const curve = createSvgCurve({ x: 0, y: 10 }, { x: 120, y: 40 })

    expect(curve).toEqual({
      from: { x: 0, y: 10 },
      control1: { x: 60, y: 10 },
      control2: { x: 60, y: 40 },
      to: { x: 120, y: 40 }
    })
    expect(createSvgPath(curve)).toBe("M 0 10 C 60 10, 60 40, 120 40")
  })

  it("keeps a minimum curve offset when the target is close or behind", () => {
    expect(createSvgCurve({ x: 100, y: 0 }, { x: 80, y: 0 })).toMatchObject({
      control1: { x: 150, y: 0 },
      control2: { x: 30, y: 0 }
    })
  })

  it("creates a block-axis cubic path between vertically stacked points", () => {
    const curve = createSvgCurve({ x: 40, y: 0 }, { x: 80, y: 120 }, "block")

    expect(curve).toEqual({
      from: { x: 40, y: 0 },
      control1: { x: 40, y: 60 },
      control2: { x: 80, y: 60 },
      to: { x: 80, y: 120 }
    })
    expect(createSvgPath(curve)).toBe("M 40 0 C 40 60, 80 60, 80 120")
  })

  it("keeps a minimum block-axis curve offset when the target is close or behind", () => {
    expect(createSvgCurve({ x: 0, y: 100 }, { x: 0, y: 80 }, "block")).toMatchObject({
      control1: { x: 0, y: 150 },
      control2: { x: 0, y: 30 }
    })
  })

  it("converts viewport curves into local container coordinates", () => {
    const localCurve = toLocalCurve(
      createSvgCurve({ x: 25, y: 50 }, { x: 125, y: 150 }),
      { left: 20, top: 30 }
    )

    expect(localCurve.from).toEqual({ x: 5, y: 20 })
    expect(localCurve.to).toEqual({ x: 105, y: 120 })
  })

  it("interpolates curves and easing endpoints", () => {
    const from = createSvgCurve({ x: 0, y: 0 }, { x: 100, y: 0 })
    const to = createSvgCurve({ x: 20, y: 40 }, { x: 140, y: 80 })

    expect(interpolateCurve(from, to, 0.5).from).toEqual({ x: 10, y: 20 })
    expect(easeProgress(0)).toBeCloseTo(0)
    expect(easeProgress(1)).toBeCloseTo(1)
  })

  it("samples points on a cubic curve", () => {
    const curve = createSvgCurve({ x: 0, y: 0 }, { x: 120, y: 60 })
    const midpoint = getPointOnCurve(curve, 0.5)

    expect(getPointOnCurve(curve, 0)).toEqual(curve.from)
    expect(getPointOnCurve(curve, 1)).toEqual(curve.to)
    expect(midpoint.x).toBeGreaterThan(curve.from.x)
    expect(midpoint.x).toBeLessThan(curve.to.x)
  })

  it("creates centered marker positions within the middle of the curve", () => {
    expect(getMarkerProgresses(0)).toEqual([])
    expect(getMarkerProgresses(1)).toEqual([0.5])
    expect(getMarkerProgresses(2)).toEqual([0.44, 0.56])
    expect(getMarkerProgresses(3)).toEqual([0.38, 0.5, 0.62])

    const manyMarkers = getMarkerProgresses(8)
    expect(manyMarkers).toEqual([...manyMarkers].sort((a, b) => a - b))
    expect(Math.min(...manyMarkers)).toBeGreaterThanOrEqual(0.25)
    expect(Math.max(...manyMarkers)).toBeLessThanOrEqual(0.75)
  })
})
