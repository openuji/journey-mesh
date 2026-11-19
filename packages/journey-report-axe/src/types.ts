import type { Immutable } from "@openuji/journey-core";
import type {
  AxeAuditMetadata, AxeAuditReport, AxeAuditScanId, AxeAuditScanSummaries, AxeAuditSummary, AxeRuleResultType
} from "@openuji/journey-observer-axe/evidence";

export const axePathFormat = "journey-mesh/axe-path";
export const accessibilitySummaryFormat = "journey-mesh/accessibility-summary";

export type AxePathAuditItemStatus = "audited" | "skipped" | "not-applicable";

/** One failing or incomplete node. Identified by its finding (`scanId`, `type`, `ruleId`), the item's `auditId`, and `nodeIndex`. */
export type AxePathAuditFindingNode = {
  nodeIndex: number;
  target: string[];
  failureSummary?: string;
};

export type AxePathAuditFinding = {
  type: AxeRuleResultType;
  scanId: AxeAuditScanId;
  ruleId: string;
  impact?: string;
  help: string;
  helpUrl: string;
  description: string;
  nodes: AxePathAuditFindingNode[];
};

export type AxePathAuditFindings = {
  violations: AxePathAuditFinding[];
  incomplete: AxePathAuditFinding[];
};

/** Hrefs are relative to the run directory. */
export type AxePathAuditItem = Immutable<{
  itemId: string;
  groupId?: string;
  groupLabel?: string;
  status: AxePathAuditItemStatus;
  reason?: string;
  metadata: AxeAuditMetadata;
  auditId?: string;
  createdAt?: string;
  url?: string;
  strict?: boolean;
  wcagTags?: string[];
  /** The raw audit evidence (`format: journey-mesh/axe-audit`). */
  sourceJsonHref?: string;
  sourceScreenshotHref?: string;
  sourceScreenshotError?: string;
  summary?: AxeAuditSummary;
  scanSummaries?: AxeAuditScanSummaries;
  findings?: AxePathAuditFindings;
}>;

export type AxePathAuditSummary = {
  items: number;
  audited: number;
  skipped: number;
  notApplicable: number;
  violations: number;
  incomplete: number;
  passes: number;
  inapplicable: number;
  scanSummaries: AxeAuditScanSummaries;
};

/** Every planned operation of every execution of a test, audited or with the reason it was not. */
export type AxePathAuditReport = Immutable<{
  format: typeof axePathFormat;
  reportId: string;
  createdAt: string;
  wcagTags: string[];
  metadata: AxeAuditMetadata;
  summary: AxePathAuditSummary;
  items: AxePathAuditItem[];
}>;

export type AxeAccessibilitySummaryEntry = {
  id: string;
  itemId: string;
  auditId: string | null;
  status: AxePathAuditItemStatus;
  summary: AxeAuditSummary;
  metrics: {
    pageState: AxeAuditSummary;
    matchedSurface: AxeAuditSummary;
  };
  sourceScreenshotHref?: string;
  reason?: string;
  additionalItems?: AxeAccessibilitySummaryEntry[];
};

export type AxeAccessibilitySummaryProfile = {
  states: Record<string, AxeAccessibilitySummaryEntry>;
  transitions: Record<string, AxeAccessibilitySummaryEntry>;
};

/** Per state and transition counts. `aggregateJsonHref` names the path report next to this document. */
export type AxeAccessibilitySummaryReport = Immutable<{
  format: typeof accessibilitySummaryFormat;
  generatedAt: string;
  source: {
    reportId: string;
    reportMode: string;
    reportCreatedAt: string;
    aggregateJsonHref: string;
    summary: AxePathAuditSummary;
  };
  states?: Record<string, AxeAccessibilitySummaryEntry>;
  transitions?: Record<string, AxeAccessibilitySummaryEntry>;
  profiles?: Record<string, AxeAccessibilitySummaryProfile>;
}>;

export type AxePathSourceFields = {
  sourceJsonHref?: string;
  sourceScreenshotHref?: string;
  sourceScreenshotError?: string;
};

export type AxePathAuditItemInput = Immutable<
  | ({ itemId: string; groupId?: string; groupLabel?: string; metadata?: AxeAuditMetadata; report: AxeAuditReport } & AxePathSourceFields)
  | ({ itemId: string; groupId?: string; groupLabel?: string; metadata?: AxeAuditMetadata; status: "skipped" | "not-applicable"; reason: string } & AxePathSourceFields)
>;
