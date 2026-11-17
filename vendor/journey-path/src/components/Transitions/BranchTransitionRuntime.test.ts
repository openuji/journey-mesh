import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createBranchTransitionRuntime } from "./BranchTransitionRuntime"
import { createTransitionPathId } from "./transitionPathDescriptors"

const rect = (left: number, top: number, width = 10, height = 10) => ({
  left,
  top,
  width,
  height
}) as DOMRect

const animatablePathElement = (d = "M 0 0 C 50 0, 50 40, 100 40") => {
  const attributes = new Map<string, string>()
  if (d) {
    attributes.set("d", d)
  }

  const element = {
    getAttribute: vi.fn((name: string) => attributes.get(name) ?? null),
    getTotalLength: vi.fn(() => attributes.get("d") ? 100 : 0),
    animate: vi.fn(() => ({
      cancel: vi.fn(),
      finished: new Promise(() => {})
    })),
    style: {}
  } as unknown as SVGPathElement & { animate: ReturnType<typeof vi.fn> }

  return { attributes, element }
}

const animatableElementWithRect = (getRect: () => DOMRect) => ({
  getBoundingClientRect: getRect,
  animate: vi.fn(() => ({
    cancel: vi.fn(),
    finished: new Promise(() => {})
  })),
  style: {}
}) as unknown as HTMLElement & { animate: ReturnType<typeof vi.fn> }

const descriptor = (id: string) => ({
  id,
  sourceId: "login",
  targetId: "Succeeded",
  status: "branch" as const
})

const stubAnimationWindow = (reducedMotion = false) => {
  vi.stubGlobal("window", {
    matchMedia: vi.fn(() => ({ matches: reducedMotion }))
  })
}

describe("branch transition runtime", () => {
  beforeEach(() => {
    stubAnimationWindow(true)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("plays branch entrance when the branch path and node are ready", () => {
    stubAnimationWindow()

    const runtime = createBranchTransitionRuntime()
    const edgeId = createTransitionPathId("login", "Succeeded")
    const node = animatableElementWithRect(() => rect(360, 40, 80, 42))
    const path = animatablePathElement()

    runtime.registerPath(edgeId, path.element)
    runtime.registerNode("Succeeded", node)
    runtime.syncPaths([descriptor(edgeId)])

    expect(path.element.animate).toHaveBeenCalled()
    expect(node.animate).toHaveBeenCalled()
  })

  it("keeps branch entrance pending until the node ref registers", async () => {
    stubAnimationWindow()

    const runtime = createBranchTransitionRuntime()
    const edgeId = createTransitionPathId("login", "Succeeded")
    const node = animatableElementWithRect(() => rect(360, 40, 80, 42))
    const path = animatablePathElement()

    runtime.registerPath(edgeId, path.element)
    runtime.syncPaths([descriptor(edgeId)])

    expect(path.element.animate).not.toHaveBeenCalled()

    runtime.registerNode("Succeeded", node)
    await Promise.resolve()

    expect(path.element.animate).toHaveBeenCalled()
    expect(node.animate).toHaveBeenCalled()
  })

  it("keeps branch entrance pending until path data is rendered", () => {
    stubAnimationWindow()

    const runtime = createBranchTransitionRuntime()
    const edgeId = createTransitionPathId("login", "Succeeded")
    const node = animatableElementWithRect(() => rect(360, 40, 80, 42))
    const path = animatablePathElement("")

    runtime.registerPath(edgeId, path.element)
    runtime.registerNode("Succeeded", node)
    runtime.syncPaths([descriptor(edgeId)])

    expect(path.element.animate).not.toHaveBeenCalled()

    path.attributes.set("d", "M 0 0 C 50 0, 50 40, 100 40")
    runtime.syncPaths([descriptor(edgeId)])

    expect(path.element.animate).toHaveBeenCalled()
    expect(node.animate).toHaveBeenCalled()
  })

  it("does not replay branch entrance for an edge that already entered", () => {
    stubAnimationWindow()

    const runtime = createBranchTransitionRuntime()
    const edgeId = createTransitionPathId("login", "Succeeded")
    const node = animatableElementWithRect(() => rect(360, 40, 80, 42))
    const path = animatablePathElement()

    runtime.registerPath(edgeId, path.element)
    runtime.registerNode("Succeeded", node)
    runtime.syncPaths([descriptor(edgeId)])
    runtime.syncPaths([descriptor(edgeId)])

    expect(path.element.animate).toHaveBeenCalledTimes(1)
    expect(node.animate).toHaveBeenCalledTimes(1)
  })
})
