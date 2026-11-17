import { parseDocument } from "yaml"


export type UJGLocale = {
  label?: string
  localeCode: string
}

export type UJGMessageMeta = {
  label?: string
  defaultLocaleRef?: string
}

export type UJGMessage = {
  messageMetaRef: string
  localeRef: string
  value: string
}

export type UJGDocument = {
  compilesTo?: string
  modules?: string[]
  journey?: UJGJourney
  journeyEntryIndex?: UJGjourneyEntryIndex
  states?: Record<string, UJGState>
  touchpoints?: Record<string, UJGTouchpoint>
  users?: Record<string, UJGUser>
  phases?: Record<string, UJGPhase>
  steps?: Record<string, UJGStep>
  effects?: Record<string, UJGEffect>
  artifacts?: Record<string, UJGArtifact>
  locales?: Record<string, UJGLocale>
  messageMeta?: Record<string, UJGMessageMeta>
  messages?: Record<string, UJGMessage>
}

export type UJGTouchpoint = {
  type?: "Touchpoint"
  label?: string
  journeyRefs?: string[]
  compositeStateRefs?: string[]
}

export type UJGUser = {
  label?: string
  touchpointRefs?: string[]
}

export type PhaseRef = string;
export type UJGPhase = {
  id: PhaseRef,
  label?: string
  order?: number
}

export type StepRef = string
export type UJGStep = {
  id: StepRef,
  label?: string
  order?: number
  compositeStateRef: string
  phaseRef?: string
}

export type UJGEffect = {
  label?: string
  producedRefs?: string[]
  consumedRefs?: string[]
}

export type UJGArtifact = {
  label?: string
  sourceTouchpointRef?: string
  targetTouchpointRefs?: string[]
}

export type UJGjourneyEntryIndex = {
  id: string
  label?: string
  entryRefs: string[]
  type?: "JourneyjourneyEntryIndex"
}

export type UJGJourney = {
  id: string,
  label: string,
  entries: Record<string, UJGEntry>
  exits?: Record<string, UJGExit>
  defaultEntryRef: string
  states: Record<string, UJGState>
  transitions?: UJGTransition[]
  parentJourneyRef?: string
  parentCompositeStateRef?: string
}

export type UJGEntry = {
  label?: string
  name?: string
  stateRef: string
  type?: string
}

export type UJGExit = {
  id: string
  label?: string
  journeyOwnerRef: string
  type?: string
}

export type StateRef = string
export type UJGState = {
  journeyRef: string
  id: StateRef,
  type: "CompositeState" | "State"
  label: string
  transitions?: UJGTransition[]
  subjourneyRefs?: Array<string | UJGJourney>
  // Legacy compact authoring form, normalized from object-valued subjourneyRefs.
  subjourney? : UJGJourney
  tags?: string[]
  journeyOwnerRef?: string
  compositeStateOwnerRef?: string
  surface?: {
    id?: string
    type?: "Surface"
    graphNodeRef?: string
    extensions?: {
      "org.openuji.graph-studio"?: {
        touchpointHintRef?: string
        sampleScreenRef?: string
      }
    }
    // Legacy normalized view retained for current Graph Studio components.
    touchpointRef?: string
    sampleScreenRef?: string
  }
}

export type UJGTransition = {
  id: string
  label: string
  from?: string
  fromExitRef?: string
  to: string
  toEntryRef?: string
  tags?: string[]
  effectRef?: string
}

export type UJGGraphState = Omit<UJGState, "transitions"> & {
  to?: UJGGraphState[]
  cycle?: boolean
}

export type UJGGraphTransition = UJGTransition & {
  toState: Omit<UJGState, "transitions">
  trace: UJGTransition[]
  effectAnnotations?: UJGTransitionEffectAnnotation[]
}
type Agg = {
  journeys: Map<string, UJGJourney>,
  states: Map<string, UJGState>,
  exits: Map<string, UJGExit>,
  journeyTransitions: Map<string, UJGTransition[]>
  exitStates: Map<string, UJGExitState>
  resolvedTransitions: Map<string, Map<string, UJGResolvedTransition[]>>
  entries: Map<string, UJGEntry & { journeyRef: string }>
}

type UJGExitState = {
  stateRef: string
  trace: UJGTransition[]
}

export type GraphTree = {id: string, branch?: GraphTree[], cycle?: boolean}

export type UJGRootStartOption = {
  id: string
  label?: string
  stateRef: string
  effectiveStateRef: string
}

export type UJGJourneyProperty = {
  id: string
  label?: string
}

export type UJGJourneyProperties = {
  touchpoints: UJGJourneyProperty[]
  users: UJGJourneyProperty[]
}

export type UJGPhaseRef = UJGPhase & {
  id: string
}

export type UJGStepRef = UJGStep & {
  id: string
}

export type UJGStateStepContext = {
  stateRef: string
  step: UJGStepRef
  phase?: UJGPhaseRef
}

export type UJGJourneyMapGroup = {
  phase?: UJGPhaseRef
  steps: UJGStepRef[]
}

export type UJGEffectResourceDirection = "produced" | "consumed"

export type UJGEffectResourceAnnotation = {
  id: string
  label?: string
  direction: UJGEffectResourceDirection
}

export type UJGTransitionEffectAnnotation = {
  transitionRef: string
  effect: {
    id: string
    label?: string
  }
  resources: UJGEffectResourceAnnotation[]
}

export type UJGHierarchy = {
  rootJourneyRef: string;
  root: UJGHierarchyJourneyNode;
}

export type UJGHierarchyJourneyNode = {
  journeyRef: string;
  depth: number;
  stateRefs: UJGHierarchyStateNode[];
}

export type UJGHierarchyStateNode = {
  stateRef: string;
  index: number;
  childJourney?: UJGHierarchyJourneyNode;
}

type UJGResolvedTransition = {
  transition: UJGTransition
  targetStateRef: string
  trace: UJGTransition[]
}

const withoutTransitions = (state: UJGState): Omit<UJGState, "transitions"> => {
  const { transitions, ...stateData } = state
  void transitions
  return stateData
}

export const parseUjgYaml = (source: string): UJGDocument => {
  const document = parseDocument(source, {
    prettyErrors: true,
    uniqueKeys: true,
    merge: true
  })

  if (document.errors.length > 0) {
    throw new Error(document.errors.map((error) => error.message).join("\n"))
  }

  return document.toJS()
}

export const getJourneyHierarchy = (registry: Registry): UJGHierarchy => {
  const buildStateNode = (
    stateRef: string,
    index: number,
    depth: number
  ): UJGHierarchyStateNode => {
    const state = registry.states.get(stateRef)
    const childJourneyRef = state?.subjourney?.id
    const childJourney = childJourneyRef
      ? registry.journeys.get(childJourneyRef)
      : undefined

    return {
      stateRef,
      index,
      ...(childJourney ? { childJourney: buildJourneyNode(childJourney, depth + 1) } : {})
    }
  }

  const buildContainerNode = (
    journeyRef: string,
    states: Record<string, UJGState> | undefined,
    depth: number
  ): UJGHierarchyJourneyNode => ({
    journeyRef,
    depth,
    stateRefs: Object.keys(states || {}).map((stateRef, index) => (
      buildStateNode(stateRef, index, depth)
    ))
  })

  const buildJourneyNode = (
    journey: UJGJourney,
    depth: number
  ): UJGHierarchyJourneyNode => buildContainerNode(journey.id, journey.states, depth)

  const rootJourneyRef = registry.raw.journey?.id ?? registry.raw.journeyEntryIndex?.id ?? "root"
  const root = registry.raw.journey
    ? buildJourneyNode(registry.raw.journey, 0)
    : buildContainerNode(rootJourneyRef, registry.raw.states, 0)

  return {
    rootJourneyRef,
    root
  }
}

export class Registry {
  raw: UJGDocument
  touchpoints: Map<string, UJGTouchpoint> = new Map()
  users: Map<string, UJGUser> = new Map()
  phases: Map<string, UJGPhase> = new Map()
  steps: Map<string, UJGStep> = new Map()
  effects: Map<string, UJGEffect> = new Map()
  artifacts: Map<string, UJGArtifact> = new Map()
  journeys: Map<string, UJGJourney> = new Map()
  states: Map<string, UJGState> = new Map()
  exits: Map<string, UJGExit> = new Map()
  entries: Map<string, UJGEntry & { journeyRef: string }> = new Map()
  locales: Map<string, UJGLocale> = new Map()
  messageMeta: Map<string, UJGMessageMeta> = new Map()
  messages: Map<string, UJGMessage> = new Map()
  journeyTransitions: Map<string, UJGTransition[]> = new Map()
  exitStates: Map<string, UJGExitState> = new Map()
  resolvedTransitions: Map<string, Map<string, UJGResolvedTransition[]>> = new Map()

  

  constructor(data: UJGDocument){
    this.raw = data
    this.touchpoints = new Map(Object.entries(data.touchpoints || {}))
    this.users = new Map(Object.entries(data.users || {}))
    this.phases = new Map(Object.entries(data.phases || {}))
    this.steps = new Map(Object.entries(data.steps || {}))
    this.effects = new Map(Object.entries(data.effects || {}))
    this.artifacts = new Map(Object.entries(data.artifacts || {}))
    this.locales = new Map(Object.entries(data.locales || {}))
    this.messageMeta = new Map(Object.entries(data.messageMeta || {}))
    this.messages = new Map(Object.entries(data.messages || {}))
    const {journeys, states, exits, journeyTransitions, exitStates, resolvedTransitions, entries} = this.getJourneysAndStates()
    this.journeys = journeys
    this.states = states
    this.exits = exits
    this.journeyTransitions = journeyTransitions
    this.exitStates = exitStates
    this.resolvedTransitions = resolvedTransitions
    this.entries = entries
    this.validatePhaseStepReferences()
    this.validateTransitionEffectReferences()
  }

  getMessage(messageMetaRef: string, localeRef: string): string | undefined {
    for (const message of this.messages.values()) {
      if (message.messageMetaRef === messageMetaRef && message.localeRef === localeRef) {
        return message.value
      }
    }
    return undefined
  }

  getDefaultMessage(messageMetaRef: string): string | undefined {
    const meta = this.messageMeta.get(messageMetaRef)
    if (!meta || !meta.defaultLocaleRef) return undefined
    return this.getMessage(messageMetaRef, meta.defaultLocaleRef)
  }

  getRootDefaultEntry(): UJGEntry {
    if (!this.raw.journey) {
      throw new Error("Root document does not define a journey")
    }

    const {entries, defaultEntryRef,} = this.raw.journey
    const defaultEntry = entries[defaultEntryRef]

    return defaultEntry
  }

  resolveRootStateRef(stateRef: string): string {
    const state = this.states.get(stateRef)
    if (!state) {
      throw new Error(`Root start state ${stateRef} not found`)
    }

    if (state.type !== "CompositeState" || !state.subjourney) {
      return state.id
    }

    const entry = state.subjourney.entries[state.subjourney.defaultEntryRef]
    if (!entry) {
      throw new Error(`Entry ${state.subjourney.defaultEntryRef} not found in subjourney of state ${state.id}`)
    }

    return this.resolveRootStateRef(entry.stateRef)
  }

  getRootStartOptions(): UJGRootStartOption[] {
    if (this.raw.journey) {
      return Object.entries(this.raw.journey.entries || {}).map(([entryRef, entry]) => ({
        id: entryRef,
        label: entry.label ?? entry.name,
        stateRef: entry.stateRef,
        effectiveStateRef: this.resolveRootStateRef(entry.stateRef)
      }))
    }

    const journeyEntryIndex = this.raw.journeyEntryIndex
    if (journeyEntryIndex) {
      return journeyEntryIndex.entryRefs.map((entryRef) => {
        const entry = this.entries.get(entryRef)
        if (!entry) {
          throw new Error(`Entry ${entryRef} not found`)
        }
        const journey = this.journeys.get(entry.journeyRef)
        const parentCompositeStateRef = journey?.parentCompositeStateRef
        if (!parentCompositeStateRef) {
          throw new Error(`Parent composite state not found for entry ${entryRef}`)
        }
        const state = this.states.get(parentCompositeStateRef)

        return {
          id: parentCompositeStateRef,
          label: state?.label,
          stateRef: parentCompositeStateRef,
          effectiveStateRef: this.resolveRootStateRef(entry.stateRef)
        }
      })
    }

    return []
  }

  getDefaultRootStart(): UJGRootStartOption {
    if (this.raw.journey) {
      const { defaultEntryRef } = this.raw.journey
      const defaultStart = this.getRootStartOptions()
        .find((option) => option.id === defaultEntryRef)

      if (defaultStart) return defaultStart
    }

    const defaultStart = this.getRootStartOptions()[0]
    if (!defaultStart) {
      throw new Error("Root document does not define any start options")
    }

    return defaultStart
  }

  getJourneyProperties(stateRef: string): UJGJourneyProperties {
    const state = this.states.get(stateRef)
    // Indexed root composites belong to the catalogue, while their touchpoint
    // belongs to the contained journey. Ordinary states use their owner.
    const journeyRefs = [state?.journeyOwnerRef, state?.subjourney?.id]
      .filter((ref): ref is string => Boolean(ref))
    const touchpoints = [...this.touchpoints]
      .filter(([, touchpoint]) => (
        journeyRefs.some((ref) => touchpoint.journeyRefs?.includes(ref)) ||
        touchpoint.compositeStateRefs?.includes(stateRef)
      ))
      .map(([id, touchpoint]) => ({
        id,
        label: touchpoint.label
      }))

    const touchpointRefs = new Set(touchpoints.map((touchpoint) => touchpoint.id))
    const users = [...this.users]
      .filter(([, user]) => user.touchpointRefs?.some((touchpointRef) => (
        touchpointRefs.has(touchpointRef)
      )))
      .map(([id, user]) => ({
        id,
        label: user.label
      }))

    return {
      touchpoints,
      users
    }
  }

  getStepForState(stateRef: string): UJGStepRef | undefined {
    const directStep = this.getStepForCompositeState(stateRef)
    if (directStep) return directStep

    const state = this.states.get(stateRef)
    let journeyRef = state?.journeyOwnerRef

    while (journeyRef) {
      const journey = this.journeys.get(journeyRef)
      const parentCompositeStateRef = journey?.parentCompositeStateRef

      if (parentCompositeStateRef) {
        const step = this.getStepForCompositeState(parentCompositeStateRef)
        if (step) return step
      }

      journeyRef = journey?.parentJourneyRef
    }

    return undefined
  }

  getPhaseForStep(stepRef: string): UJGPhaseRef | undefined {
    const step = this.steps.get(stepRef)
    if (!step?.phaseRef) return undefined

    return this.getPhaseRef(step.phaseRef)
  }

  getPhaseForState(stateRef: string): UJGPhaseRef | undefined {
    const step = this.getStepForState(stateRef)
    if (!step?.phaseRef) return undefined

    return this.getPhaseRef(step.phaseRef)
  }

  getStateStepContext(stateRef: string): UJGStateStepContext | undefined {
    const step = this.getStepForState(stateRef)
    if (!step) return undefined

    const phase = step.phaseRef ? this.getPhaseRef(step.phaseRef) : undefined

    return {
      stateRef,
      step,
      ...(phase ? { phase } : {})
    }
  }

  getJourneyMapStructure(): UJGJourneyMapGroup[] {
    return this.getJourneyMapStructureForStepEntries([...this.steps])
  }

  getJourneyMapStructureByRootId(rootId: string): UJGJourneyMapGroup[] {
    const rootStateRefs = this.getRootStateRefs(rootId)
    if (rootStateRefs.length === 0) return []

    const filteredSteps = [...this.steps].filter(([, step]) => (
      this.isCompositeStateContainedByRoot(step.compositeStateRef, rootStateRefs)
    ))

    return this.getJourneyMapStructureForStepEntries(filteredSteps)
  }

  private getJourneyMapStructureForStepEntries(
    stepEntries: [string, UJGStep][]
  ): UJGJourneyMapGroup[] {
    const phaseGroups = [...this.phases].map(([phaseRef, phase], index) => ({
      index,
      phase: {
        ...phase,
        id: phaseRef
      },
      steps: [] as UJGStepRef[]
    }))
    const groupByPhaseRef = new Map(phaseGroups.map((group) => [group.phase.id, group]))
    const unphasedSteps: UJGStepRef[] = []

    stepEntries.forEach(([stepRef, step]) => {
      const stepData = {
        ...step,
        id: stepRef
      }

      if (step.phaseRef) {
        groupByPhaseRef.get(step.phaseRef)?.steps.push(stepData)
        return
      }

      unphasedSteps.push(stepData)
    })

    const orderedGroups: UJGJourneyMapGroup[] = phaseGroups
      .filter((group) => group.steps.length > 0)
      .sort((left, right) => (
        (left.phase.order ?? Number.MAX_SAFE_INTEGER) - (right.phase.order ?? Number.MAX_SAFE_INTEGER) ||
        left.index - right.index
      ))
      .map(({ phase, steps }) => ({
        phase,
        steps: this.sortSteps(steps)
      }))

    if (unphasedSteps.length > 0) {
      orderedGroups.push({
        steps: this.sortSteps(unphasedSteps)
      })
    }

    return orderedGroups
  }

  private getRootStateRefs(rootId: string): string[] {
    if (this.raw.journeyEntryIndex?.id === rootId) {
      return (this.raw.journeyEntryIndex.entryRefs || []).map((entryRef) => {
        const entry = this.entries.get(entryRef)
        const journey = entry ? this.journeys.get(entry.journeyRef) : undefined
        return journey?.parentCompositeStateRef || ""
      }).filter(Boolean)
    }

    if (this.raw.journey?.id === rootId) {
      return Object.keys(this.raw.journey.states || {})
    }

    const rootStart = this.getRootStartOptions()
      .find((option) => option.id === rootId || option.stateRef === rootId)

    return rootStart ? [rootStart.stateRef] : []
  }

  private isCompositeStateContainedByRoot(
    compositeStateRef: string,
    rootStateRefs: string[]
  ): boolean {
    const rootStateRefSet = new Set(rootStateRefs)
    if (rootStateRefSet.has(compositeStateRef)) return true

    const compositeState = this.states.get(compositeStateRef)
    let journeyRef = compositeState?.journeyOwnerRef

    while (journeyRef) {
      const journey = this.journeys.get(journeyRef)
      const parentCompositeStateRef = journey?.parentCompositeStateRef

      if (parentCompositeStateRef && rootStateRefSet.has(parentCompositeStateRef)) {
        return true
      }

      journeyRef = journey?.parentJourneyRef
    }

    return false
  }

  getTransitionEffectAnnotations(transitionRef: string): UJGTransitionEffectAnnotation[] {
    const transition = this.findTransition(transitionRef)
    if (!transition) return []

    const annotation = this.getTransitionEffectAnnotation(transition)

    return annotation ? [annotation] : []
  }

  getResolvedTransitionEffectAnnotations(trace: UJGTransition[]): UJGTransitionEffectAnnotation[] {
    return trace
      .map((transition) => this.getTransitionEffectAnnotation(transition))
      .filter((annotation): annotation is UJGTransitionEffectAnnotation => Boolean(annotation))
  }

  private getPhaseRef(phaseRef: string): UJGPhaseRef | undefined {
    const phase = this.phases.get(phaseRef)
    if (!phase) return undefined

    return {
      ...phase,
      id: phaseRef
    }
  }

  private getStepForCompositeState(compositeStateRef: string): UJGStepRef | undefined {
    for (const [stepRef, step] of this.steps) {
      if (step.compositeStateRef === compositeStateRef) {
        return {
          ...step,
          id: stepRef
        }
      }
    }

    return undefined
  }

  private sortSteps(steps: UJGStepRef[]): UJGStepRef[] {
    const sourceOrder = new Map([...this.steps].map(([stepRef], index) => [stepRef, index]))

    return [...steps].sort((left, right) => (
      (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER) ||
      (sourceOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (sourceOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER)
    ))
  }

  private findTransition(transitionRef: string): UJGTransition | undefined {
    for (const transitions of this.journeyTransitions.values()) {
      const transition = transitions.find((item) => item.id === transitionRef)
      if (transition) return transition
    }

    return undefined
  }

  private getTransitionEffectAnnotation(transition: UJGTransition): UJGTransitionEffectAnnotation | undefined {
    if (!transition.effectRef) return undefined

    const effect = this.effects.get(transition.effectRef)
    if (!effect) return undefined

    const producedResources = (effect.producedRefs || []).map((resourceRef) => ({
      id: resourceRef,
      label: this.artifacts.get(resourceRef)?.label,
      direction: "produced" as const
    }))
    const consumedResources = (effect.consumedRefs || []).map((resourceRef) => ({
      id: resourceRef,
      label: this.artifacts.get(resourceRef)?.label,
      direction: "consumed" as const
    }))

    return {
      transitionRef: transition.id,
      effect: {
        id: transition.effectRef,
        label: effect.label
      },
      resources: [
        ...producedResources,
        ...consumedResources
      ]
    }
  }

  private validatePhaseStepReferences() {
    this.steps.forEach((step, stepRef) => {
      const compositeState = this.states.get(step.compositeStateRef)
      if (!compositeState) {
        throw new Error(`Step ${stepRef} references missing composite state ${step.compositeStateRef}`)
      }

      if (compositeState.type !== "CompositeState") {
        throw new Error(`Step ${stepRef} references non-composite state ${step.compositeStateRef}`)
      }

      if (step.phaseRef && !this.phases.has(step.phaseRef)) {
        throw new Error(`Step ${stepRef} references missing phase ${step.phaseRef}`)
      }
    })
  }

  private validateTransitionEffectReferences() {
    const checkedTransitionRefs = new Set<string>()

    this.journeyTransitions.forEach((transitions) => {
      transitions.forEach((transition) => {
        if (checkedTransitionRefs.has(transition.id)) return
        checkedTransitionRefs.add(transition.id)

        if (transition.effectRef && !this.effects.has(transition.effectRef)) {
          throw new Error(`Transition ${transition.id} references missing effect ${transition.effectRef}`)
        }
      })
    })
  }

  private getJourneysAndStates() : Agg {
    const registerStates = (
      ownerRef: string,
      states: Record<string, UJGState> | undefined,
      agg: Agg
    ) => {
      for(const [stateId, state] of Object.entries(states || {})) {
        state.id = stateId
        state.journeyOwnerRef = ownerRef

        const embeddedSubjourneys = state.subjourneyRefs?.filter(
          (ref): ref is UJGJourney => typeof ref !== "string"
        ) || []
        if (!state.subjourney && embeddedSubjourneys.length > 0) {
          state.subjourney = embeddedSubjourneys[0]
        }

        const graphStudioSurface = state.surface?.extensions?.["org.openuji.graph-studio"]
        if (state.surface && graphStudioSurface) {
          state.surface.touchpointRef ??= graphStudioSurface.touchpointHintRef
          state.surface.sampleScreenRef ??= graphStudioSurface.sampleScreenRef
        }

        agg.states.set(stateId, state)

        if(state.type === "CompositeState" && state.subjourney) {
          const subJourney = state.subjourney
          subJourney.parentJourneyRef = ownerRef
          subJourney.parentCompositeStateRef = stateId
    
          aggJourneysAndStates(subJourney, agg)
        }

        const transitions = agg.journeyTransitions.get(stateId) || []
        agg.journeyTransitions.set(stateId, [...transitions, ...(state.transitions || [])])
      }
    }

    const aggJourneysAndStates = (
      journey: UJGJourney,
      agg: Agg = {
        journeys: new Map(),
        states: new Map(),
        exits: new Map(),
        journeyTransitions: new Map(),
        exitStates: new Map(),
        resolvedTransitions: new Map(),
        entries: new Map()
      }
    ) => {

        agg.journeys.set(journey.id, journey)
        registerStates(journey.id, journey.states, agg)

        for(const [entryId, entry] of Object.entries(journey.entries || {})) {
          agg.entries.set(entryId, { ...entry, journeyRef: journey.id })
        }

        for(const [exitId, _exit] of Object.entries(journey.exits || {})) {
          const exit: UJGExit = {..._exit, id: exitId, journeyOwnerRef: journey.id}
          
          agg.exits.set(exitId, exit)
        }

        for(const transition of journey.transitions || []) {
          if (!transition.from) {
            throw new Error(`Journey-level transition ${transition.id} is missing from`)
          }

          const transitions = agg.journeyTransitions.get(transition.from) || []
          transitions.push(transition)
          agg.journeyTransitions.set(transition.from, transitions)
        }
        return agg
    }
    
    // Recursively fills the agg Journeys and States with all the data from the raw document
    const agg = this.raw.journey
      ? aggJourneysAndStates(this.raw.journey)
      : {
        journeys: new Map(),
        states: new Map(),
        exits: new Map(),
        journeyTransitions: new Map(),
        exitStates: new Map(),
        resolvedTransitions: new Map(),
        entries: new Map()
      }

    if (this.raw.journeyEntryIndex) {
      registerStates(this.raw.journeyEntryIndex.id, this.raw.states, agg)
    }

    const resolveTargetStateRef = (transition: UJGTransition): string | undefined => {
      const targetState = agg.states.get(transition.to)
      if (!targetState) return undefined

      const getPureStateId = (
        targetState: UJGState | undefined,
        toEntryRef?: string
      ): string => {
        if (!targetState) {
          throw new Error(`Target state ${transition.to} not found`)
        }

        if(targetState.type === "CompositeState" && targetState.subjourney) {
          const entryRef = toEntryRef || targetState.subjourney.defaultEntryRef
          const entry = targetState.subjourney.entries[entryRef]
          if (!entry) {
            throw new Error(`Entry ${entryRef} not found in subjourney of state ${targetState.id}`)
          }
          return getPureStateId(agg.states.get(entry.stateRef))
        }
        else {
          return targetState.id
        }
      }
      
      return getPureStateId(targetState, transition.toEntryRef)
    }

    const findDelegatedByExitState = (
      exitId: string,
      trace: UJGTransition[] = [],
      exitPath: Set<string> = new Set()
    ): UJGExitState | undefined => {
      const exit = agg.exits.get(exitId)
      if (!exit) {
        throw new Error(`Exit ${exitId} not found`)
      }

      const exitPathKey = `${exit.journeyOwnerRef}:${exit.id}`
      if (exitPath.has(exitPathKey)) {
        throw new Error(`Exit delegation cycle detected at ${exit.id}`)
      }

      const ownerJourney = agg.journeys.get(exit.journeyOwnerRef)
      if (!ownerJourney) {
        throw new Error(`Journey ${exit.journeyOwnerRef} not found for exit ${exit.id}`)
      }

      const parentCompositeStateRef = ownerJourney.parentCompositeStateRef
      if (!parentCompositeStateRef) {
        return undefined
      }

      const parentTransitions: UJGTransition[] = agg.journeyTransitions.get(parentCompositeStateRef) || []
      const exitTransition = parentTransitions
        .find((transition) => transition.fromExitRef === exit.id)
      if (!exitTransition) {
        return undefined
      }

      const nextTrace = [...trace, exitTransition]
      const stateRef = resolveTargetStateRef(exitTransition)
      if (stateRef) {
        return { stateRef, trace: nextTrace }
      }

      if (agg.exits.has(exitTransition.to)) {
        return findDelegatedByExitState(
          exitTransition.to,
          nextTrace,
          new Set([...exitPath, exitPathKey])
        )
      }

      throw new Error(`Target state ${exitTransition.to} not found`)
    }

    agg.exits.forEach((exit) => {
      const exitState = findDelegatedByExitState(exit.id)
      if (exitState) {
        agg.exitStates.set(exit.id, exitState)
      }
    })

    const resolveTransitionTarget = (transition: UJGTransition): UJGResolvedTransition | undefined => {
      const targetStateRef = resolveTargetStateRef(transition)
      if (targetStateRef) {
        return {
          transition,
          targetStateRef,
          trace: [transition]
        }
      }

      if (!agg.exits.has(transition.to)) {
        throw new Error(`Target state ${transition.to} not found`)
      }

      const exitState = agg.exitStates.get(transition.to)
      if (!exitState) {
        return undefined
      }

      const exitTargetState = agg.states.get(exitState.stateRef)
      if (!exitTargetState) {
        throw new Error(`Target state ${exitState.stateRef} not found`)
      }

      return {
        transition: exitState.trace[exitState.trace.length - 1],
        targetStateRef: exitTargetState.id,
        trace: [transition, ...exitState.trace]
      }
    }

    const resolvedTransitions = new Map<string, Map<string, UJGResolvedTransition[]>>()

    for (const [fromStateRef, transitions] of agg.journeyTransitions) {
      const transitionsByTarget = new Map<string, UJGResolvedTransition[]>()

      for (const transition of transitions) {
        const resolvedTransition = resolveTransitionTarget(transition)
        if (!resolvedTransition) continue

        const targetTransitions =
          transitionsByTarget.get(resolvedTransition.targetStateRef) || []

        transitionsByTarget.set(resolvedTransition.targetStateRef, [
          ...targetTransitions,
          resolvedTransition
        ])
      }

      resolvedTransitions.set(fromStateRef, transitionsByTarget)
    }

    return { ...agg, resolvedTransitions }
  }

  private toGraphTransition(
    resolvedTransition: UJGResolvedTransition,
    toState: Omit<UJGState, "transitions">
  ): UJGGraphTransition {
    const effectAnnotations = this.getResolvedTransitionEffectAnnotations(resolvedTransition.trace)

    return {
      ...resolvedTransition.transition,
      toState,
      trace: resolvedTransition.trace,
      ...(effectAnnotations.length > 0 ? { effectAnnotations } : {})
    }
  }

  getExitResolvedTraces(sourceStateRef: string, transitionId: string): UJGTransition[][] {
    const transitions = this.journeyTransitions.get(sourceStateRef) || []
    const transition = transitions.find((item) => item.id === transitionId)
    if (!transition || !this.exits.has(transition.to)) {
      return []
    }

    const exitState = this.exitStates.get(transition.to)
    return exitState ? [[transition, ...exitState.trace]] : []
  }

  getResolvedTransitions(fromStateRef: string, toStateRef: string): UJGGraphTransition[] {
    return (this.resolvedTransitions.get(fromStateRef)?.get(toStateRef) || [])
      .map((resolvedTransition) => {
        const targetState = this.states.get(resolvedTransition.targetStateRef)
        if (!targetState) {
          throw new Error(`Target state ${resolvedTransition.targetStateRef} not found`)
        }

        return this.toGraphTransition(resolvedTransition, withoutTransitions(targetState))
      })
  }

  getResolvedTransitionMap(fromStateRef: string): Map<string, UJGGraphTransition[]> {
    const transitionsByTarget = this.resolvedTransitions.get(fromStateRef)

    return new Map(
      [...(transitionsByTarget || new Map())].map(([toStateRef]) => [
        toStateRef,
        this.getResolvedTransitions(fromStateRef, toStateRef)
      ])
    )
  }

  getStateTransitions(stateRef: string): UJGGraphState {
    const state = this.states.get(stateRef)
    if (!state) {
      throw new Error(`State ${stateRef} not found`)
    }

    const buildGraphState = (currentState: UJGState, path: Set<string>): UJGGraphState => {      
      const transitionsByTarget = this.resolvedTransitions.get(currentState.id)
      const stateData = withoutTransitions(currentState)
      const graphState: UJGGraphState = { ...stateData }

      if (transitionsByTarget && transitionsByTarget.size > 0) {
        graphState.to = [...transitionsByTarget.keys()].map((targetStateRef) => {
          const targetState = this.states.get(targetStateRef)
          if (!targetState) {
            throw new Error(`Target state ${targetStateRef} not found`)
          }

          return (
            path.has(targetStateRef)
              ? { ...withoutTransitions(targetState), cycle: true }
              : buildGraphState(targetState, new Set([...path, targetStateRef]))
          )
        })
      }

      return graphState
    }

    return buildGraphState(state, new Set([state.id]))
  }
      
}

export const mapYaml = (source: string): {
  graph: GraphTree;
  hierarchy: UJGHierarchy;
  registry: Registry;
  rootStartOptions: UJGRootStartOption[];
} => {
    
    const data = parseUjgYaml(source)

    const registry = new Registry(data)

    const defaultStart = registry.getDefaultRootStart()

    const stateWithTransitions = registry.getStateTransitions(defaultStart.effectiveStateRef)

    const graphTree = (state: UJGGraphState): GraphTree => {
      const node: GraphTree = state.cycle ? {id: state.id, cycle: true} : {id: state.id}
      if(!state.cycle && state.to && state.to.length > 0) {
        node.branch = state.to.map((targetState) => graphTree(targetState))
      }
      return node
    }

    const graph = graphTree(stateWithTransitions)

    return {
      graph,
      hierarchy: getJourneyHierarchy(registry),
      registry,
      rootStartOptions: registry.getRootStartOptions(),
    }
}
