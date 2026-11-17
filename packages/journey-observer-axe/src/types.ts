import type { AxeBuilder } from "@axe-core/playwright";
import type { JourneyArtifactStore } from "@openuji/journey-plugin";
import type { Locator, Page } from "playwright";
import type { Immutable } from "@openuji/journey-core";
import type { AxeEvidence } from "./observer/evidence.js";

import type {
  PlaywrightExecutionObserver,
  PlaywrightOperationObservation
} from "@openuji/journey-adapter-playwright";
import type {
  RunResult,
  JsonObject
} from "@openuji/journey-runner";

export type AxeResults = Awaited<ReturnType<AxeBuilder["analyze"]>>;
export type AxeRuleResult = AxeResults["violations"][number];
export type AxeNode = AxeRuleResult["nodes"][number];

export type AxeAuditMetadata = JsonObject;
export type AxeAuditScanId = "page-state" | "matched-surface";
export type AxeRuleResultType = "violation" | "incomplete";
export type AxePathAuditItemStatus = "audited" | "skipped" | "not-applicable";

export type AxeAuditSummary = {
  violations: number;
  incomplete: number;
  passes: number;
  inapplicable: number;
};

export type AxeAuditScanSummaries = {
  [scanId in AxeAuditScanId]: AxeAuditSummary;
};

export type AxeNodeEvidence = {
  resultType: AxeRuleResultType;
  violationId: string;
  nodeIndex: number;
  url: string;
  urlPath: string;
  target: string[];
};

export type AxeScanEvidence = {
  nodes: AxeNodeEvidence[];
};

export type AxeAuditScanResults = {
  pageState: AxeResults;
  matchedSurface: AxeResults;
};

export type AxeAuditReport = Immutable<{
  auditId: string;
  createdAt: string;
  url: string;
  strict: boolean;
  wcagTags: string[];
  metadata: AxeAuditMetadata;
  summary: AxeAuditSummary;
  scans: {
    pageState: AxeResults;
    matchedSurface: AxeResults;
  };
  evidence: {
    pageState: AxeScanEvidence;
    matchedSurface: AxeScanEvidence;
  };
}>;

export type AxePathAuditFindingNode = {
  nodeIndex: number;
  target: string[];
  failureSummary?: string;
  htmlHref: string;
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
  sourceJsonHref?: string;
  sourceHtmlHref?: string;
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

export type AxePathAuditReport = Immutable<{
  format: "journey-mesh/axe-path";
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
  sourceHtmlHref: string;
  sourceScreenshotHref?: string;
  reason?: string;
  additionalItems?: AxeAccessibilitySummaryEntry[];
};

export type AxeAccessibilitySummaryProfile = {
  states: Record<string, AxeAccessibilitySummaryEntry>;
  transitions: Record<string, AxeAccessibilitySummaryEntry>;
};

export type AxeAccessibilitySummaryReport = Immutable<{
  format: "journey-mesh/accessibility-summary";
  generatedAt: string;
  source: {
    reportId: string;
    reportMode: string;
    reportCreatedAt: string;
    aggregateHtmlHref: string;
    summary: AxePathAuditSummary;
  };
  states?: Record<string, AxeAccessibilitySummaryEntry>;
  transitions?: Record<string, AxeAccessibilitySummaryEntry>;
  profiles?: Record<string, AxeAccessibilitySummaryProfile>;
}>;

export type AxePathAuditItemInput = Immutable<
  | {
      itemId: string;
      groupId?: string;
      groupLabel?: string;
      metadata?: AxeAuditMetadata;
      report: AxeAuditReport;
      sourceScreenshotHref?: string;
      sourceScreenshotError?: string;
    }
  | {
      itemId: string;
      groupId?: string;
      groupLabel?: string;
      metadata?: AxeAuditMetadata;
      status: "skipped" | "not-applicable";
      reason: string;
      sourceScreenshotHref?: string;
      sourceScreenshotError?: string;
    }>;

export type AxeAuditRunnerInput = {
  page: Page;
  resolvedLocator: Locator;
  auditId: string;
  metadata?: Immutable<AxeAuditMetadata>;
  tags?: readonly string[];
  strict?: boolean;
  evidenceTimeoutMs?: number;
};

export type AxeAuditRunner = (input: AxeAuditRunnerInput) => Promise<AxeAuditReport>;

export type AxeObserverOptions = {
  artifacts: JourneyArtifactStore;
  reportId: string;
  metadata?: Immutable<AxeAuditMetadata>;
  strict?: boolean;
  /** Operations in these modeled phases journal not-applicable evidence without runtime capture. */
  excludedPhaseIds?: readonly string[];
  tags?: readonly string[];
  evidenceTimeoutMs?: number;
  sourceScreenshots?: {
    states?: boolean;
    fullPage?: boolean;
    timeoutMs?: number;
  };
  auditRunner?: AxeAuditRunner;
  /** Clock for report timestamps; injectable for deterministic output. */
  now?: () => string;
};

export type AxeObserver = PlaywrightExecutionObserver & {
  readonly evidence: readonly AxeEvidence[];
  output(result: RunResult): import("@openuji/journey-core").JourneyObserverOutput;
};

export type AxeJourneyOperation = Immutable<PlaywrightOperationObservation["operation"]>;

export type AxeJourneyItem = Immutable<{
  auditId: string;
  itemId: string;
  groupId: string;
  groupLabel: string;
  metadata: AxeAuditMetadata;
}>;

export type AxePathSourceScreenshotFields = {
  sourceScreenshotHref?: string;
  sourceScreenshotError?: string;
};
