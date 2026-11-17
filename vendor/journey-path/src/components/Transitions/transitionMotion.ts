import {
  createSvgPath,
  easeProgress,
  interpolateCurve
} from "./transitionGeometry"
import type { SvgCurve } from "./transitionGeometry"

const duration = 320
const fallbackDuration = 500

export interface BranchEntranceAnimationConfig {
  pathDurationMs: number;
  nodeDurationMs: number;
  staggerMs: number;
  pathEasing: string;
  nodeEasing: string;
}

export interface BranchEntranceScheduleEntry extends BranchEntranceAnimationConfig {
  label: string;
  pathDelayMs: number;
  nodeDelayMs: number;
}

export const defaultBranchEntranceAnimationConfig: BranchEntranceAnimationConfig = {
  pathDurationMs: 260,
  nodeDurationMs: 180,
  staggerMs: 70,
  pathEasing: "cubic-bezier(0.16, 1, 0.3, 1)",
  nodeEasing: "cubic-bezier(0.2, 0, 0, 1)"
}

export const prefersReducedMotion = () => (
  window.matchMedia("(prefers-reduced-motion: reduce)").matches
)

export const getBranchEntranceSchedule = (
  labels: string[],
  config: BranchEntranceAnimationConfig = defaultBranchEntranceAnimationConfig
): BranchEntranceScheduleEntry[] => {
  return labels.map((label, index) => {
    const pathDelayMs = index * config.staggerMs

    return {
      ...config,
      label,
      pathDelayMs,
      nodeDelayMs: pathDelayMs + config.pathDurationMs
    }
  })
}

export const animateNodeFromRect = (
  node: HTMLElement,
  fromRect: DOMRect,
  onComplete: () => void
) => {
  if (prefersReducedMotion()) {
    onComplete()
    return
  }

  const toRect = node.getBoundingClientRect()
  const dx = fromRect.left - toRect.left
  const dy = fromRect.top - toRect.top

  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
    onComplete()
    return
  }

  let isFinished = false
  let animationFrame = 0
  let fallbackTimeout = 0

  const finish = () => {
    if (isFinished) return
    isFinished = true
    node.style.transition = ""
    node.style.transform = ""
    node.style.willChange = ""
    node.style.zIndex = ""
    node.removeEventListener("transitionend", handleTransitionEnd)
    window.cancelAnimationFrame(animationFrame)
    window.clearTimeout(fallbackTimeout)
    onComplete()
  }

  const handleTransitionEnd = (event: TransitionEvent) => {
    if (event.target === node && event.propertyName === "transform") {
      finish()
    }
  }

  node.style.transition = "none"
  node.style.transform = `translate(${dx}px, ${dy}px)`
  node.style.willChange = "transform"
  node.style.zIndex = "20"
  node.getBoundingClientRect()

  node.addEventListener("transitionend", handleTransitionEnd)
  animationFrame = window.requestAnimationFrame(() => {
    node.style.transition = `transform ${duration}ms ease`
    node.style.transform = "translate(0, 0)"
  })
  fallbackTimeout = window.setTimeout(finish, fallbackDuration)

  return finish
}

export const animatePathFromRect = (
  path: SVGPathElement,
  fromRect: DOMRect | undefined,
  toRect: DOMRect
) => {
  if (!fromRect) return

  if (prefersReducedMotion()) {
    return
  }

  const dx = fromRect.left - toRect.left
  const dy = fromRect.top - toRect.top

  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
    return
  }

  let isFinished = false
  let animationFrame = 0
  let fallbackTimeout = 0

  const finish = () => {
    if (isFinished) return
    isFinished = true
    path.style.transition = ""
    path.style.transform = ""
    path.style.willChange = ""
    path.removeEventListener("transitionend", handleTransitionEnd)
    window.cancelAnimationFrame(animationFrame)
    window.clearTimeout(fallbackTimeout)
  }

  const handleTransitionEnd = (event: TransitionEvent) => {
    if (event.target === path && event.propertyName === "transform") {
      finish()
    }
  }

  path.style.transition = "none"
  path.style.transform = `translate(${dx}px, ${dy}px)`
  path.style.willChange = "transform"
  path.getBoundingClientRect()

  path.addEventListener("transitionend", handleTransitionEnd)
  animationFrame = window.requestAnimationFrame(() => {
    path.style.transition = `transform ${duration}ms ease`
    path.style.transform = "translate(0, 0)"
  })
  fallbackTimeout = window.setTimeout(finish, fallbackDuration)

  return finish
}

export const animatePathCurve = (
  path: SVGPathElement,
  fromCurve: SvgCurve,
  toCurve: SvgCurve,
  onComplete: () => void
) => {
  const targetPath = createSvgPath(toCurve)

  if (prefersReducedMotion()) {
    path.setAttribute("d", targetPath)
    onComplete()
    return
  }

  let isFinished = false
  let animationFrame = 0
  let startTime: number | undefined

  const finish = (complete: boolean) => {
    if (isFinished) return
    isFinished = true
    window.cancelAnimationFrame(animationFrame)
    path.setAttribute("d", targetPath)
    if (complete) {
      onComplete()
    }
  }

  const tick = (timestamp: number) => {
    startTime ??= timestamp
    const rawProgress = Math.min(1, (timestamp - startTime) / duration)
    const easedProgress = easeProgress(rawProgress)

    path.setAttribute("d", createSvgPath(interpolateCurve(fromCurve, toCurve, easedProgress)))

    if (rawProgress >= 1) {
      finish(true)
      return
    }

    animationFrame = window.requestAnimationFrame(tick)
  }

  path.setAttribute("d", createSvgPath(fromCurve))
  animationFrame = window.requestAnimationFrame(tick)

  return () => finish(false)
}

const getPathLength = (path: SVGPathElement) => {
  try {
    return path.getTotalLength()
  } catch {
    return 0
  }
}

const markerStaggerMs = 35
const surfaceChangeDurationMs = 180

const getMarkerAnimationElement = (marker: SVGGraphicsElement) => (
  marker.querySelector("circle") ?? marker
)

const clearMarkerEntranceStyles = (marker: SVGGraphicsElement) => {
  const element = getMarkerAnimationElement(marker)

  element.style.opacity = ""
  element.style.transform = ""
  element.style.willChange = ""
}

const clearBranchEntranceStyles = (
  path: SVGPathElement,
  node: HTMLElement,
  markers: SVGGraphicsElement[] = []
) => {
  path.style.strokeDasharray = ""
  path.style.strokeDashoffset = ""
  node.style.opacity = ""
  node.style.transform = ""
  node.style.willChange = ""
  markers.forEach(clearMarkerEntranceStyles)
}

export const showBranchNodeForEntrance = (node: HTMLElement) => {
  node.style.opacity = "0"
  node.style.transform = "translate(-8px, 6px)"
  node.style.willChange = "opacity, transform"
}

export const animateBranchEntrance = (
  path: SVGPathElement,
  node: HTMLElement,
  schedule: BranchEntranceScheduleEntry,
  markers: SVGGraphicsElement[] = []
) => {
  const pathLength = getPathLength(path)
  if (pathLength <= 0) {
    clearBranchEntranceStyles(path, node, markers)
    return
  }

  path.style.strokeDasharray = `${pathLength}`
  path.style.strokeDashoffset = `${pathLength}`
  showBranchNodeForEntrance(node)

  const pathAnimation = path.animate([
    { strokeDashoffset: `${pathLength}` },
    { strokeDashoffset: "0" }
  ], {
    delay: schedule.pathDelayMs,
    duration: schedule.pathDurationMs,
    easing: schedule.pathEasing,
    fill: "both"
  })

  const nodeAnimation = node.animate([
    { opacity: "0", transform: "translate(-8px, 6px)" },
    { opacity: "1", transform: "translate(0, 0)" }
  ], {
    delay: schedule.nodeDelayMs,
    duration: schedule.nodeDurationMs,
    easing: schedule.nodeEasing,
    fill: "both"
  })
  const markerAnimations = markers.map((marker, index) => {
    const markerElement = getMarkerAnimationElement(marker)

    markerElement.style.willChange = "opacity, transform"

    return markerElement.animate([
      { opacity: "0", transform: "scale(0.6)" },
      { opacity: "1", transform: "scale(1)" }
    ], {
      delay: schedule.pathDelayMs + index * markerStaggerMs,
      duration: schedule.pathDurationMs,
      easing: schedule.pathEasing,
      fill: "both"
    })
  })

  let isFinished = false

  const finish = () => {
    if (isFinished) return
    isFinished = true
    clearBranchEntranceStyles(path, node, markers)
  }

  Promise
    .all([pathAnimation.finished, nodeAnimation.finished, ...markerAnimations.map((animation) => animation.finished)])
    .then(finish)
    .catch(() => {})

  return () => {
    pathAnimation.cancel()
    nodeAnimation.cancel()
    markerAnimations.forEach((animation) => animation.cancel())
    finish()
  }
}

export const animateSurfacePanelChange = (element: HTMLElement) => {
  if (prefersReducedMotion()) return

  const animation = element.animate([
    { opacity: "0.72", transform: "translateY(4px)" },
    { opacity: "1", transform: "translateY(0)" }
  ], {
    duration: surfaceChangeDurationMs,
    easing: defaultBranchEntranceAnimationConfig.nodeEasing
  })

  return () => animation.cancel()
}
