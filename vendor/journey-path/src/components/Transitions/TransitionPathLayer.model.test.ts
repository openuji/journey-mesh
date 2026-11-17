import { describe, expect, it } from "vitest"
import type { UJGGraphTransition } from "../../data/parser"
import { getTransitionEffectMarkerSummary } from "./TransitionPathLayer.model"

const transition = (
  effectAnnotations: UJGGraphTransition["effectAnnotations"]
): Pick<UJGGraphTransition, "effectAnnotations"> => ({
  ...(effectAnnotations ? { effectAnnotations } : {})
})

describe("getTransitionEffectMarkerSummary", () => {
  it("returns no icons or details without effect annotations", () => {
    expect(getTransitionEffectMarkerSummary(transition(undefined))).toEqual({
      consumed: [],
      effects: [],
      icons: [],
      produced: []
    })
  })

  it("maps produced resources to produced icon items", () => {
    const summary = getTransitionEffectMarkerSummary(transition([
      {
        transitionRef: "transition:confirm",
        effect: {
          id: "effect:confirm",
          label: "Confirm share"
        },
        resources: [
          {
            id: "artifact:share",
            label: "Federated share",
            direction: "produced"
          }
        ]
      }
    ]))

    expect(summary.icons).toMatchObject([
      {
        direction: "produced",
        effectLabel: "Confirm share",
        resourceLabel: "Federated share"
      }
    ])
    expect(summary.produced).toEqual(["Federated share"])
    expect(summary.consumed).toEqual([])
  })

  it("maps consumed resources to consumed icon items", () => {
    const summary = getTransitionEffectMarkerSummary(transition([
      {
        transitionRef: "transition:accept",
        effect: {
          id: "effect:accept",
          label: "Accept share"
        },
        resources: [
          {
            id: "artifact:share",
            label: "Federated share",
            direction: "consumed"
          }
        ]
      }
    ]))

    expect(summary.icons).toMatchObject([
      {
        direction: "consumed",
        effectLabel: "Accept share",
        resourceLabel: "Federated share"
      }
    ])
    expect(summary.produced).toEqual([])
    expect(summary.consumed).toEqual(["Federated share"])
  })

  it("preserves one icon per resource in annotation order", () => {
    const summary = getTransitionEffectMarkerSummary(transition([
      {
        transitionRef: "transition:mixed",
        effect: {
          id: "effect:mixed"
        },
        resources: [
          {
            id: "artifact:first",
            direction: "produced"
          },
          {
            id: "artifact:second",
            label: "Second artifact",
            direction: "consumed"
          }
        ]
      },
      {
        transitionRef: "transition:mixed",
        effect: {
          id: "effect:next",
          label: "Next effect"
        },
        resources: [
          {
            id: "artifact:third",
            direction: "produced"
          }
        ]
      }
    ]))

    expect(summary.icons.map((icon) => icon.resourceLabel)).toEqual([
      "artifact:first",
      "Second artifact",
      "artifact:third"
    ])
    expect(summary.effects).toEqual(["effect:mixed", "Next effect"])
    expect(summary.produced).toEqual(["artifact:first", "artifact:third"])
    expect(summary.consumed).toEqual(["Second artifact"])
  })
})
