/** Detached data shared by observers and reporters. No model or runtime handles. */
export type MeasurementScope = Readonly<{
  runId: string;
  executionId: string;
  profileId: string;
  operationIds: readonly string[];
}>;

export type JourneyMeasurement = Readonly<{
  id: string;
  label: string;
  method: string;
  unit: string;
  aggregation: string;
  scope: MeasurementScope;
  status: "available" | "partial" | "unavailable" | "not-applicable";
  value: number | boolean | string | null;
  reason?: string;
}>;

export type JourneyMetricCounts = Readonly<{ violations: number; incomplete: number; passes: number; inapplicable: number }>;
/**
 * A compact result shown in the footer of a journey-map node. `axe` reports a full-page (`pageState`)
 * and a surface-scoped (`matchedSurface`) audit; `native` reports hierarchy findings and passed checks.
 */
export type JourneyNodeMetrics =
  | Readonly<{ kind: "axe"; pageState?: JourneyMetricCounts; matchedSurface?: JourneyMetricCounts }>
  | Readonly<{ kind: "native"; findings: number; passes: number }>
  | Readonly<{ kind: "skipped"; reason?: string }>;
/** What an observer recorded for one operation of one execution, for display on the journey map. */
export type JourneyNodeSummary = Readonly<{ executionId: string; operationId: string; metrics: JourneyNodeMetrics }>;

export type JourneyObserverOutput = Readonly<{
  id: string;
  kind: string;
  measurements: readonly JourneyMeasurement[];
  /** Optional per-operation summaries shown on journey-map nodes; details stay in `evidence`. */
  nodes?: readonly JourneyNodeSummary[];
  /** Provider-owned, serializable evidence; interpreted by the provider's reporter. */
  evidence: unknown;
  errors: readonly Readonly<{ name: string; message: string }>[];
}>;

/** One adapter command, not a physical keystroke or a modeled transition. */
export type JourneyInputAction = Readonly<{
  id: string;
  runId: string;
  executionId: string;
  profileId: string;
  operationId: string;
  modalityId: string;
  command: string;
  unit: "adapter-command";
  status: "attempted" | "completed" | "failed";
  error?: Readonly<{ name: string; message: string }>;
}>;

export type Immutable<T> = T extends readonly (infer U)[]
  ? readonly Immutable<U>[]
  : T extends object ? { readonly [K in keyof T]: Immutable<T[K]> } : T;

/** Detach before freezing so caller-owned data is never frozen in place. */
export function immutableSnapshot<T>(value: T): Immutable<T> {
  const copy = structuredClone(value);
  const freeze = (item: unknown): void => {
    if (item !== null && typeof item === "object") {
      Object.values(item).forEach(freeze);
      Object.freeze(item);
    }
  };
  freeze(copy);
  return copy as Immutable<T>;
}
