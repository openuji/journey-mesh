export type Point = { x: number; y: number }

export interface SvgCurve {
  from: Point;
  control1: Point;
  control2: Point;
  to: Point;
}

export type CurveAxis = "inline" | "block"

type RectOffset = Pick<DOMRect, "left" | "top">

export const createSvgCurve = (from: Point, to: Point, axis: CurveAxis = "inline"): SvgCurve => {
  if (axis === "block") {
    const dy = to.y - from.y
    const curveOffset = Math.max(50, dy / 2)

    return {
      from,
      control1: { x: from.x, y: from.y + curveOffset },
      control2: { x: to.x, y: to.y - curveOffset },
      to
    }
  }

  const dx = to.x - from.x
  const curveOffset = Math.max(50, dx / 2)

  return {
    from,
    control1: { x: from.x + curveOffset, y: from.y },
    control2: { x: to.x - curveOffset, y: to.y },
    to
  }
}

export const createSvgPath = (curve: SvgCurve) => (
  `M ${curve.from.x} ${curve.from.y} C ${curve.control1.x} ${curve.control1.y}, ${curve.control2.x} ${curve.control2.y}, ${curve.to.x} ${curve.to.y}`
)

export const toLocalPoint = (point: Point, containerRect: RectOffset): Point => ({
  x: point.x - containerRect.left,
  y: point.y - containerRect.top
})

export const toLocalCurve = (curve: SvgCurve, containerRect: RectOffset): SvgCurve => ({
  from: toLocalPoint(curve.from, containerRect),
  control1: toLocalPoint(curve.control1, containerRect),
  control2: toLocalPoint(curve.control2, containerRect),
  to: toLocalPoint(curve.to, containerRect)
})

export const getConnectionPoints = (
  outElement: HTMLElement | undefined,
  inElement: HTMLElement | undefined
) => {
  if (!outElement || !inElement) return undefined

  const outRect = outElement.getBoundingClientRect()
  const inRect = inElement.getBoundingClientRect()

  return {
    from: {
      x: outRect.left + outRect.width / 2,
      y: outRect.top + outRect.height / 2
    },
    to: {
      x: inRect.left + inRect.width / 2,
      y: inRect.top + inRect.height / 2
    }
  }
}

export const getViewportCurve = (
  outElement: HTMLElement | undefined,
  inElement: HTMLElement | undefined,
  axis: CurveAxis = "inline"
) => {
  const points = getConnectionPoints(outElement, inElement)
  if (!points) return undefined

  return createSvgCurve(points.from, points.to, axis)
}

export const getLocalCurve = (
  containerElement: HTMLElement,
  outElement: HTMLElement | undefined,
  inElement: HTMLElement | undefined,
  axis: CurveAxis = "inline"
) => {
  const viewportCurve = getViewportCurve(outElement, inElement, axis)
  if (!viewportCurve) return undefined

  return toLocalCurve(viewportCurve, containerElement.getBoundingClientRect())
}

export const interpolate = (from: number, to: number, progress: number) => from + (to - from) * progress

export const interpolatePoint = (from: Point, to: Point, progress: number): Point => ({
  x: interpolate(from.x, to.x, progress),
  y: interpolate(from.y, to.y, progress)
})

export const getPointOnCurve = (curve: SvgCurve, progress: number): Point => {
  const start = interpolatePoint(curve.from, curve.control1, progress)
  const middle = interpolatePoint(curve.control1, curve.control2, progress)
  const end = interpolatePoint(curve.control2, curve.to, progress)
  const first = interpolatePoint(start, middle, progress)
  const second = interpolatePoint(middle, end, progress)

  return interpolatePoint(first, second, progress)
}

export const getMarkerProgresses = (count: number): number[] => {
  if (count <= 0) return []
  if (count === 1) return [0.5]

  const minProgress = 0.25
  const maxProgress = 0.75
  const preferredGap = 0.12
  const gap = Math.min(preferredGap, (maxProgress - minProgress) / (count - 1))
  const start = 0.5 - (gap * (count - 1)) / 2

  return Array.from({ length: count }, (_, index) => (
    Number(Math.min(maxProgress, Math.max(minProgress, start + gap * index)).toFixed(4))
  ))
}

export const interpolateCurve = (from: SvgCurve, to: SvgCurve, progress: number): SvgCurve => ({
  from: interpolatePoint(from.from, to.from, progress),
  control1: interpolatePoint(from.control1, to.control1, progress),
  control2: interpolatePoint(from.control2, to.control2, progress),
  to: interpolatePoint(from.to, to.to, progress)
})

export const sampleCubicBezier = (time: number, point1: number, point2: number) => {
  const inverseTime = 1 - time
  return 3 * inverseTime * inverseTime * time * point1 + 3 * inverseTime * time * time * point2 + time * time * time
}

export const sampleCubicBezierDerivative = (time: number, point1: number, point2: number) => (
  3 * (1 - time) * (1 - time) * point1 +
  6 * (1 - time) * time * (point2 - point1) +
  3 * time * time * (1 - point2)
)

export const easeProgress = (progress: number) => {
  let time = progress

  for (let index = 0; index < 5; index += 1) {
    const currentProgress = sampleCubicBezier(time, 0.25, 0.25) - progress
    const derivative = sampleCubicBezierDerivative(time, 0.25, 0.25)
    if (Math.abs(derivative) < 0.001) break
    time = Math.min(1, Math.max(0, time - currentProgress / derivative))
  }

  return sampleCubicBezier(time, 0.1, 1)
}
