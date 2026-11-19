/**
 * The extension point of the reporting layer: an interpreter turns one observer's recorded evidence
 * into report data. It runs after the run, reads only the run record, and never affects the verdict.
 */
import type { JourneyObserverOutput } from "@openuji/journey-core";
import type { TestRecord } from "@openuji/journey-run-record";
import type { NodeMetrics } from "./model/types.js";

export type InterpreterInput<O extends JourneyObserverOutput = JourneyObserverOutput> = Readonly<{
  test: TestRecord;
  output: O;
  /** Read an evidence file of the run; `href` is relative to the run directory. */
  read(href: string): Promise<Uint8Array>;
  /** Read and parse a JSON evidence file of the run. */
  readJson<T = unknown>(href: string): Promise<T>;
  /** Phases the report excludes from presentation; their operations still executed. */
  excludedPhaseIds: readonly string[];
}>;

/** Compact metrics for one operation of one execution, e.g. a journey-map node footer. */
export type NodeSummary = Readonly<{ executionId: string; operationId: string; metrics: NodeMetrics }>;
/** A JSON document derived from evidence. `name` is a relative file name, unique per observer. */
export type DerivedData = Readonly<{ name: string; format: string; label?: string; value: unknown }>;
export type Interpretation = Readonly<{ nodes?: readonly NodeSummary[]; data?: readonly DerivedData[] }>;

export type InterpreterDefinition<S = unknown> = Readonly<{
  /** Matches `JourneyObserverOutput.kind`. */
  kind: string;
  /** Validate `options` from the report configuration. */
  parse?(options: Record<string, unknown>): S;
  interpret(input: InterpreterInput, settings: S): Interpretation | Promise<Interpretation>;
}>;

/** What an interpreter module exports as `journeyMeshInterpreter`. */
export const defineInterpreter = <S = unknown>(definition: InterpreterDefinition<S>): InterpreterDefinition<S> => definition;
