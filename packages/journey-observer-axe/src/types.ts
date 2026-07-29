import type { AxeBuilder } from "@axe-core/playwright";
import type { TestInfo } from "@playwright/test";
import type { Locator, Page } from "playwright";

import type {
  PlaywrightExecutionObserver,
  PlaywrightOperationObservation
} from "@openuji/journey-adapter-playwright";
import type {
  JourneyReporter,
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

export type AxeAuditReport = {
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
};

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

export type AxePathAuditItem = {
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
};

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

export type AxePathAuditReport = {
  schemaVersion: "ujg-fed-a11y.axe-path.v1";
  reportId: string;
  createdAt: string;
  metadata: AxeAuditMetadata;
  summary: AxePathAuditSummary;
  items: AxePathAuditItem[];
};

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

export type AxeAccessibilitySummaryReport = {
  schemaVersion: "ujg-fed-a11y.accessibility-summary-by-graph-id.v1";
  generatedAt: string;
  source: {
    testResultDirectoryName?: string;
    reportId: string;
    reportMode: string;
    reportCreatedAt: string;
    delivery?: string;
    aggregateHtmlHref: string;
    summary: AxePathAuditSummary;
  };
  states?: Record<string, AxeAccessibilitySummaryEntry>;
  transitions?: Record<string, AxeAccessibilitySummaryEntry>;
  profiles?: Record<string, AxeAccessibilitySummaryProfile>;
};

export type AxePathAuditItemInput =
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
    };

export type AxeAuditRunnerInput = {
  page: Page;
  testInfo: TestInfo;
  resolvedLocator: Locator;
  auditId: string;
  metadata?: AxeAuditMetadata;
  tags?: readonly string[];
  strict?: boolean;
  evidenceTimeoutMs?: number;
};

export type AxeAuditRunner = (input: AxeAuditRunnerInput) => Promise<AxeAuditReport>;

export type AxeObserverOptions = {
  testInfo: TestInfo;
  reportId: string;
  metadata?: AxeAuditMetadata;
  strict?: boolean;
  tags?: readonly string[];
  evidenceTimeoutMs?: number;
  sourceScreenshots?: {
    states?: boolean;
    fullPage?: boolean;
    timeoutMs?: number;
  };
  accessibilitySummary?: {
    delivery?: string;
    artifactBaseHref?: string;
  };
  auditRunner?: AxeAuditRunner;
};

export type AxeObserver = PlaywrightExecutionObserver & JourneyReporter & {
  readonly latestPathReport?: AxePathAuditReport;
  readonly latestPathReportPath?: string;
  readonly latestAccessibilitySummaryReport?: AxeAccessibilitySummaryReport;
  readonly latestAccessibilitySummaryReportPath?: string;
};

export type AxeJourneyOperation = PlaywrightOperationObservation["operation"];

export type AxeJourneyItem = {
  auditId: string;
  itemId: string;
  groupId: string;
  groupLabel: string;
  metadata: AxeAuditMetadata;
};

export type AxePathSourceScreenshotFields = {
  sourceScreenshotHref?: string;
  sourceScreenshotError?: string;
};
