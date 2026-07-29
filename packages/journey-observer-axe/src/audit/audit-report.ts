import type { Page } from "playwright";

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
import { isAxeStrict } from "./strict-mode.js";

export function buildAxeAuditReport(
  input: AxeAuditRunnerInput,
  tags: string[],
  scans: AxeAuditScanResults
): AxeAuditReport {
  const evidence = {
    pageState: collectScanEvidence(input.page, "page-state", scans.pageState),
    matchedSurface: collectScanEvidence(input.page, "matched-surface", scans.matchedSurface)
  };

  return {
    auditId: input.auditId,
    createdAt: new Date().toISOString(),
    url: input.page.url(),
    strict: input.strict ?? isAxeStrict(),
    wcagTags: [...tags],
    metadata: input.metadata ?? {},
    summary: addAxeSummaries(summarizeResults(scans.pageState), summarizeResults(scans.matchedSurface)),
    scans,
    evidence
  };
}

function collectScanEvidence(
  page: Page,
  scanId: AxeAuditScanId,
  results: AxeResults
): AxeScanEvidence {
  const nodes: AxeNodeEvidence[] = [];
  for (const result of results.violations) {
    for (const [nodeIndex, node] of result.nodes.entries()) {
      nodes.push(createNodeEvidence(page, scanId, "violation", result, node, nodeIndex));
    }
  }
  for (const result of results.incomplete) {
    for (const [nodeIndex, node] of result.nodes.entries()) {
      nodes.push(createNodeEvidence(page, scanId, "incomplete", result, node, nodeIndex));
    }
  }
  return { nodes };
}

function createNodeEvidence(
  page: Page,
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
    url: page.url(),
    urlPath: urlPath(page.url()),
    target: stringTargets(node)
  };
}
