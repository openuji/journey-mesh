import { AxeBuilder } from "@axe-core/playwright";
import type { TestInfo } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import type { Locator, Page } from "playwright";

import type {
  PlaywrightExecutionObserver,
  PlaywrightOperationObservation
} from "@openuji/journey-adapter-playwright";
import type {
  ExecutionResult,
  JourneyOperationSource,
  JourneyPlanSource,
  JourneyReporter,
  JourneySourceReferences,
  JsonObject,
  JsonValue,
  ResolvedAccessibleLocator,
  ResolvedEffect,
  ResolvedObservationBinding,
  RunResult,
  StatePlanOperation,
  TransitionPlanOperation
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

export const wcag22Tags = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22aa"
] as const;

const axeScopeAttribute = "data-axe-audit-scope";
const observerName = "@openuji/journey-observer-axe";

export function axeObserver(options: AxeObserverOptions): AxeObserver {
  const itemInputs = new Map<string, AxePathAuditItemInput>();
  const itemOrder: string[] = [];
  const strictFailureReports: AxeAuditReport[] = [];
  const auditRunner = options.auditRunner ?? runAxeAudit;
  let latestPathReport: AxePathAuditReport | undefined;
  let latestPathReportPath: string | undefined;
  let latestAccessibilitySummaryReport: AxeAccessibilitySummaryReport | undefined;
  let latestAccessibilitySummaryReportPath: string | undefined;

  function setItem(key: string, item: AxePathAuditItemInput): void {
    if (!itemInputs.has(key)) {
      itemOrder.push(key);
    }
    itemInputs.set(key, item);
  }

  function requireJourneyItem(observation: PlaywrightOperationObservation): AxeJourneyItem {
    const journeyItem = createAxeJourneyItem(
      observation.execution.profile.id,
      observation.execution.executionId,
      observation.operation
    );
    const key = itemKey(observation.execution.executionId, observation.operation.id);
    if (!itemInputs.has(key)) {
      setItem(key, initialAxePathItem(journeyItem, observation.operation));
    }
    return journeyItem;
  }

  return {
    name: observerName,
    version: "0.1.0",

    get latestPathReport() {
      return latestPathReport;
    },

    get latestPathReportPath() {
      return latestPathReportPath;
    },

    get latestAccessibilitySummaryReport() {
      return latestAccessibilitySummaryReport;
    },

    get latestAccessibilitySummaryReportPath() {
      return latestAccessibilitySummaryReportPath;
    },

    onExecutionStarted({ execution }) {
      for (const operation of execution.plan.operations) {
        const journeyItem = createAxeJourneyItem(
          execution.profile.id,
          execution.executionId,
          operation
        );
        setItem(
          itemKey(execution.executionId, operation.id),
          initialAxePathItem(journeyItem, operation)
        );
      }
    },

    async observeOperation(observation) {
      const journeyItem = requireJourneyItem(observation);
      const key = itemKey(observation.execution.executionId, observation.operation.id);

      if (observation.stage === "control-flow-recorded") {
        setItem(
          key,
          unauditedAxePathItem(
            journeyItem,
            "not-applicable",
            "Control-flow items do not resolve to a page surface."
          )
        );
        return;
      }

      const screenshots = await captureStateSourceScreenshot(options, observation, journeyItem);
      if (observation.operation.kind === "state" && observation.expectedMatchCount !== 1) {
        setItem(
          key,
          unauditedAxePathItem(
            journeyItem,
            "skipped",
            `Expected match count ${observation.expectedMatchCount} cannot be scoped to one matched locator.`,
            screenshots
          )
        );
        return;
      }

      if (screenshots) {
        setItem(
          key,
          unauditedAxePathItem(
            journeyItem,
            "skipped",
            "State source screenshot captured, but the axe audit did not complete.",
            screenshots
          )
        );
      }

      const report = await auditRunner({
        page: observation.page,
        testInfo: options.testInfo,
        resolvedLocator: observation.locator,
        auditId: journeyItem.auditId,
        metadata: journeyItem.metadata,
        strict: options.strict,
        tags: options.tags,
        evidenceTimeoutMs: options.evidenceTimeoutMs
      });

      if (shouldFailForAxeViolations(report)) {
        strictFailureReports.push(report);
      }

      setItem(key, auditedAxePathItem(journeyItem, report, screenshots));
    },

    async report(result: RunResult) {
      latestPathReport = buildAxePathAuditReport({
        reportId: options.reportId,
        metadata: {
          ...(options.metadata ?? {}),
          runId: result.runId,
          planId: result.plan.id,
          ...(planSourceMetadata(result.plan.source)
            ? { planSource: planSourceMetadata(result.plan.source) }
            : {}),
          executionCount: result.executions.length
        },
        items: itemOrder.map((key) => {
          const item = itemInputs.get(key);
          if (!item) throw new Error(`Missing axe path item ${key}`);
          return item;
        })
      });
      latestPathReportPath = await attachAxePathAuditReport(options.testInfo, latestPathReport);
      latestAccessibilitySummaryReport = buildAxeAccessibilitySummaryReport({
        pathReport: latestPathReport,
        generatedAt: latestPathReport.createdAt,
        delivery: options.accessibilitySummary?.delivery,
        artifactBaseHref: options.accessibilitySummary?.artifactBaseHref,
        testResultDirectoryName: testResultDirectoryName(options.testInfo)
      });
      latestAccessibilitySummaryReportPath = await attachAxeAccessibilitySummaryReport(
        options.testInfo,
        latestAccessibilitySummaryReport
      );

      if (strictFailureReports.length > 0) {
        throw new Error(strictFailureReports.map(axeFailureMessage).join("\n"));
      }
    }
  };
}

export async function runAxeAudit(input: AxeAuditRunnerInput): Promise<AxeAuditReport> {
  const tags = [...(input.tags ?? wcag22Tags)];
  const pageState = await scanPage(input.page, tags);
  const matchedSurface = await withScopedLocator(input.resolvedLocator, input.auditId, (selector) =>
    scanSelector(input.page, selector, tags)
  );
  const report = buildAxeAuditReport(input, tags, {
    pageState,
    matchedSurface
  });

  await attachAxeAuditReport(input.testInfo, report);
  return report;
}

export function shouldFailForAxeViolations(report: AxeAuditReport): boolean {
  return report.strict && report.summary.violations > 0;
}

export function axeFailureMessage(report: AxeAuditReport): string {
  return [
    `Axe found ${report.summary.violations} WCAG violation(s) for ${report.auditId}.`,
    "See the attached JSON and HTML axe reports for details."
  ].join(" ");
}

export function isAxeStrict(): boolean {
  const value = process.env.AXE_STRICT?.toLowerCase();
  return value === "1" || value === "true";
}

export function buildAxePathAuditReport(input: {
  reportId: string;
  createdAt?: string;
  metadata?: AxeAuditMetadata;
  items: AxePathAuditItemInput[];
}): AxePathAuditReport {
  const items = input.items.map(buildAxePathItem);
  return {
    schemaVersion: "ujg-fed-a11y.axe-path.v1",
    reportId: input.reportId,
    createdAt: input.createdAt ?? new Date().toISOString(),
    metadata: input.metadata ?? {},
    summary: summarizePathItems(items),
    items
  };
}

export function buildAxeAccessibilitySummaryReport(input: {
  pathReport: AxePathAuditReport;
  generatedAt?: string;
  delivery?: string;
  artifactBaseHref?: string;
  testResultDirectoryName?: string;
}): AxeAccessibilitySummaryReport {
  const profiles = groupAccessibilityEntriesByProfile(input.pathReport, input.artifactBaseHref);
  const profileIds = Object.keys(profiles);
  const reportMode = profileIds.length > 1 ? "multi-profile" : profileIds[0] ?? "unprofiled";
  const source = {
    ...(input.testResultDirectoryName
      ? { testResultDirectoryName: input.testResultDirectoryName }
      : {}),
    reportId: input.pathReport.reportId,
    reportMode,
    reportCreatedAt: input.pathReport.createdAt,
    ...(input.delivery ? { delivery: input.delivery } : {}),
    aggregateHtmlHref: artifactHref(
      pathAuditHtmlFileName(input.pathReport.reportId),
      input.artifactBaseHref
    ),
    summary: input.pathReport.summary
  };

  if (profileIds.length <= 1) {
    const profile = profiles[profileIds[0] ?? ""] ?? emptyAccessibilitySummaryProfile();
    return {
      schemaVersion: "ujg-fed-a11y.accessibility-summary-by-graph-id.v1",
      generatedAt: input.generatedAt ?? new Date().toISOString(),
      source,
      states: profile.states,
      transitions: profile.transitions
    };
  }

  return {
    schemaVersion: "ujg-fed-a11y.accessibility-summary-by-graph-id.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    source,
    profiles
  };
}

function groupAccessibilityEntriesByProfile(
  report: AxePathAuditReport,
  artifactBaseHref?: string
): Record<string, AxeAccessibilitySummaryProfile> {
  const profiles: Record<string, AxeAccessibilitySummaryProfile> = {};

  for (const item of report.items) {
    const target = accessibilityEntryTarget(item);
    if (!target) continue;

    const profileId = profileIdForItem(item);
    const profile = profiles[profileId] ?? emptyAccessibilitySummaryProfile();
    profiles[profileId] = profile;

    const entry = accessibilitySummaryEntry(item, target.id, report.reportId, artifactBaseHref);
    if (target.kind === "state") {
      addAccessibilitySummaryEntry(profile.states, entry);
    } else {
      addAccessibilitySummaryEntry(profile.transitions, entry);
    }
  }

  return profiles;
}

function emptyAccessibilitySummaryProfile(): AxeAccessibilitySummaryProfile {
  return {
    states: {},
    transitions: {}
  };
}

function accessibilityEntryTarget(
  item: AxePathAuditItem
): { kind: "state" | "transition"; id: string } | undefined {
  const stateId = stringMetadataValue(item.metadata, "stateId");
  if (stateId) return { kind: "state", id: stateId };

  const transitionId = stringMetadataValue(item.metadata, "transitionId");
  if (!transitionId || stringMetadataValue(item.metadata, "kind") === "control-flow") {
    return undefined;
  }
  return { kind: "transition", id: transitionId };
}

function accessibilitySummaryEntry(
  item: AxePathAuditItem,
  id: string,
  reportId: string,
  artifactBaseHref?: string
): AxeAccessibilitySummaryEntry {
  const entry: AxeAccessibilitySummaryEntry = {
    id,
    itemId: item.itemId,
    auditId: item.auditId ?? null,
    status: item.status,
    summary: item.summary ?? emptyAxeSummary(),
    metrics: {
      pageState: item.scanSummaries?.["page-state"] ?? emptyAxeSummary(),
      matchedSurface: item.scanSummaries?.["matched-surface"] ?? emptyAxeSummary()
    },
    sourceHtmlHref: `${artifactHref(pathAuditHtmlFileName(reportId), artifactBaseHref)}#${item.itemId}`
  };

  if (item.sourceScreenshotHref) {
    entry.sourceScreenshotHref = artifactHref(item.sourceScreenshotHref, artifactBaseHref);
  }
  if (item.reason) {
    entry.reason = item.reason;
  }

  return entry;
}

function addAccessibilitySummaryEntry(
  entries: Record<string, AxeAccessibilitySummaryEntry>,
  entry: AxeAccessibilitySummaryEntry
): void {
  const existing = entries[entry.id];
  if (!existing) {
    entries[entry.id] = entry;
    return;
  }

  existing.additionalItems = [...(existing.additionalItems ?? []), entry];
}

function buildAxeAuditReport(
  input: AxeAuditRunnerInput,
  tags: string[],
  scans: { pageState: AxeResults; matchedSurface: AxeResults }
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

function buildAxePathItem(input: AxePathAuditItemInput): AxePathAuditItem {
  if ("report" in input) {
    const report = input.report;
    return {
      itemId: input.itemId,
      groupId: input.groupId,
      groupLabel: input.groupLabel,
      status: "audited",
      metadata: input.metadata ?? report.metadata,
      auditId: report.auditId,
      createdAt: report.createdAt,
      url: report.url,
      strict: report.strict,
      wcagTags: report.wcagTags,
      sourceJsonHref: auditJsonFileName(report.auditId),
      sourceHtmlHref: auditHtmlFileName(report.auditId),
      sourceScreenshotHref: input.sourceScreenshotHref,
      sourceScreenshotError: input.sourceScreenshotError,
      summary: report.summary,
      scanSummaries: buildScanSummaries(report),
      findings: buildPathFindings(report)
    };
  }

  return {
    itemId: input.itemId,
    groupId: input.groupId,
    groupLabel: input.groupLabel,
    status: input.status,
    reason: input.reason,
    metadata: input.metadata ?? {},
    sourceScreenshotHref: input.sourceScreenshotHref,
    sourceScreenshotError: input.sourceScreenshotError
  };
}

function buildScanSummaries(report: AxeAuditReport): AxeAuditScanSummaries {
  return {
    "page-state": summarizeResults(report.scans.pageState),
    "matched-surface": summarizeResults(report.scans.matchedSurface)
  };
}

function buildPathFindings(report: AxeAuditReport): AxePathAuditFindings {
  return {
    violations: [
      ...scanFindings(report, "page-state", "violation", report.scans.pageState),
      ...scanFindings(report, "matched-surface", "violation", report.scans.matchedSurface)
    ],
    incomplete: [
      ...scanFindings(report, "page-state", "incomplete", report.scans.pageState),
      ...scanFindings(report, "matched-surface", "incomplete", report.scans.matchedSurface)
    ]
  };
}

function scanFindings(
  report: AxeAuditReport,
  scanId: AxeAuditScanId,
  resultType: AxeRuleResultType,
  results: AxeResults
): AxePathAuditFinding[] {
  const ruleResults = resultType === "violation" ? results.violations : results.incomplete;
  return ruleResults.map((result) => ({
    type: resultType,
    scanId,
    ruleId: result.id,
    impact: result.impact ?? undefined,
    help: result.help,
    helpUrl: result.helpUrl,
    description: result.description,
    nodes: result.nodes.map((node, nodeIndex) => ({
      nodeIndex,
      target: stringTargets(node),
      failureSummary: node.failureSummary ?? undefined,
      htmlHref: axeNodeHtmlHref(report.auditId, scanId, resultType, result.id, nodeIndex)
    }))
  }));
}

function summarizePathItems(items: AxePathAuditItem[]): AxePathAuditSummary {
  return items.reduce(
    (summary, item) => ({
      items: summary.items + 1,
      audited: summary.audited + (item.status === "audited" ? 1 : 0),
      skipped: summary.skipped + (item.status === "skipped" ? 1 : 0),
      notApplicable: summary.notApplicable + (item.status === "not-applicable" ? 1 : 0),
      violations: summary.violations + (item.summary?.violations ?? 0),
      incomplete: summary.incomplete + (item.summary?.incomplete ?? 0),
      passes: summary.passes + (item.summary?.passes ?? 0),
      inapplicable: summary.inapplicable + (item.summary?.inapplicable ?? 0),
      scanSummaries: addAxeScanSummaries(summary.scanSummaries, item.scanSummaries)
    }),
    {
      items: 0,
      audited: 0,
      skipped: 0,
      notApplicable: 0,
      violations: 0,
      incomplete: 0,
      passes: 0,
      inapplicable: 0,
      scanSummaries: emptyScanSummaries()
    }
  );
}

function summarizeResults(results: AxeResults): AxeAuditSummary {
  return {
    violations: results.violations.length,
    incomplete: results.incomplete.length,
    passes: results.passes.length,
    inapplicable: results.inapplicable.length
  };
}

function addAxeScanSummaries(
  left: AxeAuditScanSummaries,
  right: AxeAuditScanSummaries | undefined
): AxeAuditScanSummaries {
  if (!right) return left;
  return {
    "page-state": addAxeSummaries(left["page-state"], right["page-state"]),
    "matched-surface": addAxeSummaries(left["matched-surface"], right["matched-surface"])
  };
}

function addAxeSummaries(left: AxeAuditSummary, right: AxeAuditSummary): AxeAuditSummary {
  return {
    violations: left.violations + right.violations,
    incomplete: left.incomplete + right.incomplete,
    passes: left.passes + right.passes,
    inapplicable: left.inapplicable + right.inapplicable
  };
}

function emptyScanSummaries(): AxeAuditScanSummaries {
  return {
    "page-state": emptyAxeSummary(),
    "matched-surface": emptyAxeSummary()
  };
}

function emptyAxeSummary(): AxeAuditSummary {
  return {
    violations: 0,
    incomplete: 0,
    passes: 0,
    inapplicable: 0
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

async function scanPage(page: Page, tags: readonly string[]): Promise<AxeResults> {
  return new AxeBuilder({ page }).withTags([...tags]).analyze();
}

async function scanSelector(
  page: Page,
  selector: string,
  tags: readonly string[]
): Promise<AxeResults> {
  return new AxeBuilder({ page }).include(selector).withTags([...tags]).analyze();
}

async function withScopedLocator<T>(
  locator: Locator,
  auditId: string,
  callback: (selector: string) => Promise<T>
): Promise<T> {
  const scopeValue = safeFileSegment(auditId);
  await setLocatorAttribute(locator, axeScopeAttribute, scopeValue);

  try {
    return await callback(`[${axeScopeAttribute}="${scopeValue}"]`);
  } finally {
    await removeLocatorAttribute(locator, axeScopeAttribute);
  }
}

async function setLocatorAttribute(
  locator: Locator,
  attribute: string,
  value: string
): Promise<void> {
  await locator.evaluate(
    (element, [attributeName, attributeValue]) => {
      element.setAttribute(attributeName, attributeValue);
    },
    [attribute, value] as const
  );
}

async function removeLocatorAttribute(locator: Locator, attribute: string): Promise<void> {
  try {
    await locator.evaluate(
      (element, attributeName) => {
        element.removeAttribute(attributeName);
      },
      attribute
    );
  } catch {
    return;
  }
}

async function captureStateSourceScreenshot(
  options: AxeObserverOptions,
  observation: PlaywrightOperationObservation,
  journeyItem: AxeJourneyItem
): Promise<AxePathSourceScreenshotFields | undefined> {
  if (observation.stage !== "state-asserted" || !options.sourceScreenshots?.states) {
    return undefined;
  }

  const href = `${safeFileSegment(journeyItem.auditId)}.source.playwright-screenshot.png`;
  const path = options.testInfo.outputPath(href);

  try {
    await observation.page.screenshot({
      path,
      fullPage: options.sourceScreenshots.fullPage ?? true,
      timeout: options.sourceScreenshots.timeoutMs
    });
    await options.testInfo.attach(
      `playwright-${safeFileSegment(journeyItem.auditId)}-source.png`,
      { path, contentType: "image/png" }
    );
    return { sourceScreenshotHref: href };
  } catch (error) {
    return { sourceScreenshotError: errorMessage(error) };
  }
}

async function attachAxeAuditReport(
  testInfo: TestInfo,
  report: AxeAuditReport
): Promise<void> {
  const jsonPath = testInfo.outputPath(auditJsonFileName(report.auditId));
  const htmlPath = testInfo.outputPath(auditHtmlFileName(report.auditId));

  await writeFile(jsonPath, JSON.stringify(report, null, 2));
  await writeFile(htmlPath, renderAxeAuditHtml(report));

  await testInfo.attach(`axe-${report.auditId}.json`, {
    path: jsonPath,
    contentType: "application/json"
  });
  await testInfo.attach(`axe-${report.auditId}.html`, {
    path: htmlPath,
    contentType: "text/html"
  });
}

async function attachAxePathAuditReport(
  testInfo: TestInfo,
  report: AxePathAuditReport
): Promise<string> {
  const jsonPath = testInfo.outputPath(pathAuditJsonFileName(report.reportId));
  const htmlPath = testInfo.outputPath(pathAuditHtmlFileName(report.reportId));
  const attachmentHtmlPath = testInfo.outputPath(
    "axe-path-attachments",
    pathAuditHtmlFileName(report.reportId)
  );

  await writeFile(jsonPath, JSON.stringify(report, null, 2));
  await writeFile(htmlPath, renderAxePathAuditHtml(report));
  await mkdir(dirname(attachmentHtmlPath), { recursive: true });
  await writeFile(attachmentHtmlPath, renderAxePathAuditHtml(report, { baseHref: "../" }));

  await testInfo.attach(`axe-path-${report.reportId}.json`, {
    path: jsonPath,
    contentType: "application/json"
  });
  await testInfo.attach(`axe-path-${report.reportId}.html`, {
    path: attachmentHtmlPath,
    contentType: "text/html"
  });

  return htmlPath;
}

async function attachAxeAccessibilitySummaryReport(
  testInfo: TestInfo,
  report: AxeAccessibilitySummaryReport
): Promise<string> {
  const jsonPath = testInfo.outputPath(accessibilitySummaryJsonFileName(report.source.reportId));

  await writeFile(jsonPath, JSON.stringify(report, null, 2));
  await testInfo.attach(`axe-accessibility-${report.source.reportId}.json`, {
    path: jsonPath,
    contentType: "application/json"
  });

  return jsonPath;
}

type AxeJourneyItem = {
  auditId: string;
  itemId: string;
  groupId: string;
  groupLabel: string;
  metadata: AxeAuditMetadata;
};

type AxePathSourceScreenshotFields = {
  sourceScreenshotHref?: string;
  sourceScreenshotError?: string;
};

function createAxeJourneyItem(
  profileId: string,
  executionId: string,
  operation: PlaywrightOperationObservation["operation"]
): AxeJourneyItem {
  const graphNodeId = graphNodeIdForOperation(operation);
  const itemId = `${profileId}-${String(operation.sequence).padStart(3, "0")}-${graphNodeSlug(graphNodeId)}`;

  return {
    auditId: itemId,
    itemId,
    groupId: `${profileId}:${operation.entry.id}`,
    groupLabel: `${profileId} ${operation.entry.label ?? operation.entry.id}`,
    metadata: metadataForOperation(profileId, executionId, graphNodeId, operation)
  };
}

function initialAxePathItem(
  journeyItem: AxeJourneyItem,
  operation: PlaywrightOperationObservation["operation"]
): AxePathAuditItemInput {
  if (operation.kind === "control-flow") {
    return unauditedAxePathItem(
      journeyItem,
      "not-applicable",
      "Control-flow items do not resolve to a page surface."
    );
  }

  if (operation.kind === "state" && operation.target.expectedMatchCount !== 1) {
    return unauditedAxePathItem(
      journeyItem,
      "skipped",
      `Expected match count ${operation.target.expectedMatchCount} cannot be scoped to one matched locator.`
    );
  }

  return unauditedAxePathItem(
    journeyItem,
    "skipped",
    "Plan item was not audited because the runner ended before this item could be scanned."
  );
}

function auditedAxePathItem(
  journeyItem: AxeJourneyItem,
  report: AxeAuditReport,
  screenshots?: AxePathSourceScreenshotFields
): AxePathAuditItemInput {
  return {
    itemId: journeyItem.itemId,
    groupId: journeyItem.groupId,
    groupLabel: journeyItem.groupLabel,
    metadata: journeyItem.metadata,
    report,
    ...screenshots
  };
}

function unauditedAxePathItem(
  journeyItem: AxeJourneyItem,
  status: "skipped" | "not-applicable",
  reason: string,
  screenshots?: AxePathSourceScreenshotFields
): AxePathAuditItemInput {
  return {
    itemId: journeyItem.itemId,
    groupId: journeyItem.groupId,
    groupLabel: journeyItem.groupLabel,
    metadata: journeyItem.metadata,
    status,
    reason,
    ...screenshots
  };
}

function metadataForOperation(
  profileId: string,
  executionId: string,
  graphNodeId: string,
  operation: PlaywrightOperationObservation["operation"]
): AxeAuditMetadata {
  const metadata: AxeAuditMetadata = {
    profileId,
    executionId,
    operationId: operation.id,
    sequence: operation.sequence,
    kind: operation.kind,
    graphNodeId,
    actorId: operation.actorId,
    touchpointId: operation.touchpointId,
    entryId: operation.entry.id
  };

  addOptional(metadata, "source", operationSourceMetadata(operation.source));
  addOptional(metadata, "entryBindingId", operation.entryBinding?.id);
  addOptional(metadata, "entryBindingValue", operation.entryBinding?.value);

  if (operation.kind === "state") {
    metadata.stateId = operation.state.id;
    metadata.surfaceId = operation.surface.id;
    metadata.expectedMatchCount = operation.target.expectedMatchCount;
    metadata.bindingIds = operation.target.bindings.map((binding) => binding.id);
    metadata.locatorIds = locatorIds(operation.target.bindings);
    metadata.bindings = operation.target.bindings.map(bindingMetadata);
    addOptional(metadata, "stateLabel", operation.state.label);
    addOptional(metadata, "surfaceLabel", operation.surface.label);
    addUniqueEventMetadata(metadata, operation.target.bindings.map((binding) => binding.eventId));
    return metadata;
  }

  if (operation.kind === "transition") {
    metadata.transitionId = operation.transition.id;
    metadata.fromStateId = operation.transition.from;
    metadata.toStateId = operation.transition.to;
    metadata.surfaceId = operation.surface.id;
    metadata.eventId = operation.activation.eventId;
    metadata.bindingIds = operation.activation.bindings.map((binding) => binding.id);
    metadata.locatorIds = locatorIds(operation.activation.bindings);
    metadata.bindings = operation.activation.bindings.map(bindingMetadata);
    metadata.effects = operation.effects.map(effectMetadata);
    metadata.effectIds = operation.effects.map((effect) => effect.id);
    metadata.artifactIds = unique(
      operation.effects.flatMap((effect) => [...effect.producedRefs, ...effect.consumedRefs])
    );
    addOptional(metadata, "transitionLabel", operation.transition.label);
    addOptional(metadata, "surfaceLabel", operation.surface.label);
    addOptional(metadata, "eventLabel", operation.activation.eventLabel);
    addOptional(metadata, "effectRef", operation.transition.effectRef);
    return metadata;
  }

  metadata.transitionId = operation.transition.id;
  addOptional(metadata, "transitionLabel", operation.transition.label);
  addOptional(metadata, "fromExitRef", operation.transition.fromExitRef);
  addOptional(metadata, "toEntryRef", operation.transition.toEntryRef);
  return metadata;
}

function planSourceMetadata(source: JourneyPlanSource | undefined): JsonObject | undefined {
  if (!source) return undefined;

  const metadata: JsonObject = {
    model: source.model
  };
  addOptional(metadata, "documentId", source.documentId);
  addOptional(metadata, "references", sourceReferencesMetadata(source.references));
  return metadata;
}

function operationSourceMetadata(source: JourneyOperationSource | undefined): JsonObject | undefined {
  if (!source) return undefined;

  const metadata: JsonObject = {};
  addOptional(metadata, "references", sourceReferencesMetadata(source.references));
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function sourceReferencesMetadata(references: JourneySourceReferences | undefined): JsonObject | undefined {
  if (!references) return undefined;

  const metadata: JsonObject = {};
  for (const [key, value] of Object.entries(references)) {
    metadata[key] = typeof value === "string" ? value : [...value];
  }
  return metadata;
}

function bindingMetadata(binding: ResolvedObservationBinding): JsonObject {
  const metadata: JsonObject = {
    bindingId: binding.id,
    surfaceId: binding.surfaceId,
    eventId: binding.eventId,
    locatorIds: binding.locators.flatMap((locator) => collectLocatorIds(locator)),
    locators: binding.locators.map(locatorMetadata)
  };

  addOptional(metadata, "label", binding.label);
  addOptional(metadata, "eventLabel", binding.eventLabel);
  if (binding.expectedMatchCount !== undefined) {
    metadata.expectedMatchCount = binding.expectedMatchCount;
  }
  if (binding.surfaceInstanceResolver) {
    metadata.surfaceInstanceResolver = {
      resolverId: binding.surfaceInstanceResolver.id,
      feature: featureMetadata(binding.surfaceInstanceResolver.instanceKeyFeature)
    };
  }

  return metadata;
}

function locatorMetadata(locator: ResolvedAccessibleLocator): JsonObject {
  const metadata: JsonObject = {
    locatorId: locator.id,
    features: locator.features.map(featureMetadata),
    contexts: locator.contexts.map(locatorMetadata)
  };

  addOptional(metadata, "label", locator.label);
  addOptional(metadata, "role", locator.role);
  addOptional(metadata, "accessibleName", locator.accessibleName);
  addOptional(metadata, "accessibleDescription", locator.accessibleDescription);
  return metadata;
}

function featureMetadata(feature: { id: string; name: string; value: string; label?: string }): JsonObject {
  const metadata: JsonObject = {
    featureId: feature.id,
    name: feature.name,
    value: feature.value
  };
  addOptional(metadata, "label", feature.label);
  return metadata;
}

function effectMetadata(effect: ResolvedEffect): JsonObject {
  return {
    effectId: effect.id,
    producedRefs: [...effect.producedRefs],
    consumedRefs: [...effect.consumedRefs],
    produced: effect.produced.map(artifactMetadata),
    consumed: effect.consumed.map(artifactMetadata)
  };
}

function artifactMetadata(artifact: ResolvedEffect["produced"][number]): JsonObject {
  const metadata: JsonObject = {
    artifactId: artifact.id,
    targetTouchpointRefs: [...artifact.targetTouchpointRefs]
  };
  addOptional(metadata, "label", artifact.label);
  addOptional(metadata, "nameRef", artifact.nameRef);
  addOptional(metadata, "name", artifact.name);
  addOptional(metadata, "sourceTouchpointRef", artifact.sourceTouchpointRef);
  return metadata;
}

function addUniqueEventMetadata(metadata: JsonObject, eventIds: string[]): void {
  const uniqueEventIds = unique(eventIds);
  metadata.eventIds = uniqueEventIds;
  if (uniqueEventIds.length === 1) {
    metadata.eventId = uniqueEventIds[0];
  }
}

function locatorIds(bindings: ResolvedObservationBinding[]): string[] {
  return unique(bindings.flatMap((binding) => binding.locators.flatMap((locator) => collectLocatorIds(locator))));
}

function collectLocatorIds(locator: ResolvedAccessibleLocator): string[] {
  return [locator.id, ...locator.contexts.flatMap((context) => collectLocatorIds(context))];
}

function graphNodeIdForOperation(operation: PlaywrightOperationObservation["operation"]): string {
  if (operation.kind === "state") return operation.state.id;
  return operation.transition.id;
}

function graphNodeSlug(graphNodeId: string): string {
  return safeFileSegment(graphNodeId.split(":").at(-1) ?? graphNodeId);
}

function itemKey(executionId: string, operationId: string): string {
  return `${executionId}\u0000${operationId}`;
}

function auditJsonFileName(auditId: string): string {
  return `${auditId}.axe.json`;
}

function auditHtmlFileName(auditId: string): string {
  return `${auditId}.axe.html`;
}

function pathAuditJsonFileName(reportId: string): string {
  return `${reportId}.json`;
}

function pathAuditHtmlFileName(reportId: string): string {
  return `${reportId}.html`;
}

function accessibilitySummaryJsonFileName(reportId: string): string {
  return `axe-accessibility-${reportId}.json`;
}

function axeNodeHtmlHref(
  auditId: string,
  scanId: AxeAuditScanId,
  resultType: AxeRuleResultType,
  ruleId: string,
  nodeIndex: number
): string {
  return `${auditHtmlFileName(auditId)}#${axeNodeHtmlId(scanId, resultType, ruleId, nodeIndex)}`;
}

function axeNodeHtmlId(
  scanId: AxeAuditScanId,
  resultType: AxeRuleResultType,
  ruleId: string,
  nodeIndex: number
): string {
  return `scan-${safeFileSegment(scanId)}-${safeFileSegment(resultType)}-${safeFileSegment(ruleId)}-node-${nodeIndex}`;
}

function renderAxeAuditHtml(report: AxeAuditReport): string {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    `<title>${escapeHtml(report.auditId)} axe report</title>`,
    reportStyles(),
    "</head>",
    "<body>",
    "<main>",
    `<h1>${escapeHtml(report.auditId)} axe report</h1>`,
    metadataTable([
      ["Created", report.createdAt],
      ["URL", report.url],
      ["Strict mode", String(report.strict)],
      ["WCAG tags", report.wcagTags.join(", ")],
      ["Metadata", JSON.stringify(report.metadata, null, 2)]
    ]),
    summaryTable(report.summary),
    renderAuditScan("page-state", "Page State", report.scans.pageState),
    renderAuditScan("matched-surface", "Matched Surface", report.scans.matchedSurface),
    "</main>",
    "</body>",
    "</html>"
  ].join("\n");
}

function renderAuditScan(
  scanId: AxeAuditScanId,
  label: string,
  results: AxeResults
): string {
  return [
    `<section id="scan-${escapeAttribute(scanId)}">`,
    `<h2>${escapeHtml(label)}</h2>`,
    summaryTable(summarizeResults(results)),
    "<h3>Violations</h3>",
    renderRuleResults(scanId, "violation", results.violations),
    "<h3>Incomplete</h3>",
    renderRuleResults(scanId, "incomplete", results.incomplete),
    "</section>"
  ].join("\n");
}

function renderRuleResults(
  scanId: AxeAuditScanId,
  resultType: AxeRuleResultType,
  results: AxeRuleResult[]
): string {
  if (results.length === 0) return "<p>None.</p>";
  return results.map((result) => [
    '<article class="finding">',
    `<h4>${escapeHtml(result.id)}: ${escapeHtml(result.help)}</h4>`,
    `<p><strong>Impact:</strong> ${escapeHtml(result.impact ?? "unknown")}</p>`,
    `<p><a href="${escapeAttribute(result.helpUrl)}">${escapeHtml(result.helpUrl)}</a></p>`,
    `<p>${escapeHtml(result.description)}</p>`,
    result.nodes.map((node, nodeIndex) => renderAxeNode(scanId, resultType, result.id, node, nodeIndex)).join("\n"),
    "</article>"
  ].join("\n")).join("\n");
}

function renderAxeNode(
  scanId: AxeAuditScanId,
  resultType: AxeRuleResultType,
  ruleId: string,
  node: AxeNode,
  nodeIndex: number
): string {
  return [
    `<details id="${escapeAttribute(axeNodeHtmlId(scanId, resultType, ruleId, nodeIndex))}">`,
    `<summary>${escapeHtml(stringTargets(node).join(", "))}</summary>`,
    "<h5>HTML</h5>",
    `<pre>${escapeHtml(node.html)}</pre>`,
    "<h5>Failure Summary</h5>",
    `<pre>${escapeHtml(node.failureSummary ?? "")}</pre>`,
    "</details>"
  ].join("\n");
}

function renderAxePathAuditHtml(
  report: AxePathAuditReport,
  options: { baseHref?: string } = {}
): string {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    options.baseHref ? `<base href="${escapeAttribute(options.baseHref)}">` : "",
    `<title>${escapeHtml(report.reportId)} axe path report</title>`,
    reportStyles(),
    "</head>",
    "<body>",
    "<main>",
    `<h1>${escapeHtml(report.reportId)} axe path report</h1>`,
    metadataTable([
      ["Created", report.createdAt],
      ["Schema version", report.schemaVersion],
      ["Metadata", JSON.stringify(report.metadata, null, 2)]
    ]),
    renderPathSummary(report.summary),
    renderPathItemsByProfile(report.items),
    "</main>",
    "</body>",
    "</html>"
  ].join("\n");
}

function renderPathSummary(summary: AxePathAuditSummary): string {
  return [
    "<section>",
    "<h2>Summary</h2>",
    metadataTable([
      ["Items", String(summary.items)],
      ["Audited", String(summary.audited)],
      ["Skipped", String(summary.skipped)],
      ["Not applicable", String(summary.notApplicable)],
      ["Violations", String(summary.violations)],
      ["Incomplete", String(summary.incomplete)],
      ["Passes", String(summary.passes)],
      ["Inapplicable", String(summary.inapplicable)]
    ]),
    "</section>"
  ].join("\n");
}

function renderPathItem(item: AxePathAuditItem): string {
  const pageSummary = item.scanSummaries?.["page-state"] ?? emptyAxeSummary();
  const surfaceSummary = item.scanSummaries?.["matched-surface"] ?? emptyAxeSummary();
  const links = [
    item.sourceJsonHref ? `<a href="${escapeAttribute(item.sourceJsonHref)}">JSON</a>` : "",
    item.sourceHtmlHref ? `<a href="${escapeAttribute(item.sourceHtmlHref)}">HTML</a>` : ""
  ].filter(Boolean).join(" ");

  return [
    `<details class="item ${escapeAttribute(item.status)}" id="${escapeAttribute(item.itemId)}">`,
    `<summary><strong>${escapeHtml(item.auditId ?? item.itemId)}</strong> ${escapeHtml(item.status)} total V:${item.summary?.violations ?? 0} I:${item.summary?.incomplete ?? 0} page V:${pageSummary.violations} locator V:${surfaceSummary.violations}</summary>`,
    metadataTable([
      ["Status", item.status],
      ["Reason", item.reason ?? ""],
      ["URL", item.url ?? ""],
      ["Strict", item.strict === undefined ? "" : String(item.strict)],
      ["Reports", links],
      ["Metadata", JSON.stringify(item.metadata, null, 2)]
    ]),
    renderSourceScreenshot(item),
    renderPathFindings(item),
    "</details>"
  ].join("\n");
}

function renderPathItemsByProfile(items: AxePathAuditItem[]): string {
  const profiles = groupPathItemsByProfile(items);
  return [
    "<section>",
    "<h2>Path Items</h2>",
    ...profiles.map(({ profileId, profileItems }) => [
      `<section class="profile-group" id="profile-${escapeAttribute(safeFileSegment(profileId))}">`,
      `<h3>${escapeHtml(profileId)}</h3>`,
      renderPathSummary(summarizePathItems(profileItems)),
      profileItems.map(renderPathItem).join("\n"),
      "</section>"
    ].join("\n")),
    "</section>"
  ].join("\n");
}

function groupPathItemsByProfile(
  items: AxePathAuditItem[]
): Array<{ profileId: string; profileItems: AxePathAuditItem[] }> {
  const groups = new Map<string, AxePathAuditItem[]>();
  for (const item of items) {
    const profileId = profileIdForItem(item);
    const profileItems = groups.get(profileId) ?? [];
    profileItems.push(item);
    groups.set(profileId, profileItems);
  }

  return [...groups.entries()].map(([profileId, profileItems]) => ({ profileId, profileItems }));
}

function renderSourceScreenshot(item: AxePathAuditItem): string {
  if (!item.sourceScreenshotHref && !item.sourceScreenshotError) return "";
  return [
    "<section>",
    "<h4>Source Screenshot</h4>",
    item.sourceScreenshotHref
      ? `<p><a href="${escapeAttribute(item.sourceScreenshotHref)}">${escapeHtml(item.sourceScreenshotHref)}</a></p><img src="${escapeAttribute(item.sourceScreenshotHref)}" alt="Source screenshot">`
      : "",
    item.sourceScreenshotError ? `<p>${escapeHtml(item.sourceScreenshotError)}</p>` : "",
    "</section>"
  ].join("\n");
}

function renderPathFindings(item: AxePathAuditItem): string {
  if (!item.findings) return "";
  return [...item.findings.violations, ...item.findings.incomplete].map((finding) => [
    '<article class="finding">',
    `<h4>${escapeHtml(finding.scanId)} ${escapeHtml(finding.type)}: ${escapeHtml(finding.ruleId)}</h4>`,
    `<p>${escapeHtml(finding.help)}</p>`,
    finding.nodes.map((node) =>
      `<p><a href="${escapeAttribute(node.htmlHref)}">${escapeHtml(node.target.join(", "))}</a></p>`
    ).join("\n"),
    "</article>"
  ].join("\n")).join("\n");
}

function metadataTable(rows: Array<[string, string]>): string {
  return [
    "<table>",
    ...rows.map(([label, value]) =>
      `<tr><th>${escapeHtml(label)}</th><td>${value.includes("<a ") ? value : escapeHtml(value)}</td></tr>`
    ),
    "</table>"
  ].join("\n");
}

function summaryTable(summary: AxeAuditSummary): string {
  return metadataTable([
    ["Violations", String(summary.violations)],
    ["Incomplete", String(summary.incomplete)],
    ["Passes", String(summary.passes)],
    ["Inapplicable", String(summary.inapplicable)]
  ]);
}

function reportStyles(): string {
  return [
    "<style>",
    "body{font-family:system-ui,sans-serif;margin:2rem;line-height:1.45;color:#17202a}",
    "main{max-width:1200px}",
    "section{margin-block:2rem}",
    "table{border-collapse:collapse;width:100%;margin-block:1rem}",
    "th,td{border:1px solid #d8dee4;padding:.5rem;text-align:left;vertical-align:top}",
    "th{background:#f6f8fa}",
    "pre{background:#f6f8fa;border-radius:4px;padding:.75rem;overflow:auto}",
    "img{display:block;max-width:min(100%,960px);height:auto;border:1px solid #d8dee4}",
    ".item{border:1px solid #d8dee4;border-radius:6px;padding:.75rem 1rem;margin-block:1rem}",
    ".item.skipped{border-color:#bf8700;background:#fff8c5}",
    ".item.not-applicable{background:#f6f8fa}",
    ".finding{border-left:4px solid #cf222e;padding-left:.75rem;margin-block:1rem}",
    "</style>"
  ].join("\n");
}

function stringTargets(node: AxeNode): string[] {
  return node.target.map((target) => Array.isArray(target) ? target.join(" ") : String(target));
}

function urlPath(value: string): string {
  try {
    const url = new URL(value);
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return value;
  }
}

function profileIdForItem(item: AxePathAuditItem): string {
  return stringMetadataValue(item.metadata, "profileId") ?? item.groupId?.split(":")[0] ?? "unprofiled";
}

function stringMetadataValue(metadata: AxeAuditMetadata, key: string): string | undefined {
  const value = metadata[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function artifactHref(href: string, artifactBaseHref: string | undefined): string {
  if (!artifactBaseHref) return href;
  const base = artifactBaseHref.endsWith("/") ? artifactBaseHref : `${artifactBaseHref}/`;
  return `${base}${href.replace(/^\/+/, "")}`;
}

function testResultDirectoryName(testInfo: TestInfo): string | undefined {
  return testInfo.outputDir ? basename(testInfo.outputDir) : undefined;
}

function addOptional(metadata: JsonObject, key: string, value: JsonValue | undefined): void {
  if (value !== undefined) {
    metadata[key] = value;
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function safeFileSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/'/g, "&#39;");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
