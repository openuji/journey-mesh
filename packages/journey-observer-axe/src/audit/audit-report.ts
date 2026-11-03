import type {
  AxeAuditReport,
  AxeAuditRunnerInput,
  AxeAuditScanId,
  AxeAuditScanResults,
  AxeNode,
  AxeNodeEvidence,
  AxeResults,
  AxeRuleResult,
  AxeRuleResultType,
  AxeScanEvidence
} from "../types.js";
import { addAxeSummaries, summarizeResults } from "../reporting/report-summary.js";
import { stringTargets, urlPath } from "../shared/strings.js";
import { immutableSnapshot } from "../shared/immutable.js";

export function buildAxeAuditReport(
  input: Pick<AxeAuditRunnerInput, "auditId" | "metadata"> & { createdAt: string; url: string; strict: boolean },
  tags: readonly string[],
  scans: AxeAuditScanResults
): AxeAuditReport {
  const evidence = {
    pageState: collectScanEvidence(input.url, "page-state", scans.pageState),
    matchedSurface: collectScanEvidence(input.url, "matched-surface", scans.matchedSurface)
  };

  return immutableSnapshot({
    auditId: input.auditId,
    createdAt: input.createdAt,
    url: input.url,
    strict: input.strict,
    wcagTags: [...tags],
    metadata: input.metadata ?? {},
    summary: addAxeSummaries(summarizeResults(scans.pageState), summarizeResults(scans.matchedSurface)),
    scans,
    evidence
  });
}

function collectScanEvidence(
  url: string,
  scanId: AxeAuditScanId,
  results: AxeResults
): AxeScanEvidence {
  return { nodes: [
    ...results.violations.flatMap((result) => result.nodes.map((node, index) => createNodeEvidence(url, scanId, "violation", result, node, index))),
    ...results.incomplete.flatMap((result) => result.nodes.map((node, index) => createNodeEvidence(url, scanId, "incomplete", result, node, index)))
  ] };
}

function createNodeEvidence(
  url: string,
  scanId: AxeAuditScanId,
  resultType: AxeRuleResultType,
  result: AxeRuleResult,
  node: AxeNode,
  nodeIndex: number
): AxeNodeEvidence {
  return {
    resultType,
    violationId: result.id,
    nodeIndex,
    url,
    urlPath: urlPath(url),
    target: stringTargets(node)
  };
}
