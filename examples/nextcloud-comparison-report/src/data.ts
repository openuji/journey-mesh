import type { JourneyMetrics } from "@openuji/journey-observer-ux";
import { immutableSnapshot } from "@openuji/journey-observer-ux";
import type { RunResult } from "@openuji/journey-runner";

export type Variant = Readonly<{
  id: string;
  label: string;
  version: string;
  image: string;
  sourceSha?: string;
}>;
export type Manifest = Readonly<{
  title: string;
  contextUrl: string;
  variants: readonly Variant[];
}>;
export type AuditEntry = Readonly<{
  status?: string;
  metrics?: {
    pageState?: {
      violations: number;
      incomplete: number;
      passes: number;
      inapplicable: number;
    };
    matchedSurface?: {
      violations: number;
      incomplete: number;
      passes: number;
      inapplicable: number;
    };
  };
  sourceScreenshotHref?: string;
  sourceHtmlHref?: string;
}>;
export type AuditProfile = Readonly<{
  states: Readonly<Record<string, AuditEntry>>;
  transitions?: Readonly<Record<string, AuditEntry>>;
}>;
export type VariantInput = Readonly<{
  variant: Variant;
  model: string;
  run: Readonly<{
    startedAt?: string;
    completedAt?: string;
    error?: string | null;
  }> | null;
  deployment: Readonly<{
    verifiedAt: string;
    services: readonly {
      service: string;
      version: string;
      imageId: string;
      sourceSha: string | null;
    }[];
  }> | null;
  result: RunResult | null;
  reportingErrors: readonly { message: string }[];
  metrics: readonly JourneyMetrics[];
  audits: Readonly<Record<string, AuditProfile>>;
}>;
export type ComparisonReportData = Readonly<{
  format: "journey-mesh/comparison-report/v1";
  title: string;
  contextUrl: string;
  generatedAt: string;
  workflowUrl: string | null;
  variants: readonly (VariantInput & {
    status: "passed" | "failed" | "unavailable";
  })[];
}>;

/** Pure projection; all environment, time, and evidence inputs are explicit. */
export function buildComparisonReport(
  input: Readonly<{
    manifest: Manifest;
    variants: readonly VariantInput[];
    generatedAt: string;
    workflowUrl: string | null;
  }>,
): ComparisonReportData {
  if (
    new Set(input.variants.map((v) => v.variant.id)).size !==
    input.variants.length
  )
    throw new Error("Duplicate comparison variant");
  return immutableSnapshot({
    format: "journey-mesh/comparison-report/v1" as const,
    title: input.manifest.title,
    contextUrl: input.manifest.contextUrl,
    generatedAt: input.generatedAt,
    workflowUrl: input.workflowUrl,
    variants: input.manifest.variants.map((variant) => {
      const entry = input.variants.find((v) => v.variant.id === variant.id);
      if (!entry) throw new Error(`Missing variant input: ${variant.id}`);
      if (entry.result) {
        for (const metric of entry.metrics) {
          if (
            !entry.result.executions.some(
              (e) =>
                e.executionId === metric.executionId &&
                e.profileId === metric.profileId,
            )
          )
            throw new Error("Metrics do not match the functional execution");
        }
      } else if (entry.metrics.length)
        throw new Error("Metrics require a functional result");
      return {
        ...entry,
        status: entry.run?.error
          ? ("failed" as const)
          : !entry.result || !entry.deployment
            ? ("unavailable" as const)
            : entry.result.ok && !entry.reportingErrors.length
              ? ("passed" as const)
              : ("failed" as const),
      };
    }),
  });
}

export function auditTotals(profile: AuditProfile | undefined) {
  const entries = Object.values(profile?.states ?? {}).filter(
    (entry) => entry.status === "audited" && entry.metrics?.pageState,
  );
  return entries.length
    ? {
        violations: entries.reduce(
          (sum, entry) => sum + entry.metrics!.pageState!.violations,
          0,
        ),
        incomplete: entries.reduce(
          (sum, entry) => sum + entry.metrics!.pageState!.incomplete,
          0,
        ),
      }
    : null;
}

export function operationStatus(
  result: RunResult | null,
  profileId: string,
  graphNodeId: string,
): "passed" | "failed" | "unexecuted" {
  const operations =
    result?.evidence.executions.find((e) => e.profileId === profileId)
      ?.operations ?? [];
  const matching = operations.filter((op) => op.graphNodeId === graphNodeId);
  return matching.some((op) => op.outcome.kind === "failed")
    ? "failed"
    : matching.some((op) => op.outcome.kind === "passed")
      ? "passed"
      : "unexecuted";
}

export function profileStatus(
  variant: VariantInput,
  profileId: string,
): "passed" | "failed" | "unavailable" {
  if (variant.run?.error) return "failed";
  const execution = variant.result?.executions.find(
    (item) => item.profileId === profileId,
  );
  if (!execution || !variant.deployment) return "unavailable";
  return execution.outcome.kind === "passed" && !variant.reportingErrors.length
    ? "passed"
    : "failed";
}

export function operationError(
  result: RunResult | null,
  profileId: string,
  graphNodeId: string,
): string | undefined {
  const outcome = result?.evidence.executions
    .find((execution) => execution.profileId === profileId)
    ?.operations.find(
      (op) => op.graphNodeId === graphNodeId && op.outcome.kind === "failed",
    )?.outcome;
  return outcome?.kind === "failed" ? outcome.error.message : undefined;
}
