import type {
  AxeAuditScanId,
  AxeRuleResultType
} from "../types.js";
import { safeFileSegment } from "../shared/strings.js";

export function auditJsonFileName(auditId: string): string {
  return `${auditId}.axe.json`;
}

export function auditHtmlFileName(auditId: string): string {
  return `${auditId}.axe.html`;
}

export function pathAuditJsonFileName(reportId: string): string {
  return `${reportId}.json`;
}

export function pathAuditHtmlFileName(reportId: string): string {
  return `${reportId}.html`;
}

export function accessibilitySummaryJsonFileName(reportId: string): string {
  return `axe-accessibility-${reportId}.json`;
}

export function axeNodeHtmlHref(
  auditId: string,
  scanId: AxeAuditScanId,
  resultType: AxeRuleResultType,
  ruleId: string,
  nodeIndex: number
): string {
  return `${auditHtmlFileName(auditId)}#${axeNodeHtmlId(scanId, resultType, ruleId, nodeIndex)}`;
}

export function axeNodeHtmlId(
  scanId: AxeAuditScanId,
  resultType: AxeRuleResultType,
  ruleId: string,
  nodeIndex: number
): string {
  return `scan-${safeFileSegment(scanId)}-${safeFileSegment(resultType)}-${safeFileSegment(ruleId)}-node-${nodeIndex}`;
}
