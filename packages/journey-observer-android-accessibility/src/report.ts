import { appiumAdapterName } from "@openuji/journey-adapter-appium";
import type { JourneyPlanOperation, JourneyOutcome, RunResult } from "@openuji/journey-runner";
import type { AndroidAccessibilityEvidence, AndroidOperationEvidence } from "./evidence.js";
import type { AndroidHierarchyCheck } from "./hierarchy.js";
import { immutableSnapshot, type Immutable } from "./immutable.js";

export type AndroidAccessibilityPathItem = Immutable<{
  executionId: string; profileId: string; operationId: string; graphNodeId: string;
  kind: JourneyPlanOperation["kind"];
  status: "checked" | "skipped" | "not-applicable" | "error";
  reason?: string; outcome?: JourneyOutcome;
  checks: readonly AndroidHierarchyCheck[];
  observation?: AndroidOperationEvidence;
}>;
export type AndroidAccessibilityReport = Immutable<{
  format: "journey-mesh/android-accessibility/v1";
  reportId: string; createdAt: string; runId: string; planId: string;
  strict: boolean;
  limits: readonly string[];
  summary: { executionCount: number; notApplicableProfileCount: number; checked: number; skipped: number; notApplicable: number; errors: number; findings: number; unassessed: number };
  items: readonly AndroidAccessibilityPathItem[];
}>;

export function buildAndroidAccessibilityReport(input: Readonly<{
  reportId: string; createdAt: string; result: RunResult;
  evidence: readonly AndroidAccessibilityEvidence[]; strict: boolean;
}>): AndroidAccessibilityReport {
  const facts = input.evidence.filter((fact) => fact.kind === "execution-started" ? fact.execution.runId === input.result.runId : fact.evidence.runId === input.result.runId);
  const candidates = facts.flatMap((fact) => fact.kind === "execution-started"
    ? fact.execution.plan.operations.map((operation) => ({ executionId: fact.execution.executionId, profileId: fact.execution.profile.id, operation }))
    : [fact.evidence]);
  const planned = candidates.filter((target, index) => candidates.findIndex((other) => other.executionId === target.executionId && other.operation.id === target.operation.id) === index);
  const items = planned.map((target): AndroidAccessibilityPathItem => {
    const observation = facts.reduce<AndroidOperationEvidence | undefined>((previous, fact) => fact.kind === "operation-observed" && fact.evidence.executionId === target.executionId && fact.evidence.operation.id === target.operation.id ? fact.evidence : previous, undefined);
    const attempted = input.result.evidence.executions.find((execution) => execution.executionId === target.executionId)?.operations.find((operation) => operation.operationId === target.operation.id);
    const operation = observation?.operation ?? target.operation;
    const graphNodeId = operation.kind === "state" ? operation.state.id : operation.transition.id;
    const base = { executionId: target.executionId, profileId: target.profileId, operationId: operation.id, graphNodeId, kind: operation.kind, ...(attempted ? { outcome: attempted.outcome } : {}), checks: observation?.checks ?? [], ...(observation ? { observation } : {}) };
    if (observation?.notApplicable) return { ...base, status: "not-applicable", reason: observation.notApplicable.reason };
    if (!observation && attempted?.adapter && attempted.adapter.name !== appiumAdapterName) return { ...base, status: "not-applicable", reason: `Operation was routed to adapter ${attempted.adapter.name}; no native hierarchy was observed.` };
    if (operation.kind === "control-flow" || observation?.stage === "control-flow-recorded") return { ...base, status: "not-applicable", reason: "Control flow has no native surface." };
    if (observation?.stage === "transition-completed") return { ...base, status: "not-applicable", reason: "No-input transition completed without a native target." };
    if (!observation) return { ...base, status: "skipped", reason: attempted?.outcome.kind === "failed" ? `Operation failed before hierarchy collection: ${attempted.outcome.error.message}` : "No native evidence was collected before execution ended." };
    if ([observation.hierarchy, observation.metrics, observation.screenshot].some((capture) => capture?.kind === "failed")) return { ...base, status: "error", reason: "Configured native evidence collection did not complete." };
    return { ...base, status: "checked" };
  });
  return immutableSnapshot({
    format: "journey-mesh/android-accessibility/v1", reportId: input.reportId,
    createdAt: input.createdAt, runId: input.result.runId, planId: input.result.plan.id,
    strict: input.strict,
    limits: ["Hierarchy heuristics only; TalkBack behavior and WCAG conformance are not established.", "Labels use captured text and descriptions in non-actionable descendant groups.", "Bounds may be clipped by the viewport or ancestor containers and may omit expanded hit areas; small reported sizes require manual review. Missing attributes or density remain unassessed."],
    summary: {
      executionCount: input.result.executions.length,
      notApplicableProfileCount: input.result.assessments.filter((assessment) => assessment.kind === "not-applicable").length,
      checked: items.filter((item) => item.status === "checked").length,
      skipped: items.filter((item) => item.status === "skipped").length,
      notApplicable: items.filter((item) => item.status === "not-applicable").length,
      errors: items.filter((item) => item.status === "error").length,
      findings: items.flatMap((item) => item.checks).filter((check) => check.status === "finding").length,
      unassessed: items.flatMap((item) => item.checks).filter((check) => check.status === "unassessed").length
    }, items
  });
}

/** Strict policy examines all completed checks, including superseded observations. */
export function androidAccessibilityFindings(evidence: readonly AndroidAccessibilityEvidence[], runId: string): readonly AndroidHierarchyCheck[] {
  return Object.freeze(evidence.flatMap((fact) => fact.kind === "operation-observed" && fact.evidence.runId === runId ? fact.evidence.checks.filter((check) => check.status === "finding") : []));
}

export type AndroidReportResource = Readonly<
  | { kind: "hierarchy"; path: string; xml: string }
  | { kind: "screenshot"; path: string; pngDataUrl: string }
>;

/** Explicit resources produce standalone HTML; omitted resources retain legacy bundle links. */
export function renderAndroidAccessibilityReport(
  report: AndroidAccessibilityReport,
  resources?: readonly AndroidReportResource[]
): string {
  const escape = (value: unknown) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
  const rows = report.items.map((item, index) => {
    const observation = item.observation;
    const artifacts = [
      ...(observation?.hierarchy?.kind === "captured" ? [{ kind: "hierarchy" as const, label: "Hierarchy", artifact: observation.hierarchy.value.artifact }] : []),
      ...(observation?.screenshot?.kind === "captured" ? [{ kind: "screenshot" as const, label: "Screenshot", artifact: observation.screenshot.value }] : [])
    ].map(({ kind, label, artifact }) => {
      const resource = resources?.find((entry) => entry.kind === kind && entry.path === artifact.path);
      if (!resource) {
        if (resources) throw new Error(`Missing embedded native report resource: ${artifact.path}`);
        return { link: /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(artifact.href) ? "" : `<a href="${escape(artifact.href)}">${label}</a>`, section: "" };
      }
      if (resource.kind === "screenshot" && !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(resource.pngDataUrl)) {
        throw new Error(`Invalid embedded native PNG: ${resource.path}`);
      }
      const id = `native-evidence-${index}-${kind}`;
      const content = resource.kind === "hierarchy"
        ? `<pre>${escape(resource.xml)}</pre>`
        : `<img src="${escape(resource.pngDataUrl)}" alt="Native screenshot for ${escape(item.graphNodeId)}">`;
      return {
        link: `<a href="#${id}">${label}</a>`,
        section: `<section class="evidence" id="${id}"><h2>${label}: ${escape(item.profileId)}</h2><p><code>${escape(item.graphNodeId)}</code></p>${content}</section>`
      };
    });
    const links = artifacts.map((artifact) => artifact.link).filter(Boolean).join(" · ");
    const checks = item.checks.filter((check) => check.status !== "passed").map((check) =>
      `<li>${escape(check.rule)} (${escape(check.status)}): ${escape(check.message)}</li>`
    ).join("");
    const functional = item.outcome?.kind === "failed" ? `<br>Functional failure: ${escape(item.outcome.error.message)}` : "";
    return {
      row: `<tr><td>${escape(item.profileId)}<br><code>${escape(item.graphNodeId)}</code></td><td>${escape(item.status)}${functional}</td><td>${escape(item.reason ?? "")} ${links}<ul>${checks}</ul></td></tr>`,
      sections: artifacts.map((artifact) => artifact.section)
    };
  });
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(report.reportId)}</title>
<style>body{font:1rem/1.5 system-ui;max-width:80rem;margin:2rem auto;padding:0 1rem}table{border-collapse:collapse;width:100%}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #ccc;padding:.5rem}code,pre{overflow-wrap:anywhere}a{color:#164e9d}.evidence{margin-top:3rem;border-top:1px solid #ccc}pre{white-space:pre-wrap;max-height:24rem;overflow:auto}img{display:block;max-width:100%;height:auto}</style>
<body><h1>Android accessibility evidence</h1><p>${escape(report.runId)} · ${escape(report.createdAt)}</p><ul>${report.limits.map((limit) => `<li>${escape(limit)}</li>`).join("")}</ul><p>${report.summary.findings} potential findings; ${report.summary.unassessed} unassessed checks.</p>
<table><thead><tr><th scope="col">Profile / model node</th><th scope="col">Status</th><th scope="col">Evidence and checks</th></tr></thead><tbody>${rows.map((row) => row.row).join("")}</tbody></table>${rows.flatMap((row) => row.sections).join("")}</body></html>`;
}
