import {
  parseUjgYaml
} from "./parser.ts"
import type {
  UJGDocument,
  UJGJourney,
  UJGState,
  UJGTouchpoint,
  UJGTransition
} from "./parser.ts"

// Compiles the nested UJG YAML authoring dialect into canonical UJG Editor's Draft JSON-LD:
// every addressable object is lifted to top-level `nodes`, nested maps become *Refs, and
// state-local transitions get their `from` from the owning state.

const ED_NAMESPACE = "https://ujg.specs.openuji.org/ed/ns"

const MODULE_CONTEXTS: Readonly<Partial<Record<string, string>>> = {
  core: `${ED_NAMESPACE}/core.context.jsonld`,
  graph: `${ED_NAMESPACE}/graph.context.jsonld`,
  surface: `${ED_NAMESPACE}/surface.context.jsonld`
}

const REQUIRED_MODULES = ["core", "graph"] as const

export type UJGJsonLdOptions = Readonly<{
  // IRI of the compiled document; node IRIs are `${documentIri}:${authoringId}`.
  documentIri: string;
}>

type NodeBase<Type extends string> = Readonly<{
  "@id": string;
  "@type": Type;
}>

export type UJGJsonLdTouchpoint = NodeBase<"Touchpoint"> & Readonly<{
  label?: string;
  journeyRefs: readonly string[];
}>

export type UJGJsonLdJourney = NodeBase<"Journey"> & Readonly<{
  label: string;
  defaultEntryRef?: string;
  entryRefs: readonly string[];
  stateRefs: readonly string[];
  transitionRefs?: readonly string[];
  exitRefs?: readonly string[];
}>

export type UJGJsonLdJourneyEntry = NodeBase<"JourneyEntry"> & Readonly<{
  label?: string;
  stateRef: string;
}>

export type UJGJsonLdState = NodeBase<"State"> & Readonly<{
  label: string;
  tags?: readonly string[];
}>

export type UJGJsonLdCompositeState = NodeBase<"CompositeState"> & Readonly<{
  label: string;
  tags?: readonly string[];
  subjourneyRefs: readonly string[];
}>

export type UJGJsonLdSurface = NodeBase<"Surface"> & Readonly<{
  graphNodeRef: string;
}>

export type UJGJsonLdTransition = NodeBase<"Transition"> & Readonly<{
  label: string;
  tags?: readonly string[];
  from: string;
  to: string;
  toEntryRef?: string;
  fromExitRef?: string;
}>

export type UJGJsonLdJourneyExit = NodeBase<"JourneyExit"> & Readonly<{
  label?: string;
}>

export type UJGJsonLdNode =
  | UJGJsonLdTouchpoint
  | UJGJsonLdJourney
  | UJGJsonLdJourneyEntry
  | UJGJsonLdState
  | UJGJsonLdCompositeState
  | UJGJsonLdSurface
  | UJGJsonLdTransition
  | UJGJsonLdJourneyExit

export type UJGJsonLdDocument = Readonly<{
  "@context": readonly string[];
  "@id": string;
  "@type": "UJGDocument";
  nodes: readonly UJGJsonLdNode[];
}>

type ToIri = (id: string) => string

type OwnedTransition = Readonly<{
  from: string;
  transition: UJGTransition;
}>

const withTags = (tags: readonly string[] | undefined) => (
  tags && tags.length > 0 ? { tags: [...tags] } : {}
)

const getContexts = (document: UJGDocument): string[] => (
  [...new Set([...REQUIRED_MODULES, ...(document.modules ?? [])])].map((module) => {
    const context = MODULE_CONTEXTS[module]
    if (!context) throw new Error(`No UJG ED JSON-LD context is known for module "${module}"`)

    return context
  })
)

const getSubjourneys = (state: UJGState): UJGJourney[] => [
  ...(state.subjourneyRefs ?? []).filter((ref): ref is UJGJourney => typeof ref !== "string"),
  ...(state.subjourney ? [state.subjourney] : [])
]

const getSubjourneyIds = (state: UJGState): string[] => [
  ...(state.subjourneyRefs ?? []).map((ref) => (typeof ref === "string" ? ref : ref.id)),
  ...(state.subjourney ? [state.subjourney.id] : [])
]

const toStateLocalTransitions = (journey: UJGJourney): OwnedTransition[] => (
  Object.entries(journey.states ?? {}).flatMap(([stateId, state]) => (
    (state.transitions ?? []).map((transition) => {
      if (transition.from && transition.from !== stateId) {
        throw new Error(`State-local transition ${transition.id} declares from "${transition.from}" inside state "${stateId}"`)
      }

      return { from: stateId, transition }
    })
  ))
)

const toJourneyLevelTransitions = (journey: UJGJourney): OwnedTransition[] => (
  (journey.transitions ?? []).map((transition) => {
    if (!transition.from) {
      throw new Error(`Journey-level transition ${transition.id} in ${journey.id} is missing from`)
    }

    return { from: transition.from, transition }
  })
)

const toTouchpointNode = (
  [id, touchpoint]: [string, UJGTouchpoint],
  iri: ToIri
): UJGJsonLdTouchpoint => ({
  "@id": iri(id),
  "@type": "Touchpoint",
  ...(touchpoint.label ? { label: touchpoint.label } : {}),
  journeyRefs: (touchpoint.journeyRefs ?? []).map(iri)
})

const toStateNodes = (
  [id, state]: [string, UJGState],
  iri: ToIri
): (UJGJsonLdState | UJGJsonLdCompositeState | UJGJsonLdSurface)[] => {
  const base = {
    "@id": iri(id),
    label: state.label,
    ...withTags(state.tags)
  }
  const stateNode: UJGJsonLdState | UJGJsonLdCompositeState = state.type === "CompositeState"
    ? { ...base, "@type": "CompositeState", subjourneyRefs: getSubjourneyIds(state).map(iri) }
    : { ...base, "@type": "State" }

  if (!state.surface) return [stateNode]
  if (!state.surface.id) throw new Error(`Surface of state ${id} needs an id`)

  return [stateNode, {
    "@id": iri(state.surface.id),
    "@type": "Surface",
    graphNodeRef: iri(state.surface.graphNodeRef ?? id)
  }]
}

const toTransitionNode = ({ from, transition }: OwnedTransition, iri: ToIri): UJGJsonLdTransition => ({
  "@id": iri(transition.id),
  "@type": "Transition",
  label: transition.label,
  ...withTags(transition.tags),
  from: iri(from),
  to: iri(transition.to),
  ...(transition.toEntryRef ? { toEntryRef: iri(transition.toEntryRef) } : {}),
  ...(transition.fromExitRef ? { fromExitRef: iri(transition.fromExitRef) } : {})
})

// One journey block (journey, entries, states with their surfaces, transitions, exits),
// followed by the blocks of its child journeys in state order.
const toJourneyNodes = (journey: UJGJourney, iri: ToIri): UJGJsonLdNode[] => {
  const entries = Object.entries(journey.entries ?? {})
  const states = Object.entries(journey.states ?? {})
  const exits = Object.entries(journey.exits ?? {})
  const transitions = [...toStateLocalTransitions(journey), ...toJourneyLevelTransitions(journey)]
  const transitionRefs = transitions.map(({ transition }) => iri(transition.id))
  const exitRefs = exits.map(([id]) => iri(id))

  if (entries.length === 0 || states.length === 0) {
    throw new Error(`Journey ${journey.id} needs at least one entry and one state`)
  }

  const journeyNode: UJGJsonLdJourney = {
    "@id": iri(journey.id),
    "@type": "Journey",
    label: journey.label,
    ...(journey.defaultEntryRef ? { defaultEntryRef: iri(journey.defaultEntryRef) } : {}),
    entryRefs: entries.map(([id]) => iri(id)),
    stateRefs: states.map(([id]) => iri(id)),
    ...(transitionRefs.length > 0 ? { transitionRefs } : {}),
    ...(exitRefs.length > 0 ? { exitRefs } : {})
  }

  return [
    journeyNode,
    ...entries.map(([id, entry]): UJGJsonLdJourneyEntry => ({
      "@id": iri(id),
      "@type": "JourneyEntry",
      ...(entry.label ? { label: entry.label } : {}),
      stateRef: iri(entry.stateRef)
    })),
    ...states.flatMap((state) => toStateNodes(state, iri)),
    ...transitions.map((transition) => toTransitionNode(transition, iri)),
    ...exits.map(([id, exit]): UJGJsonLdJourneyExit => ({
      "@id": iri(id),
      "@type": "JourneyExit",
      ...(exit.label ? { label: exit.label } : {})
    })),
    ...states.flatMap(([, state]) => getSubjourneys(state).flatMap((child) => toJourneyNodes(child, iri)))
  ]
}

const assertUniqueIds = (nodes: readonly UJGJsonLdNode[]) => {
  const seen = new Set<string>()

  nodes.forEach((node) => {
    if (seen.has(node["@id"])) throw new Error(`Duplicate node id ${node["@id"]}`)
    seen.add(node["@id"])
  })
}

export const compileUjgJsonLd = (
  document: UJGDocument,
  { documentIri }: UJGJsonLdOptions
): UJGJsonLdDocument => {
  if (document.compilesTo && document.compilesTo !== "ujg-ed") {
    throw new Error(`Cannot compile a document that targets "${document.compilesTo}"`)
  }
  if (!document.journey) {
    throw new Error("A nested UJG document needs a root journey")
  }

  const iri: ToIri = (id) => `${documentIri}:${id}`
  const nodes = [
    ...Object.entries(document.touchpoints ?? {}).map((touchpoint) => toTouchpointNode(touchpoint, iri)),
    ...toJourneyNodes(document.journey, iri)
  ]

  assertUniqueIds(nodes)

  return {
    "@context": getContexts(document),
    "@id": documentIri,
    "@type": "UJGDocument",
    nodes
  }
}

export const compileUjgYamlToJsonLd = (source: string, options: UJGJsonLdOptions): UJGJsonLdDocument => (
  compileUjgJsonLd(parseUjgYaml(source), options)
)
