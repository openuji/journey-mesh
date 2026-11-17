import { immutableSnapshot, type JourneyMeasurement } from "@openuji/journey-core";
import type { ComparisonPairing, ComparisonResultBundle, SuiteResultBundle } from "@openuji/journey-plugin";

export type MeasurementDifference = Readonly<{
  pairing: string; observer: string; metric: string; label: string; unit: string;
  status: "available" | "missing" | "partial" | "incompatible";
  baseline: JourneyMeasurement | null; candidate: JourneyMeasurement | null;
  delta: number | null; changed: boolean | null; reason?: string;
}>;

function selections(bundle: SuiteResultBundle | null) {
  const result = new Map<string, { test: string; profile: string }>();
  for (const test of bundle?.tests ?? []) for (const assessment of test.result.assessments) {
    result.set(JSON.stringify([test.id, assessment.profile.id]), { test: test.id, profile: assessment.profile.id });
  }
  return result;
}
/** Pair executions with the same test and profile IDs; anything else needs explicit pairings. */
export function inferPairings(baseline: SuiteResultBundle | null, candidate: SuiteResultBundle | null): readonly ComparisonPairing[] {
  const left = selections(baseline); const right = selections(candidate);
  return immutableSnapshot([...new Set([...left.keys(), ...right.keys()])].map((key) => {
    const [test, profile] = JSON.parse(key) as [string, string];
    return { id: `${test}/${profile}`, baseline: left.get(key) ?? { test: "", profile: "" }, candidate: right.get(key) ?? { test: "", profile: "" } };
  }));
}
/** Reject explicit pairings whose selections do not exist in the saved subjects. */
export function validatePairings(pairings: readonly ComparisonPairing[], subjects: Readonly<Record<"baseline" | "candidate", SuiteResultBundle | null>>): readonly ComparisonPairing[] {
  const ids = new Set<string>();
  for (const pairing of pairings) {
    if (!pairing || typeof pairing.id !== "string" || !pairing.id) throw new Error("Each pairing needs an id");
    if (ids.has(pairing.id)) throw new Error(`Duplicate pairing ${pairing.id}`);
    ids.add(pairing.id);
    for (const side of ["baseline", "candidate"] as const) {
      const selection = pairing[side];
      if (!selection || typeof selection.test !== "string" || typeof selection.profile !== "string") throw new Error(`Pairing ${pairing.id} needs ${side}.test and ${side}.profile`);
      const bundle = subjects[side];
      if (bundle && !selections(bundle).has(JSON.stringify([selection.test, selection.profile]))) throw new Error(`Unknown ${side} selection ${selection.test}/${selection.profile} in pairing ${pairing.id}`);
    }
  }
  return immutableSnapshot(pairings.map(({ id, baseline, candidate }) => ({ id, baseline: { test: baseline.test, profile: baseline.profile }, candidate: { test: candidate.test, profile: candidate.profile } })));
}

export function compareMeasurements(bundle: ComparisonResultBundle): readonly MeasurementDifference[] {
  const rows: MeasurementDifference[] = [];
  for (const pairing of bundle.pairings) {
    const measures = (side: "baseline" | "candidate") => {
      const selected = pairing[side];
      const test = bundle.subjects[side].bundle?.tests.find((item) => item.id === selected.test);
      const map = new Map<string, { observer: string; metric: JourneyMeasurement }>();
      for (const output of test?.outputs ?? []) for (const metric of output.measurements) {
        if (metric.scope.profileId !== selected.profile) continue;
        const key = JSON.stringify([output.id, metric.id]);
        if (map.has(key)) throw new Error(`Ambiguous measurement ${key} in ${pairing.id}`);
        map.set(key, { observer: output.id, metric });
      }
      return map;
    };
    const left = measures("baseline"); const right = measures("candidate");
    for (const key of new Set([...left.keys(), ...right.keys()])) {
      const baseline = left.get(key)?.metric ?? null; const candidate = right.get(key)?.metric ?? null;
      const item = left.get(key) ?? right.get(key)!;
      const common = { pairing: pairing.id, observer: item.observer, metric: item.metric.id, label: item.metric.label, unit: item.metric.unit, baseline, candidate, delta: null, changed: null };
      if (!baseline || !candidate) { rows.push({ ...common, status: "missing", reason: "The measurement is absent from one subject." }); continue; }
      if (baseline.status !== "available" || candidate.status !== "available" || baseline.value === null || candidate.value === null) {
        rows.push({ ...common, status: "partial", reason: "Both subjects require available measurements before a difference can be calculated." }); continue;
      }
      if (baseline.method !== candidate.method || baseline.unit !== candidate.unit || baseline.aggregation !== candidate.aggregation || typeof baseline.value !== typeof candidate.value) {
        rows.push({ ...common, status: "incompatible", reason: "Measurement methods, units, aggregations or value types differ." }); continue;
      }
      rows.push({ ...common, status: "available", changed: baseline.value !== candidate.value, delta: typeof baseline.value === "number" && typeof candidate.value === "number" ? candidate.value - baseline.value : null });
    }
  }
  return immutableSnapshot(rows);
}
