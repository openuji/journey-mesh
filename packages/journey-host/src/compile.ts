import { basename, dirname, relative, resolve, sep } from "node:path";
import { immutableJourneyPlan } from "@openuji/journey-execution-model";
import type { JourneyModelCompiler, JourneyModelView } from "@openuji/journey-plugin";
import type { JourneyPlan, JourneyPlanOperation } from "@openuji/journey-runner";
import { interpolate, type Environment } from "./config/load.js";
import type { TestConfig } from "./config/schema.js";

/** One configured journey item inside a test plan, and the adapter that executes it. */
export type Segment = Readonly<{ id: string; adapter: string; journeyId: string; source: string }>;
export type CompiledTest = Readonly<{
  plan: JourneyPlan;
  segments: ReadonlyMap<string, Segment>;
  /** `<journey item>.<alias>` → plan operation ID. */
  aliases: ReadonlyMap<string, string>;
  /** Model document snapshots by segment source, recorded with the run. */
  views: ReadonlyMap<string, JourneyModelView>;
}>;

/** The segment of a compiled operation. Every operation of a compiled test has one. */
export function segmentOf(compiled: CompiledTest, operation: JourneyPlanOperation): Segment {
  const segment = operation.segment === undefined ? undefined : compiled.segments.get(operation.segment);
  if (!segment) throw new Error(`Operation ${operation.id} belongs to no configured journey`);
  return segment;
}

/**
 * Compile each journey item and concatenate them into one sequential plan. Operation IDs are
 * prefixed with test and item so repeated model operations stay distinct; `segment` records the item.
 */
export async function compileTest(test: TestConfig, compiler: JourneyModelCompiler, configPath: string, env: Environment): Promise<CompiledTest> {
  const operations: JourneyPlanOperation[] = [];
  const segments = new Map<string, Segment>();
  const aliases = new Map<string, string>();
  const views = new Map<string, JourneyModelView>();
  for (const item of test.journeys) {
    const source = resolve(dirname(configPath), interpolate(item.source, env, `journey ${item.id}.source`));
    // Provenance stays relative to the configuration, so run records carry no local paths.
    const sourceRef = relative(dirname(configPath), source).split(sep).join("/");
    const child = await compiler.compile(source, item.select);
    if (!child.operations.length) throw new Error(`Journey ${item.id} has no executable operations`);
    const prefix = `${encodeURIComponent(test.id)}/${encodeURIComponent(item.id)}/`;
    for (const [name, selector] of Object.entries(item.operations)) {
      const operation = compiler.resolveOperation(child, selector);
      if (!child.operations.includes(operation)) throw new Error("Model selector returned an operation outside its plan");
      aliases.set(`${item.id}.${name}`, prefix + operation.id);
    }
    segments.set(item.id, Object.freeze({ id: item.id, adapter: item.adapter, journeyId: item.select, source: sourceRef }));
    if (!views.has(sourceRef)) {
      const view = await compiler.view?.(source);
      if (view) views.set(sourceRef, view);
    }
    for (const operation of child.operations) {
      operations.push({
        ...operation, id: prefix + operation.id, sequence: operations.length, segment: item.id,
        source: { references: {
          ...operation.source?.references,
          originalOperationId: operation.id, documentId: !child.source?.documentId || child.source.documentId === source ? sourceRef : child.source.documentId, source: sourceRef, journeyId: item.select
        } }
      });
    }
  }
  const plan = immutableJourneyPlan<JourneyPlan>({
    id: `journey-test:${encodeURIComponent(test.id)}`,
    source: { model: "journey-mesh-test", references: { testId: test.id, config: basename(configPath) } },
    operations
  });
  return Object.freeze({ plan, segments, aliases, views });
}
