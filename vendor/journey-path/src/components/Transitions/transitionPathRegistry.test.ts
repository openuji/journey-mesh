import {  expect, it } from "vitest"
import { createTransitionPathRegistry } from "./transitionPathRegistry"



it("keeps repeated semantic edges as separate visual path occurrences", () => {
  const registry = createTransitionPathRegistry()

  const firstOut = registry.createEndpoint("processing", "out", "main:1:processing")
  const firstIn = registry.createEndpoint("error", "in", "main:2:error")

  const secondOut = registry.createEndpoint("processing", "out", "main:4:processing")
  const secondIn = registry.createEndpoint("error", "in", "main:4:processing:branch:0:error")

  registry.registerPath({
    out: firstOut,
    in: firstIn,
    status: "main"
  })

  registry.registerPath({
    out: secondOut,
    in: secondIn,
    status: "branch"
  })

  expect(registry.getSnapshot().paths).toHaveLength(2)
  expect(registry.getSnapshot().descriptors).toEqual([
    {
      id: "main%3A1%3Aprocessing->main%3A2%3Aerror",
      sourceId: "processing",
      targetId: "error",
      status: "main"
    },
    {
      id: "main%3A4%3Aprocessing->main%3A4%3Aprocessing%3Abranch%3A0%3Aerror",
      sourceId: "processing",
      targetId: "error",
      status: "branch"
    }
  ])
})