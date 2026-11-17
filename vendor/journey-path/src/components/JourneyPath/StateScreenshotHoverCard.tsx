import {
  useCallback,
  useRef,
  useState
} from "react"
import type {
  ReactNode
} from "react"
import type {
  StateNodeMetrics
} from "../StateNode/StateMetricsFooter"
import { useIsomorphicLayoutEffect } from "../../useIsomorphicLayoutEffect"
import styles from "./JourneyPath.module.css"

export type JourneyPathPreviewData = {
  states?: Record<string, {
    id?: string;
    status?: 'skipped' | 'audited'
    metrics?: StateNodeMetrics | null;
    sourceScreenshotHref?: string | null;
  } | undefined>;
}

const STATE_PREVIEW_GAP = 8
const STATE_PREVIEW_VIEWPORT_PADDING = 12

type StatePreviewSide = "bottom" | "left" | "right" | "top"

type StatePreviewBounds = {
  bottom: number;
  height: number;
  left: number;
  right: number;
  top: number;
  width: number;
}

type StatePreviewPosition = {
  left: number;
  side: StatePreviewSide;
  top: number;
}

const clampValue = (value: number, min: number, max: number) => (
  Math.min(Math.max(value, min), Math.max(min, max))
)

const roundMeasurement = (value: number) => Math.round(value * 1000) / 1000

export const getStatePreviewPosition = ({
  hostRect,
  portrait,
  previewRect,
  viewportHeight,
  viewportWidth
}: {
  hostRect: StatePreviewBounds;
  portrait: boolean;
  previewRect: Pick<StatePreviewBounds, "height" | "width">;
  viewportHeight: number;
  viewportWidth: number;
}): StatePreviewPosition => {
  const availableSpace: Record<StatePreviewSide, number> = {
    bottom: viewportHeight - hostRect.bottom - STATE_PREVIEW_GAP - STATE_PREVIEW_VIEWPORT_PADDING,
    left: hostRect.left - STATE_PREVIEW_GAP - STATE_PREVIEW_VIEWPORT_PADDING,
    right: viewportWidth - hostRect.right - STATE_PREVIEW_GAP - STATE_PREVIEW_VIEWPORT_PADDING,
    top: hostRect.top - STATE_PREVIEW_GAP - STATE_PREVIEW_VIEWPORT_PADDING
  }
  const requiredSpace: Record<StatePreviewSide, number> = {
    bottom: previewRect.height,
    left: previewRect.width,
    right: previewRect.width,
    top: previewRect.height
  }
  const preferredSides: StatePreviewSide[] = portrait
    ? ["left", "right", "bottom", "top"]
    : ["bottom", "top", "right", "left"]
  const fittingSide = preferredSides.find((side) => (
    availableSpace[side] >= requiredSpace[side]
  ))
  const side = fittingSide ?? preferredSides.reduce((bestSide, candidateSide) => {
    const bestFit = availableSpace[bestSide] / Math.max(requiredSpace[bestSide], 1)
    const candidateFit = availableSpace[candidateSide] / Math.max(requiredSpace[candidateSide], 1)

    return candidateFit > bestFit ? candidateSide : bestSide
  })
  const preferredLeft = side === "left"
    ? hostRect.left - previewRect.width - STATE_PREVIEW_GAP
    : side === "right"
      ? hostRect.right + STATE_PREVIEW_GAP
      : hostRect.left + (hostRect.width / 2) - (previewRect.width / 2)
  const preferredTop = side === "top"
    ? hostRect.top - previewRect.height - STATE_PREVIEW_GAP
    : side === "bottom"
      ? hostRect.bottom + STATE_PREVIEW_GAP
      : hostRect.top + (hostRect.height / 2) - (previewRect.height / 2)

  return {
    left: roundMeasurement(clampValue(
      preferredLeft,
      STATE_PREVIEW_VIEWPORT_PADDING,
      viewportWidth - previewRect.width - STATE_PREVIEW_VIEWPORT_PADDING
    )),
    side,
    top: roundMeasurement(clampValue(
      preferredTop,
      STATE_PREVIEW_VIEWPORT_PADDING,
      viewportHeight - previewRect.height - STATE_PREVIEW_VIEWPORT_PADDING
    ))
  }
}

export const getStateScreenshotHref = (
  accessibilityDocument: JourneyPathPreviewData | undefined,
  stateId: string
) => {
  const sourceScreenshotHref = accessibilityDocument?.states?.[stateId]?.sourceScreenshotHref
  const trimmedHref = sourceScreenshotHref?.trim()

  return trimmedHref || undefined
}

export const getStateMetrics = (
  accessibilityDocument: JourneyPathPreviewData | undefined,
  stateId: string
) => {if(accessibilityDocument?.states?.[stateId]?.status === "skipped"){
    return {kind: "skipped"} as const
  } else {
  return accessibilityDocument?.states?.[stateId]?.metrics ?? null
  }
}

export const StateScreenshotHoverCard = ({
  children,
  sourceScreenshotHref
}: {
  children: ReactNode;
  sourceScreenshotHref?: string;
}) => {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const previewRef = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<StatePreviewPosition>({
    left: 0,
    side: "bottom",
    top: 0
  })
  const updatePreviewPosition = useCallback(() => {
    const hostElement = hostRef.current
    const previewElement = previewRef.current

    if (!hostElement || !previewElement || typeof window === "undefined") return

    const viewportWidth = document.documentElement.clientWidth || window.innerWidth
    const viewportHeight = document.documentElement.clientHeight || window.innerHeight
    const hostRect = hostElement.getBoundingClientRect()
    const previewRect = previewElement.getBoundingClientRect()
    const previewImage = previewElement.querySelector("img")
    const portrait = Boolean(
      previewImage && previewImage.naturalHeight > previewImage.naturalWidth
    )
    const nextPosition = getStatePreviewPosition({
      hostRect,
      portrait,
      previewRect,
      viewportHeight,
      viewportWidth
    })

    setPosition((currentPosition) => (
      currentPosition.left === nextPosition.left &&
      currentPosition.side === nextPosition.side &&
      currentPosition.top === nextPosition.top
        ? currentPosition
        : nextPosition
    ))
  }, [])
  const openPreview = useCallback(() => {
    updatePreviewPosition()
    setOpen(true)
  }, [updatePreviewPosition])
  const closePreview = useCallback(() => {
    setOpen(false)
  }, [])

  useIsomorphicLayoutEffect(() => {
    if (!open) return

    const handlePositionChange = () => {
      updatePreviewPosition()
    }

    updatePreviewPosition()
    window.addEventListener("resize", handlePositionChange)

    return () => {
      window.removeEventListener("resize", handlePositionChange)
    }
  }, [open, updatePreviewPosition])

  if (!sourceScreenshotHref) return <>{children}</>

  return (
    <div
      className={styles.statePreviewHost}
      data-open={open ? "true" : "false"}
      onBlur={closePreview}
      onFocus={openPreview}
      onPointerEnter={openPreview}
      onPointerLeave={closePreview}
      ref={hostRef}
      tabIndex={0}
    >
      {children}
      <div
        className={styles.statePreview}
        data-open={open ? "true" : "false"}
        data-side={position.side}
        ref={previewRef}
        role="presentation"
        style={{
          left: position.left,
          top: position.top
        }}
      >
        <img
          alt=""
          className={styles.statePreviewImage}
          decoding="async"
          loading="lazy"
          onLoad={updatePreviewPosition}
          src={sourceScreenshotHref}
        />
      </div>
    </div>
  )
}
