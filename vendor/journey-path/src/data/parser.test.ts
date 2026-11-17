import { describe, expect, it } from "vitest"
import cycleRefYaml from "../fixtures/cycleref.ujg.yaml?raw"
import exitRefYaml from "../fixtures/exitref.ujg.yaml?raw"
import filesharingYaml from "../fixtures/filesharing.ujg.yaml?raw"
import multipleTransitionsYaml from "../fixtures/multiple-transitions.ujg.yaml?raw"
import oidcYaml from "../fixtures/3touchpoints.v6.ujg.yaml?raw"
import { mapYaml } from "./parser"
import type {
  GraphTree,
  UJGGraphState,
  UJGTransition,
  UJGGraphTransition
} from "./parser"

const getTransition = (
  transitions: UJGGraphTransition[],
  transitionId: string
): UJGGraphTransition => {
  const transition = transitions.find((item) => item.id === transitionId)
  if (!transition) {
    throw new Error(`Transition ${transitionId} not found`)
  }

  return transition
}

const getTargetState = (
  state: UJGGraphState,
  targetStateId: string
): UJGGraphState => {
  const targetState = state.to?.find((item) => item.id === targetStateId)
  if (!targetState) {
    throw new Error(`Target state ${targetStateId} not found`)
  }

  return targetState
}

const getLoginErrorTryAgain = (source: string): UJGGraphState => {
  const { registry } = mapYaml(source)
  const root = registry.getStateTransitions(registry.getRootDefaultEntry().stateRef)
  const callback = getTargetState(root, "app-auth-callback-processing")
  const loginError = getTargetState(callback, "app-login-error")

  return getTargetState(loginError, "app-sign-in-required")
}

const getSupportFromRoot = (source: string): UJGGraphState => {
  const { registry } = mapYaml(source)
  const root = registry.getStateTransitions(registry.getRootDefaultEntry().stateRef)

  return getTargetState(root, "app-support")
}

const getGraphIds = (state: GraphTree): string[] => {
  return [
    state.id,
    ...((state.branch || []).flatMap((branch) => getGraphIds(branch)))
  ]
}

const getStateGraphIds = (state: UJGGraphState): string[] => {
  return [
    state.id,
    ...((state.to || []).flatMap((branch) => getStateGraphIds(branch)))
  ]
}

const getTraceIds = (transition: UJGGraphTransition): string[] => {
  return transition.trace?.map((item) => item.id) || []
}

const getOnlyExitResolvedTrace = (
  traces: UJGTransition[][] | undefined,
  traceId: string
): UJGTransition[] => {
  if (!traces || traces.length !== 1) {
    throw new Error(`Expected one exit trace for ${traceId}, got ${traces?.length || 0}`)
  }

  return traces[0]
}

const getTransitionIds = (transitions: UJGTransition[]): string[] => {
  return transitions.map((transition) => transition.id)
}

const dagYaml = `
journey:
  id: shared-target
  defaultEntryRef: start
  entries:
    start:
      stateRef: a
  states:
    a:
      type: State
      label: A
      transitions:
        - id: a-to-b
          label: A to B
          to: b
        - id: a-to-c
          label: A to C
          to: c
    b:
      type: State
      label: B
      transitions:
        - id: b-to-d
          label: B to D
          to: d
    c:
      type: State
      label: C
      transitions:
        - id: c-to-d
          label: C to D
          to: d
    d:
      type: State
      label: D
`

const exitDelegationCycleYaml = `
journey:
  id: app
  defaultEntryRef: start-entry
  entries:
    start-entry:
      stateRef: app-start
  states:
    app-start:
      type: State
      label: App start
      transitions:
        - id: app-starts-child-flow
          label: Start child flow
          to: child-flow
    child-flow:
      type: CompositeState
      label: Child flow
      subjourney:
        id: child
        defaultEntryRef: child-start-entry
        entries:
          child-start-entry:
            stateRef: child-start
        states:
          child-start:
            type: State
            label: Child start
            transitions:
              - id: child-completes
                label: Complete
                to: child-done
        exits:
          child-done:
            type: JourneyExit
            label: Child done
  transitions:
    - id: child-done-handler
      label: Re-enter child exit
      from: child-flow
      fromExitRef: child-done
      to: child-done
`

describe("UJG parser", () => {
  it("keeps a cycle target visible in the graph tree", () => {
    expect(mapYaml(cycleRefYaml).graph).toEqual({
      id: "app-sign-in-required",
      branch: [
        {
          id: "app-auth-callback-processing",
          branch: [
            { id: "app-logged-in" },
            {
              id: "app-login-error",
              branch: [
                { id: "app-sign-in-required", cycle: true },
                {
                  id: "app-support",
                  branch: [{ id: "app-sign-in-required", cycle: true }]
                }
              ]
            }
          ]
        },
        {
          id: "app-support",
          branch: [{ id: "app-sign-in-required", cycle: true }]
        }
      ]
    })
  })

  it("creates a shallow cycle target state without mutating the registry state", () => {
    const { registry } = mapYaml(cycleRefYaml)
    const root = registry.getStateTransitions(registry.getRootDefaultEntry().stateRef)
    const callback = getTargetState(root, "app-auth-callback-processing")
    const loginError = getTargetState(callback, "app-login-error")
    const cycleTarget = getTargetState(loginError, "app-sign-in-required")
    const rawRoot = registry.states.get("app-sign-in-required")

    expect(cycleTarget).toMatchObject({
      id: "app-sign-in-required",
      cycle: true
    })
    expect(cycleTarget.to).toBeUndefined()
    expect(rawRoot && "cycle" in rawRoot).toBe(false)
  })

  it("maps journey-level transitions into outgoing state topology", () => {
    const support = getSupportFromRoot(cycleRefYaml)

    expect(support).toMatchObject({
      id: "app-support",
      to: [{ id: "app-sign-in-required", cycle: true }]
    })
  })

  it("detects cycles created by journey-level transitions", () => {
    const support = getSupportFromRoot(cycleRefYaml)
    const cycleTarget = getTargetState(support, "app-sign-in-required")

    expect(cycleTarget).toMatchObject({
      id: "app-sign-in-required",
      cycle: true
    })
    expect(cycleTarget.to).toBeUndefined()
  })

  it("detects cycles from topology without using cycle-reference tags", () => {
    const sourceWithoutCycleTag = cycleRefYaml.replace(/^\s*(?:#\s*)?-\s+cycle-reference\n/gm, "")
    const cycleTarget = getLoginErrorTryAgain(sourceWithoutCycleTag)

    expect(sourceWithoutCycleTag).not.toContain("cycle-reference")
    expect(cycleTarget).toMatchObject({
      id: "app-sign-in-required",
      cycle: true
    })
    expect(cycleTarget.to).toBeUndefined()
  })

  it("returns JSON-serializable cyclic graph projections", () => {
    const { graph, registry } = mapYaml(cycleRefYaml)
    const root = registry.getStateTransitions(registry.getRootDefaultEntry().stateRef)

    expect(() => JSON.stringify(graph)).not.toThrow()
    expect(() => JSON.stringify(root)).not.toThrow()
  })

  it("does not treat shared DAG targets as cycles", () => {
    const { graph, registry } = mapYaml(dagYaml)
    const root = registry.getStateTransitions(registry.getRootDefaultEntry().stateRef)
    const b = getTargetState(root, "b")
    const c = getTargetState(root, "c")
    const bToD = getTargetState(b, "d")
    const cToD = getTargetState(c, "d")

    expect(graph).toEqual({
      id: "a",
      branch: [
        { id: "b", branch: [{ id: "d" }] },
        { id: "c", branch: [{ id: "d" }] }
      ]
    })
    expect(bToD.cycle).toBeUndefined()
    expect(cToD.cycle).toBeUndefined()
  })

  it("delegates exit-target transitions to parent journey transitions", () => {
    const { registry } = mapYaml(exitRefYaml)
    const root = registry.getStateTransitions(registry.getRootDefaultEntry().stateRef)
    const idpLogin = getTargetState(root, "idp-login")
    const success = getTransition(
      registry.getResolvedTransitions("idp-login", "app-auth-callback-processing"),
      "app-continues-after-idp-success"
    )
    const cancelled = getTransition(
      registry.getResolvedTransitions("idp-login", "app-login-cancelled"),
      "app-continues-after-idp-cancelled"
    )

    expect(getTargetState(idpLogin, "app-auth-callback-processing").id).toBe("app-auth-callback-processing")
    expect(success.toState.id).toBe("app-auth-callback-processing")
    expect(getTraceIds(success)).toEqual([
      "idp-login-to-success",
      "app-continues-after-idp-success"
    ])
    expect(getTargetState(idpLogin, "app-login-cancelled").id).toBe("app-login-cancelled")
    expect(cancelled.toState.id).toBe("app-login-cancelled")
    expect(getTraceIds(cancelled)).toEqual([
      "idp-login-cancelled",
      "app-continues-after-idp-cancelled"
    ])
  })

  it("indexes exit-caused traces by source state and transition ids", () => {
    const { registry } = mapYaml(exitRefYaml)
    const successTrace = getOnlyExitResolvedTrace(
      registry.getExitResolvedTraces("idp-login", "idp-login-to-success"),
      "idp-login-to-success"
    )
    const cancelledTrace = getOnlyExitResolvedTrace(
      registry.getExitResolvedTraces("idp-login", "idp-login-cancelled"),
      "idp-login-cancelled"
    )

    expect([getTransitionIds(successTrace), getTransitionIds(cancelledTrace)]).toEqual([
      ["idp-login-to-success", "app-continues-after-idp-success"],
      ["idp-login-cancelled", "app-continues-after-idp-cancelled"]
    ])
    expect(registry.getExitResolvedTraces("app-sign-in-required", "idp-login-to-success")).toEqual([])
  })

  it("does not render JourneyExit ids as graph nodes", () => {
    const { graph } = mapYaml(exitRefYaml)
    const ids = getGraphIds(graph)

    expect(ids).not.toContain("idp-auth-success")
    expect(ids).not.toContain("idp-auth-cancelled")
    expect(() => JSON.stringify(graph)).not.toThrow()
  })

  it("groups multiple source transitions that resolve to the same visible state", () => {
    const { graph, registry } = mapYaml(multipleTransitionsYaml)
    const transitions = registry.getResolvedTransitions("app-sign-in-required", "idp-login")

    expect(graph).toEqual({
      id: "app-sign-in-required",
      branch: [
        {
          id: "idp-login",
          branch: [
            {
              id: "app-auth-callback-processing",
              branch: [{ id: "app-logged-in" }]
            },
            { id: "app-login-cancelled" }
          ]
        }
      ]
    })
    expect(transitions.map((transition) => transition.id)).toEqual([
      "app-starts-idp-account",
      "app-tell-us-idp-account"
    ])
    expect(transitions.map(getTraceIds)).toEqual([
      ["app-starts-idp-account"],
      ["app-tell-us-idp-account"]
    ])
  })

  it("treats JourneyjourneyEntryIndex roots as multiple non-traversable start options", () => {
    const { graph, hierarchy, registry, rootStartOptions } = mapYaml(filesharingYaml)

    expect(rootStartOptions).toEqual([
      {
        id: "urn:composite:alice-federated-sharing",
        label: "Alice federated sharing entry",
        stateRef: "urn:composite:alice-federated-sharing",
        effectiveStateRef: "urn:state:alice-files-ready"
      },
      {
        id: "urn:composite:bob-remote-share",
        label: "Bob remote-share entry",
        stateRef: "urn:composite:bob-remote-share",
        effectiveStateRef: "urn:state:bob-incoming-share-visible"
      }
    ])
    expect(hierarchy.rootJourneyRef).toBe("urn:index:nextcloud-federated-sharing")
    expect(hierarchy.root.stateRefs.map((state) => state.stateRef)).toEqual([
      "urn:composite:alice-federated-sharing",
      "urn:composite:bob-remote-share"
    ])
    expect(registry.journeys.has("urn:index:nextcloud-federated-sharing")).toBe(false)
    expect(registry.journeys.has("urn:journey:alice-federated-sharing")).toBe(true)
    expect(registry.journeys.has("urn:journey:bob-remote-share")).toBe(true)
    expect(getGraphIds(graph)).toEqual([
      "urn:state:alice-files-ready",
      "urn:state:alice-share-panel-open",
      "urn:state:alice-remote-recipient-entered",
      "urn:state:alice-share-permissions-open",
      "urn:state:alice-share-confirmed"
    ])
  })

  it("resolves journey properties from touchpoint and user metadata", () => {
    const { registry } = mapYaml(filesharingYaml)
    const [aliceStart, bobStart] = registry.getRootStartOptions()

    expect(registry.getJourneyProperties(aliceStart.stateRef)).toEqual({
      touchpoints: [
        {
          id: "urn:touchpoint:nextcloud-a",
          label: "Nextcloud A"
        }
      ],
      users: [
        {
          id: "urn:user:alice",
          label: "Alice"
        }
      ]
    })
    expect(registry.getJourneyProperties(bobStart.stateRef)).toEqual({
      touchpoints: [
        {
          id: "urn:touchpoint:nextcloud-b",
          label: "Nextcloud B"
        }
      ],
      users: [
        {
          id: "urn:user:bob",
          label: "Bob"
        }
      ]
    })
  })

  it("exposes phase and step structure without changing graph traversal", () => {
    const { registry } = mapYaml(filesharingYaml)
    const structure = registry.getJourneyMapStructure()

    expect(structure).toEqual([
      {
        phase: {
          id: "urn:phase:remote-share-offered",
          label: "Remote share offered",
          order: 1
        },
        steps: [
          {
            id: "urn:step:alice-federated-sharing",
            label: "Alice offers the remote share",
            order: 1,
            compositeStateRef: "urn:composite:alice-federated-sharing",
            phaseRef: "urn:phase:remote-share-offered"
          },
          {
            id: "urn:step:bob-remote-share-offer",
            label: "Bob receives the remote-share offer",
            order: 2,
            compositeStateRef: "urn:composite:bob-remote-share-offer",
            phaseRef: "urn:phase:remote-share-offered"
          }
        ]
      },
      {
        phase: {
          id: "urn:phase:pending-share-offer-cleared",
          label: "Remote share accepted",
          order: 2
        },
        steps: [
          {
            id: "urn:step:bob-pending-share-offer-cleared",
            label: "Bob verifies accepted remote-share access",
            compositeStateRef: "urn:composite:bob-pending-share-offer-cleared",
            phaseRef: "urn:phase:pending-share-offer-cleared"
          }
        ]
      }
    ])
    expect(registry.getJourneyMapStructureByRootId("urn:index:nextcloud-federated-sharing")).toEqual(structure)
    expect(registry.getJourneyMapStructureByRootId("urn:composite:alice-federated-sharing")).toEqual([
      {
        phase: {
          id: "urn:phase:remote-share-offered",
          label: "Remote share offered",
          order: 1
        },
        steps: [
          {
            id: "urn:step:alice-federated-sharing",
            label: "Alice offers the remote share",
            order: 1,
            compositeStateRef: "urn:composite:alice-federated-sharing",
            phaseRef: "urn:phase:remote-share-offered"
          }
        ]
      }
    ])
    expect(registry.getJourneyMapStructureByRootId("missing-root")).toEqual([])
    expect(mapYaml(oidcYaml).registry.getJourneyMapStructure()).toEqual([])
  })

  it("resolves state step context from graph containment on demand", () => {
    const { registry } = mapYaml(filesharingYaml)

    expect(registry.getStateStepContext("urn:state:alice-share-panel-open")).toMatchObject({
      stateRef: "urn:state:alice-share-panel-open",
      step: {
        id: "urn:step:alice-federated-sharing",
        label: "Alice offers the remote share"
      },
      phase: {
        id: "urn:phase:remote-share-offered",
        label: "Remote share offered"
      }
    })
    expect(registry.getStateStepContext("urn:composite:bob-remote-share-offer")).toMatchObject({
      stateRef: "urn:composite:bob-remote-share-offer",
      step: {
        id: "urn:step:bob-remote-share-offer",
        label: "Bob receives the remote-share offer"
      },
      phase: {
        id: "urn:phase:remote-share-offered"
      }
    })
    expect(registry.getStateStepContext("urn:state:bob-shared-report-visible")).toMatchObject({
      stateRef: "urn:state:bob-shared-report-visible",
      step: {
        id: "urn:step:bob-pending-share-offer-cleared",
        label: "Bob verifies accepted remote-share access"
      },
      phase: {
        id: "urn:phase:pending-share-offer-cleared"
      }
    })
    expect(registry.getStateStepContext("missing-state")).toBeUndefined()
  })

  it("exposes transition effect annotations for produced and consumed artifacts", () => {
    const { registry } = mapYaml(filesharingYaml)
    const aliceConfirm = getTransition(
      registry.getResolvedTransitions(
        "urn:state:alice-share-permissions-open",
        "urn:state:alice-share-confirmed"
      ),
      "urn:transition:alice-confirms-share"
    )
    const bobAccept = registry.getResolvedTransitions(
      "urn:state:bob-incoming-share-visible",
      "urn:state:bob-pending-share-offer-cleared"
    )[0]

    expect(registry.getTransitionEffectAnnotations("urn:transition:alice-confirms-share")).toEqual([
      {
        transitionRef: "urn:transition:alice-confirms-share",
        effect: {
          id: "urn:effect:alice-confirm-share",
          label: "Alice confirms the remote share"
        },
        resources: [
          {
            id: "urn:artifact:federated-share",
            label: "Federated share for the test file",
            direction: "produced"
          }
        ]
      }
    ])
    expect(aliceConfirm.effectAnnotations).toEqual([
      {
        transitionRef: "urn:transition:alice-confirms-share",
        effect: {
          id: "urn:effect:alice-confirm-share",
          label: "Alice confirms the remote share"
        },
        resources: [
          {
            id: "urn:artifact:federated-share",
            label: "Federated share for the test file",
            direction: "produced"
          }
        ]
      }
    ])
    expect(bobAccept.effectAnnotations).toEqual([
      {
        transitionRef: "urn:transition:bob-accepts-share",
        effect: {
          id: "urn:effect:bob-accept-share",
          label: "Bob accepts the remote share"
        },
        resources: [
          {
            id: "urn:artifact:federated-share",
            label: "Federated share for the test file",
            direction: "consumed"
          }
        ]
      }
    ])
  })

  it("discovers paths from every JourneyjourneyEntryIndex start", () => {
    const { registry } = mapYaml(filesharingYaml)
    const bobStart = registry.getRootStartOptions()[1]
    const bobRoot = registry.getStateTransitions(bobStart.effectiveStateRef)

    expect(getStateGraphIds(bobRoot)).toEqual([
      "urn:state:bob-incoming-share-visible",
      "urn:state:bob-pending-share-offer-cleared",
      "urn:state:bob-shared-report-visible"
    ])
  })

  it("traces nested exit delegation within the IdP journey", () => {
    const { registry } = mapYaml(oidcYaml)
    const mfaCode = registry.getStateTransitions("mfa-enter-authenticator-code")
    const success = getTransition(
      registry.getResolvedTransitions("mfa-enter-authenticator-code", "identity-consent"),
      "idp-mfa-success-to-identity-consent"
    )

    expect(getTargetState(mfaCode, "identity-consent").id).toBe("identity-consent")
    expect(success.toState.id).toBe("identity-consent")
    expect(getTraceIds(success)).toEqual([
      "mfa-enter-authenticator-code-to-success",
      "idp-mfa-success-to-identity-consent"
    ])
  })

  it("explains all Login transitions in place with trace", () => {
    const { registry } = mapYaml(oidcYaml)
    const login = registry.getStateTransitions("idp-login")
    const loginTransitions = [...registry.getResolvedTransitionMap("idp-login").values()].flat()

    expect(login.to).toHaveLength(12)
    expect(loginTransitions.map((transition) => transition.id)).toEqual([
      "idp-login-to-error",
      "idp-login-to-account-selection",
      "idp-login-to-mfa-method-choice",
      "idp-login-to-authenticator-code",
      "idp-login-to-sms-code",
      "idp-login-to-email-code",
      "idp-login-to-push-approval",
      "idp-login-to-security-key",
      "idp-login-to-identity-consent",
      "idp-login-to-resource-consent",
      "app-continues-after-idp-success",
      "app-continues-after-idp-cancelled"
    ])
    expect(loginTransitions.map(getTraceIds)).toEqual([
      ["idp-login-to-error"],
      ["idp-login-to-account-selection"],
      ["idp-login-to-mfa-method-choice"],
      ["idp-login-to-authenticator-code"],
      ["idp-login-to-sms-code"],
      ["idp-login-to-email-code"],
      ["idp-login-to-push-approval"],
      ["idp-login-to-security-key"],
      ["idp-login-to-identity-consent"],
      ["idp-login-to-resource-consent"],
      ["idp-login-to-success", "app-continues-after-idp-success"],
      ["idp-login-cancelled", "app-continues-after-idp-cancelled"]
    ])
  })

  it("groups Solid OIDC identity consent success branches by resolved target", () => {
    const { registry } = mapYaml(oidcYaml)
    const identityConsent = registry.getStateTransitions("identity-consent")
    const transitions = registry.getResolvedTransitions("identity-consent", "resource-consent")

    expect(identityConsent.to?.map((state) => state.id)).toEqual([
      "resource-consent",
      "identity-consent-denied-visible",
      "app-login-cancelled"
    ])
    expect(transitions.map(getTraceIds)).toEqual([
      ["identity-consent-allowed", "identity-consent-success-to-resource-consent"],
      ["identity-consent-already-granted", "identity-consent-success-to-resource-consent"]
    ])
  })

  it("groups Solid OIDC resource consent success branches by resolved target", () => {
    const { registry } = mapYaml(oidcYaml)
    const resourceConsent = registry.getStateTransitions("resource-consent")
    const transitions = registry.getResolvedTransitions(
      "resource-consent",
      "app-auth-callback-processing"
    )

    expect(resourceConsent.to?.map((state) => state.id)).toEqual([
      "resource-consent-details",
      "app-auth-callback-processing",
      "resource-consent-denied-visible",
      "app-login-cancelled",
      "resource-consent-error-visible"
    ])
    expect(transitions.map(getTraceIds)).toEqual([
      [
        "resource-consent-allowed",
        "resource-consent-success-to-idp-success",
        "app-continues-after-idp-success"
      ],
      [
        "resource-consent-already-granted",
        "resource-consent-success-to-idp-success",
        "app-continues-after-idp-success"
      ]
    ])
  })

  it("traces nested exits through the outer app journey", () => {
    const { registry } = mapYaml(oidcYaml)
    const mfaMethodChoice = registry.getStateTransitions("mfa-method-choice")
    const cancelled = getTransition(
      registry.getResolvedTransitions("mfa-method-choice", "app-login-cancelled"),
      "app-continues-after-idp-cancelled"
    )
    const cancelledTrace = getOnlyExitResolvedTrace(
      registry.getExitResolvedTraces("mfa-method-choice", "mfa-method-choice-cancelled"),
      "mfa-method-choice-cancelled"
    )

    expect(getTargetState(mfaMethodChoice, "app-login-cancelled").id).toBe("app-login-cancelled")
    expect(cancelled.toState.id).toBe("app-login-cancelled")
    expect(getTraceIds(cancelled)).toEqual([
      "mfa-method-choice-cancelled",
      "idp-mfa-cancelled-to-idp-cancelled",
      "app-continues-after-idp-cancelled"
    ])
    expect(getTransitionIds(cancelledTrace)).toEqual([
        "mfa-method-choice-cancelled",
        "idp-mfa-cancelled-to-idp-cancelled",
        "app-continues-after-idp-cancelled"
    ])
    expect(() => JSON.stringify(cancelled)).not.toThrow()
  })

  it("detects exit delegation cycles while building the trace index", () => {
    expect(() => mapYaml(exitDelegationCycleYaml)).toThrow("Exit delegation cycle detected at child-done")
  })

  it("resolves localized messages from the new UJG schema", () => {
    const { registry } = mapYaml(filesharingYaml)
    expect(registry.getMessage("urn:message:sharing-panel", "urn:locale:en")).toBe("Sharing")
    expect(registry.getDefaultMessage("urn:message:sharing-panel")).toBe("Sharing")
  })
})
