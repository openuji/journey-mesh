import {
  animateBranchEntrance,
  animateNodeFromRect,
  getBranchEntranceSchedule,
  prefersReducedMotion
} from "./transitionMotion"
import type { TransitionPathDescriptor } from "./transitionPathDescriptors"

export type EndpointRole = "in" | "out"

type Cleanup = () => void

interface PathLayerConfig {
  descriptors: TransitionPathDescriptor[];
}

export interface BranchTransitionRuntime {
  registerNode: (id: string, element: HTMLElement) => Cleanup;
  registerPath: (id: string, element: SVGPathElement) => Cleanup;
  registerMarker: (pathId: string, index: number, element: SVGGraphicsElement) => Cleanup;
  captureBeforePathChange: (nextVisibleIds: Iterable<string>) => void;
  syncPaths: (descriptors: TransitionPathDescriptor[]) => void;
  destroy: () => void;
}

const hasDrawablePath = (path: SVGPathElement) => {
  if (!path.getAttribute("d")) return false

  try {
    return path.getTotalLength() > 0
  } catch {
    return false
  }
}

class Runtime implements BranchTransitionRuntime {
  private readonly nodeElements = new Map<string, HTMLElement>()
  private readonly pathElements = new Map<string, SVGPathElement>()
  private readonly markerElements = new Map<string, Map<number, SVGGraphicsElement>>()
  private readonly pendingNodeRects = new Map<string, DOMRect>()
  private readonly pendingBranchEntranceIds = new Set<string>()
  private readonly playedBranchEntranceIds = new Set<string>()
  private readonly nodeMoveCleanups = new Map<string, Cleanup>()
  private readonly branchEntranceCleanups = new Map<string, Cleanup>()

  private pathLayerConfig?: PathLayerConfig
  private syncQueued = false

  registerNode(id: string, element: HTMLElement) {
    this.nodeElements.set(id, element)
    this.scheduleSyncPaths()

    return () => {
      if (this.nodeElements.get(id) === element) {
        this.clearBranchEntranceAnimationsForTarget(id)
        this.nodeElements.delete(id)
      }
    }
  }

  registerPath(id: string, element: SVGPathElement) {
    this.pathElements.set(id, element)
    this.scheduleSyncPaths()

    return () => {
      if (this.pathElements.get(id) !== element) return

      this.pathElements.delete(id)
      this.clearPathState(id)
    }
  }

  registerMarker(pathId: string, index: number, element: SVGGraphicsElement) {
    const markers = this.markerElements.get(pathId) ?? new Map<number, SVGGraphicsElement>()
    markers.set(index, element)
    this.markerElements.set(pathId, markers)
    this.scheduleSyncPaths()

    return () => {
      const currentMarkers = this.markerElements.get(pathId)
      if (currentMarkers?.get(index) !== element) return

      currentMarkers.delete(index)
      if (currentMarkers.size === 0) {
        this.markerElements.delete(pathId)
      }
    }
  }

  captureBeforePathChange(nextVisibleIds: Iterable<string>) {
    const visibleIds = new Set(nextVisibleIds)
    this.pendingNodeRects.clear()

    this.nodeElements.forEach((element, id) => {
      if (visibleIds.has(id)) {
        this.pendingNodeRects.set(id, element.getBoundingClientRect())
      }
    })
  }

  syncPaths(descriptors: TransitionPathDescriptor[]) {
    this.pathLayerConfig = {
      descriptors: descriptors.map((descriptor) => ({ ...descriptor }))
    }

    const nextIds = new Set(descriptors.map((descriptor) => descriptor.id))

    descriptors.forEach((descriptor) => {
      if (descriptor.status === "main") {
        this.clearPathState(descriptor.id)
        return
      }

      if (!this.playedBranchEntranceIds.has(descriptor.id)) {
        this.pendingBranchEntranceIds.add(descriptor.id)
      }
    })

    this.clearRemovedPaths(nextIds)
    this.playPendingBranchEntrances(descriptors)

    this.playPendingNodeMoves()
  }

  destroy() {
    this.nodeMoveCleanups.forEach((cleanup) => cleanup())
    this.branchEntranceCleanups.forEach((cleanup) => cleanup())

    this.nodeElements.clear()
    this.pathElements.clear()
    this.markerElements.clear()
    this.pendingNodeRects.clear()
    this.pendingBranchEntranceIds.clear()
    this.playedBranchEntranceIds.clear()
    this.nodeMoveCleanups.clear()
    this.branchEntranceCleanups.clear()
    this.pathLayerConfig = undefined
    this.syncQueued = false
  }

  private playPendingNodeMoves() {
    this.pendingNodeRects.forEach((fromRect, id) => {
      const node = this.nodeElements.get(id)
      if (!node) return

      this.nodeMoveCleanups.get(id)?.()
      const cleanup = animateNodeFromRect(node, fromRect, () => {
        this.nodeMoveCleanups.delete(id)
        this.pendingNodeRects.delete(id)
      })

      if (cleanup) {
        this.nodeMoveCleanups.set(id, cleanup)
      } else {
        this.pendingNodeRects.delete(id)
      }
    })
  }

  private clearBranchEntranceAnimation(id: string) {
    this.branchEntranceCleanups.get(id)?.()
    this.branchEntranceCleanups.delete(id)
  }

  private clearBranchEntranceAnimationsForTarget(targetId: string) {
    this.pathLayerConfig?.descriptors.forEach((descriptor) => {
      if (descriptor.targetId === targetId) {
        this.clearBranchEntranceAnimation(descriptor.id)
      }
    })
  }

  private clearPathState(id: string) {
    this.clearBranchEntranceAnimation(id)
    this.pendingBranchEntranceIds.delete(id)
    this.playedBranchEntranceIds.delete(id)
  }

  private clearRemovedPaths(nextIds: Set<string>) {
    this.pendingBranchEntranceIds.forEach((id) => {
      if (!nextIds.has(id)) {
        this.clearPathState(id)
      }
    })
    this.playedBranchEntranceIds.forEach((id) => {
      if (!nextIds.has(id)) {
        this.clearPathState(id)
      }
    })
    this.branchEntranceCleanups.forEach((_, id) => {
      if (!nextIds.has(id)) {
        this.clearPathState(id)
      }
    })
  }

  private playPendingBranchEntrances(descriptors: TransitionPathDescriptor[]) {
    if (this.pendingBranchEntranceIds.size === 0) return

    const readyDescriptors = descriptors.filter((descriptor) => {
      if (descriptor.status !== "branch") return false
      if (!this.pendingBranchEntranceIds.has(descriptor.id)) return false

      const path = this.pathElements.get(descriptor.id)
      const node = this.nodeElements.get(descriptor.targetId)

      return Boolean(path && node && hasDrawablePath(path))
    })

    if (readyDescriptors.length === 0) return

    const descriptorById = new Map(readyDescriptors.map((descriptor) => [descriptor.id, descriptor]))

    if (prefersReducedMotion()) {
      readyDescriptors.forEach((descriptor) => {
        this.pendingBranchEntranceIds.delete(descriptor.id)
        this.playedBranchEntranceIds.add(descriptor.id)
      })
      return
    }

    getBranchEntranceSchedule(readyDescriptors.map((descriptor) => descriptor.id)).forEach((schedule) => {
      const descriptor = descriptorById.get(schedule.label)
      const path = this.pathElements.get(schedule.label)
      const node = descriptor ? this.nodeElements.get(descriptor.targetId) : undefined
      const markers = this.getPathMarkers(schedule.label)
      if (!path || !node) return

      const cleanup = animateBranchEntrance(path, node, schedule, markers)
      this.pendingBranchEntranceIds.delete(schedule.label)
      this.playedBranchEntranceIds.add(schedule.label)

      if (cleanup) {
        this.branchEntranceCleanups.set(schedule.label, cleanup)
      }
    })
  }

  private getPathMarkers(pathId: string) {
    return [...(this.markerElements.get(pathId) ?? new Map()).entries()]
      .sort(([left], [right]) => left - right)
      .map(([, element]) => element)
  }

  private scheduleSyncPaths() {
    if (!this.pathLayerConfig || this.syncQueued) return

    this.syncQueued = true
    queueMicrotask(() => {
      this.syncQueued = false
      if (!this.pathLayerConfig) return

      this.syncPaths(this.pathLayerConfig.descriptors)
    })
  }
}

export const createBranchTransitionRuntime = (): BranchTransitionRuntime => new Runtime()
