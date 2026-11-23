export { toJourneyMapDocument } from "./index.js";

export type JourneyMapDocument = {
  touchpoints?: Record<string, Fields>;
  users?: Record<string, Fields>;
  artifacts?: Record<string, Fields>;
  effects?: Record<string, Fields>;
  locales?: Record<string, Fields>;
  messageMeta?: Record<string, Fields>;
  messages?: Record<string, Fields>;
  phases?: Record<string, Fields>;
  steps?: Record<string, Fields>;
  journeyEntryIndex?: Fields & { id: string };
  states: Record<string, MapState>;
};
export type Fields = Record<string, unknown>;
export type MapJourney = {
  id: string; label?: string; defaultEntryRef?: string;
  entries: Record<string, Fields>; exits?: Record<string, Fields>;
  states: Record<string, MapState>; transitions?: Fields[];
};
export type MapState = { type: "CompositeState"; label?: string; subjourney: MapJourney } | { label?: string; surface?: Readonly<{ id: string; label?: string }> };
