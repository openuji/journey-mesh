import { describe, expect, it } from "vitest"
import { compileUjgYamlToJsonLd } from "./jsonld"

const DOCUMENT_IRI = "urn:ujg:example"
const iri = (id: string) => `${DOCUMENT_IRI}:${id}`

const compile = (source: string) => compileUjgYamlToJsonLd(source, { documentIri: DOCUMENT_IRI })

const nestedYaml = `
compilesTo: ujg-ed
modules:
- core
- graph
- surface
touchpoints:
  app:
    type: Touchpoint
    label: App touchpoint
    journeyRefs:
    - app-journey
  idp:
    type: Touchpoint
    label: IdP touchpoint
    journeyRefs:
    - auth-journey
journey:
  id: app-journey
  type: Journey
  label: App journey
  defaultEntryRef: app-entry
  entries:
    app-entry:
      type: JourneyEntry
      label: Start app
      stateRef: app-start
  states:
    app-start:
      type: State
      label: Start
      surface:
        id: app-start-surface
        type: Surface
        graphNodeRef: app-start
      transitions:
      - id: app-start-to-auth
        type: Transition
        label: Start auth
        tags:
        - primary
        to: auth-flow
        toEntryRef: login-entry
    auth-flow:
      type: CompositeState
      label: Auth flow
      subjourneyRefs:
      - id: auth-journey
        type: Journey
        label: Auth journey
        defaultEntryRef: login-entry
        entries:
          login-entry:
            type: JourneyEntry
            label: Start at login
            stateRef: login
        states:
          login:
            type: State
            label: Login
            transitions:
            - id: login-to-success
              type: Transition
              label: Complete login
              to: auth-success
        exits:
          auth-success:
            type: JourneyExit
            label: Auth success
    app-callback:
      type: State
      label: Callback processing
  transitions:
  - id: auth-success-to-callback
    type: Transition
    label: Continue after auth success
    from: auth-flow
    fromExitRef: auth-success
    to: app-callback
`

const minimalJourney = (extra: string) => `
journey:
  id: minimal
  type: Journey
  label: Minimal
  defaultEntryRef: start
  entries:
    start:
      stateRef: first
  states:
    first:
      type: State
      label: First
${extra}`

describe("compileUjgJsonLd", () => {
  it("normalizes nested authoring YAML into canonical UJG ED JSON-LD", () => {
    expect(compile(nestedYaml)).toEqual({
      "@context": [
        "https://ujg.specs.openuji.org/ed/ns/core.context.jsonld",
        "https://ujg.specs.openuji.org/ed/ns/graph.context.jsonld",
        "https://ujg.specs.openuji.org/ed/ns/surface.context.jsonld"
      ],
      "@id": DOCUMENT_IRI,
      "@type": "UJGDocument",
      nodes: [
        { "@id": iri("app"), "@type": "Touchpoint", label: "App touchpoint", journeyRefs: [iri("app-journey")] },
        { "@id": iri("idp"), "@type": "Touchpoint", label: "IdP touchpoint", journeyRefs: [iri("auth-journey")] },
        {
          "@id": iri("app-journey"),
          "@type": "Journey",
          label: "App journey",
          defaultEntryRef: iri("app-entry"),
          entryRefs: [iri("app-entry")],
          stateRefs: [iri("app-start"), iri("auth-flow"), iri("app-callback")],
          transitionRefs: [iri("app-start-to-auth"), iri("auth-success-to-callback")]
        },
        { "@id": iri("app-entry"), "@type": "JourneyEntry", label: "Start app", stateRef: iri("app-start") },
        { "@id": iri("app-start"), "@type": "State", label: "Start" },
        { "@id": iri("app-start-surface"), "@type": "Surface", graphNodeRef: iri("app-start") },
        {
          "@id": iri("auth-flow"),
          "@type": "CompositeState",
          label: "Auth flow",
          subjourneyRefs: [iri("auth-journey")]
        },
        { "@id": iri("app-callback"), "@type": "State", label: "Callback processing" },
        {
          "@id": iri("app-start-to-auth"),
          "@type": "Transition",
          label: "Start auth",
          tags: ["primary"],
          from: iri("app-start"),
          to: iri("auth-flow"),
          toEntryRef: iri("login-entry")
        },
        {
          "@id": iri("auth-success-to-callback"),
          "@type": "Transition",
          label: "Continue after auth success",
          from: iri("auth-flow"),
          to: iri("app-callback"),
          fromExitRef: iri("auth-success")
        },
        {
          "@id": iri("auth-journey"),
          "@type": "Journey",
          label: "Auth journey",
          defaultEntryRef: iri("login-entry"),
          entryRefs: [iri("login-entry")],
          stateRefs: [iri("login")],
          transitionRefs: [iri("login-to-success")],
          exitRefs: [iri("auth-success")]
        },
        { "@id": iri("login-entry"), "@type": "JourneyEntry", label: "Start at login", stateRef: iri("login") },
        { "@id": iri("login"), "@type": "State", label: "Login" },
        {
          "@id": iri("login-to-success"),
          "@type": "Transition",
          label: "Complete login",
          from: iri("login"),
          to: iri("auth-success")
        },
        { "@id": iri("auth-success"), "@type": "JourneyExit", label: "Auth success" }
      ]
    })
  })

  it("rejects documents that break the normalization contract", () => {
    expect(() => compile(minimalJourney(`  transitions:
  - id: orphan
    type: Transition
    label: Orphan
    to: first`))).toThrow("Journey-level transition orphan in minimal is missing from")

    expect(() => compile(minimalJourney(`    second:
      type: State
      label: Second
      transitions:
      - id: wrong-source
        type: Transition
        label: Wrong source
        from: first
        to: first`))).toThrow('declares from "first" inside state "second"')

    expect(() => compile(minimalJourney(`    first-copy:
      type: State
      label: Copy
      surface:
        id: first
        type: Surface`))).toThrow(`Duplicate node id ${iri("first")}`)

    expect(() => compile(`modules: [core, graph, runtime]\n${minimalJourney("")}`))
      .toThrow('No UJG ED JSON-LD context is known for module "runtime"')

    expect(() => compile(`compilesTo: ujg-cr\n${minimalJourney("")}`))
      .toThrow('Cannot compile a document that targets "ujg-cr"')
  })
})
