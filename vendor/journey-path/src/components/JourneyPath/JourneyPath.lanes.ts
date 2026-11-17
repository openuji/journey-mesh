export type LaneTone = "accent" | "violet" | "success" | "warning" | "danger"

export type LaneOwner = {
  id: string;
  label: string;
  number?: number;
  tone: LaneTone;
}

export type MeasuredLaneNode = {
  occurrenceId: string;
  stateId: string;
  left: number;
  right: number;
  step?: LaneOwner;
  phase?: LaneOwner;
}

export type LaneSegment = LaneOwner & {
  left: number;
  width: number;
}

type LaneSegmentInput = {
  fallbackOwner: LaneOwner;
  getOwner: (node: MeasuredLaneNode) => LaneOwner | undefined;
  nodes: MeasuredLaneNode[];
  width: number;
}

const clamp = (value: number, min: number, max: number) => (
  Math.min(max, Math.max(min, value))
)

const createSegment = (
  owner: LaneOwner,
  index: number,
  start: number,
  end: number
): LaneSegment => ({
  ...owner,
  id: `${owner.id}:${index}`,
  left: start,
  width: Math.max(0, end - start)
})

export const createMeasuredLaneSegments = ({
  fallbackOwner,
  getOwner,
  nodes,
  width
}: LaneSegmentInput): LaneSegment[] => {
  const containerWidth = Math.max(0, width)
  const sortedNodes = [...nodes].sort((left, right) => (
    left.left - right.left ||
    left.right - right.right ||
    left.occurrenceId.localeCompare(right.occurrenceId)
  ))

  if (sortedNodes.length === 0) {
    return [createSegment(fallbackOwner, 0, 0, containerWidth)]
  }

  const segments: LaneSegment[] = []
  let currentOwner = getOwner(sortedNodes[0]) ?? fallbackOwner
  let segmentStart = 0

  for (let index = 1; index < sortedNodes.length; index += 1) {
    const previousNode = sortedNodes[index - 1]
    const currentNode = sortedNodes[index]
    const nextOwner = getOwner(currentNode) ?? fallbackOwner

    if (nextOwner.id === currentOwner.id) continue

    const midpoint = (previousNode.right + currentNode.left) / 2
    const boundary = clamp(midpoint, segmentStart, containerWidth)

    segments.push(createSegment(currentOwner, segments.length, segmentStart, boundary))
    currentOwner = nextOwner
    segmentStart = boundary
  }

  segments.push(createSegment(currentOwner, segments.length, segmentStart, containerWidth))

  return segments
}
