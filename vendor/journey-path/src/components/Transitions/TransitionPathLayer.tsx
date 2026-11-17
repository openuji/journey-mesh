import type { Registry, UJGGraphTransition } from "../../data/parser"
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore
} from "react"
import { useIsomorphicLayoutEffect } from "../../useIsomorphicLayoutEffect"
import type { BranchTransitionRuntime } from "./BranchTransitionRuntime"
import type { TransitionPathDescriptor } from "./transitionPathDescriptors"
import {
  createSvgPath,
  getLocalCurve,
  getMarkerProgresses,
  getPointOnCurve
} from "./transitionGeometry"
import type {
  Point,
  SvgCurve
} from "./transitionGeometry"
import type {
  EndpointRef,
  TransitionPathRegistry
} from "./transitionPathRegistry"
import type { EffectMarkerSummary } from "./TransitionPathLayer.model"
import { getTransitionEffectMarkerSummary } from "./TransitionPathLayer.model"
import styles from "./TransitionPathLayer.module.css"

type Cleanup = () => void

type EdgeRenderData = {
  curve: SvgCurve;
  d: string;
}

type ActiveMarker = {
  effectSummary?: EffectMarkerSummary;
  id: string;
  label: string;
  point: Point;
  traceIds: string[];
}

type EffectMarkerActivation = Omit<ActiveMarker, "id"> & {
  id: string;
}

const useRegisteredElementRef = <ElementType extends Element>(
  register: (element: ElementType) => Cleanup
) => {
  const cleanupRef = useRef<Cleanup | undefined>(undefined)

  useIsomorphicLayoutEffect(() => {
    return () => {
      cleanupRef.current?.()
      cleanupRef.current = undefined
    }
  }, [])

  return useCallback((element: ElementType | null) => {
    cleanupRef.current?.()
    cleanupRef.current = undefined

    if (element) {
      cleanupRef.current = register(element)
    }
  }, [register])
}

const usePathRef = (id: string, runtime: BranchTransitionRuntime) => {
  const register = useCallback((element: SVGPathElement) => {
    return runtime.registerPath(id, element)
  }, [id, runtime])

  return useRegisteredElementRef(register)
}

const useMarkerRef = (pathId: string, index: number, runtime: BranchTransitionRuntime) => {
  const register = useCallback((element: SVGGElement) => {
    return runtime.registerMarker(pathId, index, element)
  }, [index, pathId, runtime])

  return useRegisteredElementRef(register)
}

const pathDataEqual = (current: Record<string, EdgeRenderData>, next: Record<string, EdgeRenderData>) => {
  const currentKeys = Object.keys(current)
  const nextKeys = Object.keys(next)

  return currentKeys.length === nextKeys.length &&
    nextKeys.every((key) => current[key]?.d === next[key]?.d)
}

const TransitionPath = ({
  d,
  path,
  runtime
}: {
  d: string;
  path: TransitionPathDescriptor;
  runtime: BranchTransitionRuntime;
}) => {
  const pathRef = usePathRef(path.id, runtime)

  return (
    <path
      ref={pathRef}
      data-edge-id={path.id}
      data-status={path.status}
      d={d}
      fill="transparent"
      pointerEvents="none"
      stroke={accentColor}
      strokeWidth={2}
    />
  )
}

const markerKey = (edgeId: string, transitionId: string, index: number) => (
  `${edgeId}\u001f${transitionId}\u001f${index}`
)

const effectMarkerKey = (edgeId: string, transitionId: string, index: number) => (
  `${markerKey(edgeId, transitionId, index)}\u001feffect`
)

const truncateLabel = (value: string, maxLength = 56) => (
  value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value
)

const joinLabels = (values: string[]) => values.join(", ")

const accentColor = "var(--jp-color-accent, var(--color-accent, oklch(0.62 0.14 255)))"
const borderColor = "var(--jp-color-border, var(--color-border, oklch(0.9 0.01 285)))"
const foregroundColor = "var(--jp-color-foreground, var(--color-foreground, oklch(0.21 0.01 285)))"
const mutedForegroundColor = "var(--jp-color-foreground-muted, var(--color-foreground-muted, oklch(0.48 0.01 285)))"
const surfaceColor = "var(--jp-color-surface, var(--color-surface, oklch(1 0 0)))"

const getEffectMarkerAriaLabel = (marker: EffectMarkerActivation) => {
  const parts = [
    marker.label,
    `Trace: ${marker.traceIds.join(", ")}`
  ]
  const effects = marker.effectSummary?.effects ?? []
  const produced = marker.effectSummary?.produced ?? []
  const consumed = marker.effectSummary?.consumed ?? []

  if (effects.length > 0) {
    parts.push(`Effects: ${joinLabels(effects)}`)
  }

  if (produced.length > 0) {
    parts.push(`Produces: ${joinLabels(produced)}`)
  }

  if (consumed.length > 0) {
    parts.push(`Consumes: ${joinLabels(consumed)}`)
  }

  return parts.join(". ")
}

const EdgeMarker = ({
  edgeId,
  index,
  point,
  runtime,
  transition,
  onActivate,
  onDeactivate,
}: {
  edgeId: string;
  index: number;
  point: Point;
  runtime: BranchTransitionRuntime;
  transition: UJGGraphTransition;
  onActivate: (marker: ActiveMarker) => void;
  onDeactivate: (id: string) => void;
}) => {
  const id = markerKey(edgeId, transition.id, index)
  const markerRef = useMarkerRef(edgeId, index, runtime)
  const marker = {
    id,
    label: transition.label || transition.id,
    point,
    traceIds: transition.trace.map((item) => item.id)
  }

  return (
    <g
      ref={markerRef}
      aria-label={`${marker.label}. Trace: ${marker.traceIds.join(", ")}`}
      className={styles.marker}
      data-edge-marker-id={id}
      onBlur={() => onDeactivate(id)}
      onFocus={() => onActivate(marker)}
      onPointerEnter={() => onActivate(marker)}
      onPointerLeave={() => onDeactivate(id)}
      onPointerUp={(event) => {
        event.stopPropagation()
        onActivate(marker)
      }}
      pointerEvents="auto"
      role="button"
      tabIndex={0}
    >
      <circle
        cx={point.x}
        cy={point.y}
        fill={accentColor}
        r={3}
        stroke="white"
        strokeWidth={2}
      />
    </g>
  )
}

const EffectIcon = ({
  direction,
  x
}: {
  direction: "consumed" | "produced";
  x: number;
}) => (
  <g transform={`translate(${x} 0)`}>
    <rect
      className={styles.effectIconBackground}
      height={20}
      rx={5}
      width={20}
    />
    <path
      className={styles.effectIconGlyph}
      d={direction === "produced" ? "M 7 13 L 13 7 M 9 7 H 13 V 11" : "M 13 7 L 7 13 M 7 9 V 13 H 11"}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
    />
  </g>
)

const EdgeEffectMarker = ({
  block,
  edgeId,
  index,
  point,
  transition,
  onActivate,
  onDeactivate,
}: {
  block: boolean;
  edgeId: string;
  index: number;
  point: Point;
  transition: UJGGraphTransition;
  onActivate: (marker: ActiveMarker) => void;
  onDeactivate: (id: string) => void;
}) => {
  const effectSummary = useMemo(() => (
    getTransitionEffectMarkerSummary(transition)
  ), [transition])

  if (effectSummary.icons.length === 0) return null

  const id = effectMarkerKey(edgeId, transition.id, index)
  const iconSize = 20
  const iconGap = 4
  const totalWidth = effectSummary.icons.length * iconSize + (effectSummary.icons.length - 1) * iconGap
  const x = block ? point.x + 12 : point.x - totalWidth / 2
  const y = block ? point.y - iconSize / 2 : point.y - 32
  const marker = {
    effectSummary,
    id,
    label: transition.label || transition.id,
    point,
    traceIds: transition.trace.map((item) => item.id)
  }

  return (
    <g
      aria-label={getEffectMarkerAriaLabel(marker)}
      className={styles.effectMarker}
      data-edge-effect-marker-id={id}
      onBlur={() => onDeactivate(id)}
      onFocus={() => onActivate(marker)}
      onPointerEnter={() => onActivate(marker)}
      onPointerLeave={() => onDeactivate(id)}
      onPointerUp={(event) => {
        event.stopPropagation()
        onActivate(marker)
      }}
      pointerEvents="auto"
      role="button"
      tabIndex={0}
      transform={`translate(${x} ${y})`}
    >
      {effectSummary.icons.map((icon, iconIndex) => (
        <EffectIcon
          direction={icon.direction}
          key={icon.id}
          x={iconIndex * (iconSize + iconGap)}
        />
      ))}
    </g>
  )
}

const EdgeMarkerTooltip = ({ marker }: { marker: ActiveMarker }) => {
  const label = truncateLabel(marker.label)
  const trace = truncateLabel(`Trace: ${marker.traceIds.join(" → ")}`, 72)
  const effectLines = [
    ...(marker.effectSummary?.produced.length ? [`Produces: ${joinLabels(marker.effectSummary.produced)}`] : []),
    ...(marker.effectSummary?.consumed.length ? [`Consumes: ${joinLabels(marker.effectSummary.consumed)}`] : [])
  ].map((line) => truncateLabel(line, 72))
  const lines = [label, trace, ...effectLines]
  const width = Math.max(160, Math.min(420, Math.max(...lines.map((line) => line.length)) * 6.5 + 20))
  const height = 30 + lines.length * 18
  const x = marker.point.x + 12
  const y = marker.point.y - height - 10

  return (
    <g
      aria-hidden="true"
      className={styles.tooltip}
      pointerEvents="none"
      transform={`translate(${x} ${y})`}
    >
      <rect
        fill={surfaceColor}
        height={height}
        rx={6}
        stroke={borderColor}
        width={width}
      />
      <text fill={foregroundColor} fontWeight={600} x={10} y={18}>
        {label}
      </text>
      <text fill={mutedForegroundColor} x={10} y={36}>
        {trace}
      </text>
      {effectLines.map((line, index) => (
        <text fill={mutedForegroundColor} key={line} x={10} y={54 + index * 18}>
          {line}
        </text>
      ))}
    </g>
  )
}

export const Edge = ({
  in: inEndpoint,
  out,
  pathRegistry,
  registry,
  status
}: {
  in: EndpointRef | undefined;
  out: EndpointRef | undefined;
  pathRegistry: TransitionPathRegistry;
  registry?: Registry;
  status: TransitionPathDescriptor["status"];
}) => {
  const transitions = useMemo(() => (
    out && inEndpoint
      ? registry?.getResolvedTransitions(out.id, inEndpoint.id) ?? []
      : []
  ), [inEndpoint, out, registry])

  useIsomorphicLayoutEffect(() => {
    if (!out || !inEndpoint) return

    return pathRegistry.registerPath({
      out,
      in: inEndpoint,
      status,
      transitions
    })
  }, [inEndpoint, out, pathRegistry, status, transitions])

  return null
}

export const TransitionPathLayer = ({
  block = false,
  containerElement,
  pathRegistry,
  runtime
}: {
  block?: boolean;
  containerElement: HTMLDivElement | null;
  pathRegistry: TransitionPathRegistry;
  runtime: BranchTransitionRuntime;
}) => {
  const subscribeToPathRegistry = useCallback((listener: () => void) => {
    return pathRegistry.subscribe(listener)
  }, [pathRegistry])
  const getPathRegistrySnapshot = useCallback(() => {
    return pathRegistry.getSnapshot()
  }, [pathRegistry])
  const snapshot = useSyncExternalStore(
    subscribeToPathRegistry,
    getPathRegistrySnapshot,
    getPathRegistrySnapshot
  )
  const [pathData, setPathData] = useState<Record<string, EdgeRenderData>>({})
  const [activeMarker, setActiveMarker] = useState<ActiveMarker | undefined>(undefined)

  useIsomorphicLayoutEffect(() => {
    if (!containerElement) return

    let animationFrame = 0

    const syncPathData = () => {
      const nextPathData: Record<string, EdgeRenderData> = {}

      snapshot.paths.forEach((path) => {
        const curve = getLocalCurve(
          containerElement,
          path.out.current ?? undefined,
          path.in.current ?? undefined,
          block ? "block" : "inline"
        )

        if (curve) {
          nextPathData[path.id] = {
            curve,
            d: createSvgPath(curve)
          }
        }
      })

      setPathData((current) => (
        pathDataEqual(current, nextPathData) ? current : nextPathData
      ))
      runtime.syncPaths(snapshot.descriptors)
    }

    syncPathData()
    animationFrame = window.requestAnimationFrame(syncPathData)
    window.addEventListener("resize", syncPathData)

    return () => {
      window.cancelAnimationFrame(animationFrame)
      window.removeEventListener("resize", syncPathData)
    }
  }, [block, containerElement, runtime, snapshot])

  return (
    <svg className={styles.layer}>
      {snapshot.paths.map((path) => (
        <TransitionPath
          key={path.id}
          d={pathData[path.id]?.d || ""}
          path={path}
          runtime={runtime}
        />
      ))}
      {snapshot.paths.flatMap((path) => {
        const curve = pathData[path.id]?.curve
        if (!curve || path.transitions.length === 0) return []

        return getMarkerProgresses(path.transitions.length).map((progress, index) => {
          const point = getPointOnCurve(curve, progress)
          const transition = path.transitions[index]

          return (
            <g key={markerKey(path.id, transition.id, index)}>
              <EdgeMarker
                edgeId={path.id}
                index={index}
                onActivate={setActiveMarker}
                onDeactivate={(id) => {
                  setActiveMarker((current) => current?.id === id ? undefined : current)
                }}
                point={point}
                runtime={runtime}
                transition={transition}
              />
              <EdgeEffectMarker
                block={block}
                edgeId={path.id}
                index={index}
                onActivate={setActiveMarker}
                onDeactivate={(id) => {
                  setActiveMarker((current) => current?.id === id ? undefined : current)
                }}
                point={point}
                transition={transition}
              />
            </g>
          )
        })
      })}
      {activeMarker ? <EdgeMarkerTooltip marker={activeMarker} /> : null}
    </svg>
  )
}
