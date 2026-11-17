import type {
  UJGEffectResourceDirection,
  UJGGraphTransition
} from "../../data/parser"

export type EffectMarkerIcon = {
  id: string;
  direction: UJGEffectResourceDirection;
  effectLabel: string;
  resourceLabel: string;
}

export type EffectMarkerSummary = {
  consumed: string[];
  effects: string[];
  icons: EffectMarkerIcon[];
  produced: string[];
}

const getLabel = (label: string | undefined, id: string) => label || id

export const getTransitionEffectMarkerSummary = (
  transition: Pick<UJGGraphTransition, "effectAnnotations">
): EffectMarkerSummary => {
  const effects: string[] = []
  const produced: string[] = []
  const consumed: string[] = []
  const icons: EffectMarkerIcon[] = []

  transition.effectAnnotations?.forEach((annotation, annotationIndex) => {
    const effectLabel = getLabel(annotation.effect.label, annotation.effect.id)
    effects.push(effectLabel)

    annotation.resources.forEach((resource, resourceIndex) => {
      const resourceLabel = getLabel(resource.label, resource.id)
      const icon = {
        id: [
          annotation.transitionRef,
          annotation.effect.id,
          resource.id,
          resource.direction,
          annotationIndex,
          resourceIndex
        ].join("\u001f"),
        direction: resource.direction,
        effectLabel,
        resourceLabel
      }

      icons.push(icon)

      if (resource.direction === "produced") {
        produced.push(resourceLabel)
        return
      }

      consumed.push(resourceLabel)
    })
  })

  return {
    consumed,
    effects,
    icons,
    produced
  }
}
