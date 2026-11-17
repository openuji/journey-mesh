import type {
  Registry,
  UJGGraphState,
  UJGJourneyMapGroup,
  UJGRootStartOption
} from "../../data/parser"
import {
  mapYaml
} from "../../data/parser"
import type { BranchTransitionItem } from "../Transitions/branchModel"
import { StateNode } from "../StateNode/StateNode"
import type { TransitionPathStatus } from "../Transitions/transitionPathDescriptors"
import {
  createTransitionPathRegistry
} from "../Transitions/transitionPathRegistry"
import type {
  EndpointRef,
  TransitionPathRegistry
} from "../Transitions/transitionPathRegistry"
import { Edge, TransitionPathLayer } from "../Transitions/TransitionPathLayer"
import {
  Fragment,
  useCallback,
  useMemo,
  useState,
  useSyncExternalStore
} from "react"
import type { CSSProperties, ReactNode } from "react"
import {
  createBranchTransitionRuntime
} from "../Transitions/BranchTransitionRuntime"
import styles from './JourneyPath.module.css'
import type {
  BranchTransitionRuntime,
  EndpointRole
} from "../Transitions/BranchTransitionRuntime"
import { useIsomorphicLayoutEffect } from "../../useIsomorphicLayoutEffect"
import type {
  LaneOwner,
  LaneSegment,
  LaneTone,
  MeasuredLaneNode
} from "./JourneyPath.lanes"
import { createMeasuredLaneSegments } from "./JourneyPath.lanes"
import {
  getStateMetrics,
  getStateScreenshotHref,
  StateScreenshotHoverCard
} from "./StateScreenshotHoverCard"
import type {
  JourneyPathPreviewData
} from "./StateScreenshotHoverCard"

export type {
  JourneyPathPreviewData
} from "./StateScreenshotHoverCard"

export type JourneyPathProps = {
  ariaLabel?: string;
  accessibilityDocument?: JourneyPathPreviewData;
  block?: boolean;
  className?: string;
  registry: Registry;
  rootStartIds?: string[];
  touchpointControls?: Readonly<Record<string, ReactNode | undefined>>;
}

export type JourneyPathYamlProps = Omit<JourneyPathProps, "registry"> & {
  source: string;
}

type JourneyMetaChipProps = {
  icon: "touchpoint" | "user";
  label: string;
}

const LANE_TONES: LaneTone[] = ["accent", "violet", "warning", "danger"]

const getLaneTone = (index: number) => LANE_TONES[index % LANE_TONES.length]

const formatLaneNumber = (value: number) => value.toString().padStart(2, "0")

const getLaneSegmentStyle = (segment: LaneSegment): CSSProperties => ({
  left: `${segment.left}px`,
  width: `${segment.width}px`
})

const roundMeasurement = (value: number) => Math.round(value * 1000) / 1000

const getInitial = (label: string | undefined) => (
  label?.trim().charAt(0).toUpperCase() || "?"
)

const TouchpointIcon = () => (
  <svg
    aria-hidden="true"
    className={styles.chipIcon}
    fill="none"
    viewBox="0 0 16 16"
  >
    <path
      d="M4.7 11.5h6.4a2.4 2.4 0 0 0 .3-4.8 3.7 3.7 0 0 0-7.1-1.1A3 3 0 0 0 4.7 11.5Z"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
    />
  </svg>
)

const UserIcon = () => (
  <svg
    aria-hidden="true"
    className={styles.chipIcon}
    fill="none"
    viewBox="0 0 16 16"
  >
    <path
      d="M8 8.1a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2ZM3.5 13.1c.5-2 2-3.2 4.5-3.2s4 1.2 4.5 3.2"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
    />
  </svg>
)

const JourneyMetaChip = ({
  icon,
  label
}: JourneyMetaChipProps) => (
  <span className={styles.chip}>
    {icon === "touchpoint" ? <TouchpointIcon /> : <UserIcon />}
    <span>{label}</span>
  </span>
)

const toBranchTransitionItem = (item: UJGGraphState): BranchTransitionItem => ({
  id: item.id,
  cycle: item.cycle,
  branch: item.to?.map(toBranchTransitionItem)
})

const useEndpointRef = (
  pathRegistry: TransitionPathRegistry,
  id: string | undefined,
  role: EndpointRole,
  occurrenceId: string
) => useMemo(() => {
  if (!id) return undefined

  return pathRegistry.createEndpoint(id, role, occurrenceId)
}, [id, pathRegistry, role, occurrenceId])

const EdgeRegistration = ({
  _in,
  out,
  pathRegistry,
  registry,
  status
}: {
  _in: EndpointRef | undefined;
  out: EndpointRef | undefined;
  pathRegistry: TransitionPathRegistry;
  registry: Registry;
  status: TransitionPathStatus;
}) => {
  return (
    <Edge
      in={_in}
      out={out}
      pathRegistry={pathRegistry}
      registry={registry}
      status={status}
    />
  )
}




type RegisterStateNode = (
  occurrenceId: string,
  stateId: string,
  element: HTMLDivElement | null
) => void

type RegisteredStateNode = {
  element: HTMLDivElement;
  stateId: string;
}

type JourneyLaneMetadata = {
  phases: Map<string, LaneOwner>;
  steps: Map<string, LaneOwner>;
}

const createLaneMetadata = (phases: UJGJourneyMapGroup[]): JourneyLaneMetadata => {
  const phaseOwners = new Map<string, LaneOwner>()
  const stepOwners = new Map<string, LaneOwner>()

  phases.forEach((phaseGroup, phaseIndex) => {
    const tone = getLaneTone(phaseIndex)

    if (phaseGroup.phase) {
      phaseOwners.set(phaseGroup.phase.id, {
        id: phaseGroup.phase.id,
        label: phaseGroup.phase.label ?? phaseGroup.phase.id,
        number: phaseGroup.phase.order ?? phaseIndex + 1,
        tone
      })
    }

    phaseGroup.steps.forEach((step, stepIndex) => {
      stepOwners.set(step.id, {
        id: step.id,
        label: step.label ?? step.id,
        number: step.order ?? stepIndex + 1,
        tone
      })
    })
  })

  return {
    phases: phaseOwners,
    steps: stepOwners
  }
}

type LaneSnapshot = {
  phases: LaneSegment[];
  steps: LaneSegment[];
}

type LaneMeasurementContext = {
  fallbackPhaseOwner: LaneOwner;
  fallbackStepOwner: LaneOwner;
  laneMetadata: JourneyLaneMetadata;
  registry: Registry;
}

type LaneMeasurementListener = () => void

const emptyLaneSnapshot: LaneSnapshot = {
  phases: [],
  steps: []
}

const laneSegmentsEqual = (
  current: LaneSegment[],
  next: LaneSegment[]
) => (
  current.length === next.length &&
  next.every((segment, index) => {
    const currentSegment = current[index]

    return currentSegment?.id === segment.id &&
      currentSegment.label === segment.label &&
      currentSegment.left === segment.left &&
      currentSegment.number === segment.number &&
      currentSegment.tone === segment.tone &&
      currentSegment.width === segment.width
  })
)

const laneSnapshotEqual = (
  current: LaneSnapshot,
  next: LaneSnapshot
) => (
  laneSegmentsEqual(current.phases, next.phases) &&
  laneSegmentsEqual(current.steps, next.steps)
)

const createFallbackOwner = (
  id: string,
  label: string
): LaneOwner => ({
  id,
  label,
  tone: "accent"
})

class LaneMeasurementStore {
  private animationFrame = 0
  private context: LaneMeasurementContext | undefined
  private graphElement: HTMLDivElement | null = null
  private readonly listeners = new Set<LaneMeasurementListener>()
  private readonly nodes = new Map<string, RegisteredStateNode>()
  private resizeObserver: ResizeObserver | undefined
  private snapshot: LaneSnapshot = emptyLaneSnapshot

  connect = () => {
    if (typeof window === "undefined") return () => undefined

    const scheduleMeasure = () => {
      this.scheduleMeasure()
    }

    window.addEventListener("resize", scheduleMeasure)

    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(scheduleMeasure)
      this.observeElement(this.graphElement)
      this.nodes.forEach(({ element }) => {
        this.observeElement(element)
      })
    }

    this.scheduleMeasure()

    return () => {
      window.cancelAnimationFrame(this.animationFrame)
      window.removeEventListener("resize", scheduleMeasure)
      this.resizeObserver?.disconnect()
      this.resizeObserver = undefined
    }
  }

  getSnapshot = () => this.snapshot

  registerStateNode: RegisterStateNode = (occurrenceId, stateId, element) => {
    const current = this.nodes.get(occurrenceId)

    if (element) {
      if (current?.element === element && current.stateId === stateId) return

      if (current) {
        this.unobserveElement(current.element)
      }

      this.nodes.set(occurrenceId, {
        element,
        stateId
      })
      this.observeElement(element)
      this.scheduleMeasure()
      return
    }

    if (!current) return

    this.unobserveElement(current.element)
    this.nodes.delete(occurrenceId)
    this.scheduleMeasure()
  }

  setContext = (context: LaneMeasurementContext) => {
    this.context = context
    this.scheduleMeasure()
  }

  setGraphElement = (element: HTMLDivElement | null) => {
    if (this.graphElement === element) return

    this.unobserveElement(this.graphElement)
    this.graphElement = element
    this.observeElement(element)
    this.scheduleMeasure()
  }

  subscribe = (listener: LaneMeasurementListener) => {
    this.listeners.add(listener)

    return () => {
      this.listeners.delete(listener)
    }
  }

  private emit(nextSnapshot: LaneSnapshot) {
    if (laneSnapshotEqual(this.snapshot, nextSnapshot)) return

    this.snapshot = nextSnapshot
    this.listeners.forEach((listener) => {
      listener()
    })
  }

  private measure = () => {
    if (!this.context || !this.graphElement) return

    const graphRect = this.graphElement.getBoundingClientRect()
    const graphLeft = graphRect.left + this.graphElement.clientLeft
    const nodes = [...this.nodes.entries()]
      .map(([occurrenceId, { element, stateId }]) => (
        resolveMeasuredLaneNode(
          this.context!.registry,
          this.context!.laneMetadata,
          occurrenceId,
          stateId,
          element,
          graphLeft
        )
      ))
      .sort((left, right) => (
        left.left - right.left ||
        left.right - right.right ||
        left.occurrenceId.localeCompare(right.occurrenceId)
      ))
    const width = roundMeasurement(this.graphElement.clientWidth)

    this.emit({
      phases: createMeasuredLaneSegments({
        fallbackOwner: this.context.fallbackPhaseOwner,
        getOwner: (node) => node.phase,
        nodes,
        width
      }),
      steps: createMeasuredLaneSegments({
        fallbackOwner: this.context.fallbackStepOwner,
        getOwner: (node) => node.step,
        nodes,
        width
      })
    })
  }

  private observeElement(element: Element | null) {
    if (!element) return

    this.resizeObserver?.observe(element)
  }

  private scheduleMeasure() {
    if (typeof window === "undefined") {
      this.measure()
      return
    }

    window.cancelAnimationFrame(this.animationFrame)
    this.animationFrame = window.requestAnimationFrame(this.measure)
  }

  private unobserveElement(element: Element | null) {
    if (!element) return

    this.resizeObserver?.unobserve(element)
  }
}

const BranchTransitionNode = ({
  accessibilityDocument,
  block,
  graph,
  occurrencePath,
  parentOutRef,
  pathRegistry,
  registerStateNode,
  registry
}: {
  accessibilityDocument?: JourneyPathPreviewData;
  block: boolean;
  graph: BranchTransitionItem;
  occurrencePath: number[];
  parentOutRef?: EndpointRef;
  pathRegistry: TransitionPathRegistry;
  registerStateNode?: RegisterStateNode;
  registry: Registry;
}) => {
    const state = registry.states.get(graph.id)
    const occurrenceId = `main:${graph.id}:${occurrencePath.join(".")}`

    //const transitions = registry.journeyTransitions.get(graph.id)
    const inRef = useEndpointRef(pathRegistry, graph.id, "in", `${occurrenceId}:in`)
    const outRef = useEndpointRef(pathRegistry, graph.id, "out", `${occurrenceId}:out`)
    const nodeRef = useCallback((element: HTMLDivElement | null) => {
      registerStateNode?.(occurrenceId, graph.id, element)
    }, [graph.id, occurrenceId, registerStateNode])
    const metrics = getStateMetrics(accessibilityDocument, graph.id)
    const sourceScreenshotHref = getStateScreenshotHref(accessibilityDocument, graph.id)

    return <>
      {parentOutRef && (
        <EdgeRegistration
          _in={inRef}
          out={parentOutRef}
          pathRegistry={pathRegistry}
          registry={registry}
          status="branch"
        />
      )}
      <StateScreenshotHoverCard sourceScreenshotHref={sourceScreenshotHref}>
        <StateNode
          block={block}
          id={graph.id}
          label={state?.label || ''}
          metrics={metrics}
          inRef={inRef?.ref}
          nodeRef={nodeRef}
          outRef={outRef?.ref}
        />
      </StateScreenshotHoverCard>
      {graph.branch?.map((branch, branchIndex) => (
        <BranchTransitionNode
          accessibilityDocument={accessibilityDocument}
          block={block}
          graph={branch}
          key={`${occurrenceId}:${branch.id}:${branchIndex}`}
          occurrencePath={[...occurrencePath, branchIndex]}
          parentOutRef={outRef}
          pathRegistry={pathRegistry}
          registerStateNode={registerStateNode}
          registry={registry}
        />
      ))}
    </>
}


const useLaneSnapshot = (laneStore: LaneMeasurementStore) => (
  useSyncExternalStore(
    laneStore.subscribe,
    laneStore.getSnapshot,
    laneStore.getSnapshot
  )
)

const FlagIcon = () => <svg className={styles.flagIcon} width="9" height="9" viewBox="0 0 9 9" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M5.67082 1.23646C4.71391 1.23646 3.92361 0.624973 2.72052 0.624973C2.27489 0.624973 1.87572 0.702044 1.50543 0.836163C1.50543 0.743164 1.50991 0.571713 1.50543 0.500977C1.47379 0.00107038 1.07965 0.0213343 0.571289 0.000976562L0.000244485 0C0.000244485 0.334478 -8.09601e-05 0.624973 1.91161e-05 1.29205V8.07891C1.91161e-05 8.31194 0.191894 8.50083 0.428591 8.50083H0.714305C0.951001 8.50083 1.14288 8.31194 1.14288 8.07891V6.41936C1.64843 6.20727 2.27827 6.03045 3.18636 6.03045C4.14329 6.03045 4.93357 6.64194 6.13666 6.64194C6.99682 6.64194 7.68429 6.35549 8.32425 5.92365C8.47931 5.81903 8.57145 5.64532 8.57145 5.46028V1.18657C8.57145 0.775318 8.13807 0.503232 7.75922 0.676465C7.14604 0.956832 6.39397 1.23646 5.67082 1.23646Z"/>
</svg>
const PhaseLabelsLane = ({laneStore}: {laneStore: LaneMeasurementStore}) => {
  const { phases } = useLaneSnapshot(laneStore)

  return (
    <div className={styles.phaseLane}>
      {phases.map((segment) => (
        <div
          className={styles.phaseLabel}
          data-tone={segment.tone}
          key={segment.id}
          style={getLaneSegmentStyle(segment)}
        >
          <FlagIcon />
          <span className={styles.phaseCode}>
            {segment.number ? `Phase ${formatLaneNumber(segment.number)}` : "Journey"}
          </span>
          {segment.label ? (
            <>
              <span className={styles.phaseSeparator} aria-hidden="true">•</span>
              <span className={styles.phaseName}>{segment.label}</span>
            </>
          ) : null}
        </div>
      ))}
    </div>
  )
}

const StepsLabelPanel = ({laneStore}: {laneStore: LaneMeasurementStore}) => {
  const { steps } = useLaneSnapshot(laneStore)

  return (
    <div className={styles.laneSteps}>
      {steps.map((segment) => (
        <span
          className={styles.stepLabel}
          data-tone={segment.tone}
          key={segment.id}
          style={getLaneSegmentStyle(segment)}
        >
          <span className={styles.stepCode}>
            {segment.number ? `Step ${formatLaneNumber(segment.number)}:` : "Journey"}
          </span>
          <span className={styles.stepName}>{segment.label}</span>
        </span>
      ))}
    </div>
  )
}

const resolveMeasuredLaneNode = (
  registry: Registry,
  laneMetadata: JourneyLaneMetadata,
  occurrenceId: string,
  stateId: string,
  element: HTMLDivElement,
  graphLeft: number
): MeasuredLaneNode => {
  const context = registry.getStateStepContext(stateId)
  const phaseOwner = context?.phase
    ? laneMetadata.phases.get(context.phase.id) ?? {
      id: context.phase.id,
      label: context.phase.label ?? context.phase.id,
      number: context.phase.order,
      tone: "accent"
    }
    : undefined
  const stepOwner = context?.step
    ? laneMetadata.steps.get(context.step.id) ?? {
      id: context.step.id,
      label: context.step.label ?? context.step.id,
      number: context.step.order,
      tone: phaseOwner?.tone ?? "accent"
    }
    : undefined
  const rect = element.getBoundingClientRect()

  return {
    occurrenceId,
    stateId,
    left: roundMeasurement(rect.left - graphLeft),
    right: roundMeasurement(rect.right - graphLeft),
    ...(stepOwner ? { step: stepOwner } : {}),
    ...(phaseOwner ? { phase: phaseOwner } : {})
  }
}

const JourneyPathFromState = ({
  accessibilityDocument,
  block,
  pathRegistry,
  registry,
  start,
  touchpointControls
}: {
  accessibilityDocument?: JourneyPathPreviewData;
  block: boolean;
  pathRegistry: TransitionPathRegistry;
  registry: Registry;
  start: UJGRootStartOption;
  touchpointControls?: Readonly<Record<string, ReactNode | undefined>>;
}) => {
    const compositeState = registry.states.get(start.stateRef)
    const journeyProperties = registry.getJourneyProperties(start.stateRef)
    const journeyLabel = compositeState?.subjourney?.label ?? start.label ?? compositeState?.label ?? start.stateRef
    const avatarLabel = journeyProperties.users[0]?.label ?? journeyLabel


    const graph = useMemo(() => (
      toBranchTransitionItem(registry.getStateTransitions(start.effectiveStateRef))
    ), [registry, start.effectiveStateRef])
    const phases = useMemo(() => (
      registry.getJourneyMapStructureByRootId(start.id)
    ), [registry, start.id])
    const laneMetadata = useMemo(() => (
      createLaneMetadata(phases)
    ), [phases])
    const laneStore = useMemo(() => new LaneMeasurementStore(), [])
    const registerStateNode = useCallback<RegisterStateNode>((occurrenceId, stateId, element) => {
      laneStore.registerStateNode(occurrenceId, stateId, element)
    }, [laneStore])
    const setGraphElement = useCallback((element: HTMLDivElement | null) => {
      laneStore.setGraphElement(element)
    }, [laneStore])
    const fallbackPhaseOwner = useMemo(() => (
      createFallbackOwner(`journey:${start.id}:phase`, journeyLabel)
    ), [journeyLabel, start.id])
    const fallbackStepOwner = useMemo(() => (
      createFallbackOwner(`journey:${start.id}:step`, journeyLabel)
    ), [journeyLabel, start.id])
    useIsomorphicLayoutEffect(() => {
      laneStore.setContext({
        fallbackPhaseOwner,
        fallbackStepOwner,
        laneMetadata,
        registry
      })
    }, [fallbackPhaseOwner, fallbackStepOwner, laneMetadata, laneStore, registry])

    useIsomorphicLayoutEffect(() => laneStore.connect(), [laneStore])

    
    return <div className={styles.journey} data-block={block ? "true" : "false"}>
        <header className={styles.header} data-block={block ? "true" : "false"}>
          <span className={styles.avatar} aria-hidden="true">
            {getInitial(avatarLabel)}
          </span>
          <div className={styles.headerContent} data-block={block ? "true" : "false"}>
            {(journeyProperties.touchpoints.length > 0 || journeyProperties.users.length > 0) ? (
              <div className={styles.chips} aria-label="Journey properties">
                {journeyProperties.touchpoints.map((touchpoint) => (
                  <Fragment key={touchpoint.id}>
                    {touchpointControls?.[touchpoint.id] ?? (
                      <JourneyMetaChip
                        icon="touchpoint"
                        label={touchpoint.label ?? touchpoint.id}
                      />
                    )}
                  </Fragment>
                ))}
                {journeyProperties.users.map((user) => (
                  <JourneyMetaChip
                    icon="user"
                    key={user.id}
                    label={user.label ?? user.id}
                  />
                ))}
              </div>
            ) : null}
            <div className={styles.title}>{journeyLabel}</div>

          </div>
        </header>
        <div className={styles.laneFrame}>
          {block ? null : <PhaseLabelsLane laneStore={laneStore} />}
          <div className={styles.graph} data-block={block ? "true" : "false"} ref={setGraphElement}>
            {block ? null : <StepsLabelPanel laneStore={laneStore} />}
            <div className={styles.states} data-block={block ? "true" : "false"}>
              <BranchTransitionNode
                accessibilityDocument={accessibilityDocument}
                block={block}
                graph={graph}
                occurrencePath={[0]}
                pathRegistry={pathRegistry}
                registerStateNode={registerStateNode}
                registry={registry}
              />
            </div>
          </div>
        </div>
    </div>
}
export const JourneyPath = ({
  accessibilityDocument,
  ariaLabel = "Journey paths",
  block = false,
  className,
  registry,
  rootStartIds,
  touchpointControls
}: JourneyPathProps) => {
    const starts = useMemo(() => {
      const rootStartOptions = registry.getRootStartOptions()
      if (!rootStartIds) return rootStartOptions

      const rootStartIdSet = new Set(rootStartIds)
      return rootStartOptions.filter((start) => rootStartIdSet.has(start.id))
    }, [registry, rootStartIds])
    const [containerElement, setContainerElement] = useState<HTMLDivElement | null>(null)
    const runtime = useMemo<BranchTransitionRuntime>(() => createBranchTransitionRuntime(), [])
    const pathRegistry = useMemo(() => createTransitionPathRegistry(), [])
    const rootClassName = [styles.canvas, className].filter(Boolean).join(" ")

    useIsomorphicLayoutEffect(() => (
      () => runtime.destroy()
    ), [runtime])

    return <div aria-label={ariaLabel} className={rootClassName}>
      <div ref={setContainerElement}>
          <TransitionPathLayer
            block={block}
            containerElement={containerElement}
            pathRegistry={pathRegistry}
            runtime={runtime}
          />
        
    
    
    <ul className={styles.pathList}>
      {starts.map((start) => (
        <li className={styles.pathItem} key={start.id}>
          <JourneyPathFromState
            accessibilityDocument={accessibilityDocument}
            block={block}
            pathRegistry={pathRegistry}
            registry={registry}
            start={start}
            touchpointControls={touchpointControls}
          />
        </li>
      ))}
    </ul>
    </div>
    </div>
    
}

export const JourneyPathYaml = ({
  source,
  ...props
}: JourneyPathYamlProps) => {
  const {
    registry
  } = useMemo(() => mapYaml(source), [source])

  return <JourneyPath {...props} registry={registry} />
}
