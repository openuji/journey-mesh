import type { PlaywrightOperationObservation } from "@openuji/journey-adapter-playwright";

import { observerName, wcag22Tags } from "../constants.js";
import type {
  AxeAuditReport,
  AxeObserver,
  AxeObserverOptions,
  AxePathAuditItemStatus,
  AxePathAuditReport,
  AxeAccessibilitySummaryReport
} from "../types.js";
import {
  attachAxeAccessibilitySummaryReport,
  attachAxePathAuditReport,
  testResultDirectoryName
} from "../artifacts/report-attachments.js";
import {
  axeFailureMessage,
  shouldFailForAxeViolations
} from "../audit/strict-mode.js";
import { runAxeAudit } from "../audit/run-axe-audit.js";
import {
  auditedAxePathItem,
  itemKey,
  unauditedAxePathItem
} from "../journey/journey-item.js";
import { planSourceMetadata } from "../journey/operation-metadata.js";
import { buildAxeAccessibilitySummaryReport } from "../reporting/accessibility-summary-report.js";
import { buildAxePathAuditReport } from "../reporting/path-audit-report.js";
import { AxeObservationStore } from "./observation-store.js";
import { captureStateSourceScreenshot } from "./source-screenshot.js";

type PageSurfaceObservation = Exclude<
  PlaywrightOperationObservation,
  { readonly stage: "control-flow-recorded" }
>;

type UnauditedObservationDecision = {
  status: Extract<AxePathAuditItemStatus, "skipped" | "not-applicable">;
  reason: string;
};

export function axeObserver(options: AxeObserverOptions): AxeObserver {
  const store = new AxeObservationStore();
  const strictFailureReports: AxeAuditReport[] = [];
  const auditRunner = options.auditRunner ?? runAxeAudit;
  let latestPathReport: AxePathAuditReport | undefined;
  let latestPathReportPath: string | undefined;
  let latestAccessibilitySummaryReport: AxeAccessibilitySummaryReport | undefined;
  let latestAccessibilitySummaryReportPath: string | undefined;

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
      store.seedExecution(execution);
    },

    async observeOperation(observation) {
      const journeyItem = store.requireJourneyItem(observation);
      const key = itemKey(observation.execution.executionId, observation.operation.id);

      if (observation.stage === "control-flow-recorded") {
        const decision = controlFlowDecision();
        store.setItem(
          key,
          unauditedAxePathItem(journeyItem, decision.status, decision.reason)
        );
        return;
      }

      const screenshots = await captureStateSourceScreenshot(options, observation, journeyItem);
      const surfaceDecision = resolveSurfaceAuditDecision(observation);
      if (surfaceDecision) {
        store.setItem(
          key,
          unauditedAxePathItem(
            journeyItem,
            surfaceDecision.status,
            surfaceDecision.reason,
            screenshots
          )
        );
        return;
      }

      if (screenshots) {
        store.setItem(
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

      store.setItem(key, auditedAxePathItem(journeyItem, report, screenshots));
    },

    async report({ result }) {
      const sourceMetadata = planSourceMetadata(result.plan.source);
      latestPathReport = buildAxePathAuditReport({
        reportId: options.reportId,
        wcagTags: options.tags ?? wcag22Tags,
        metadata: {
          ...(options.metadata ?? {}),
          runId: result.runId,
          planId: result.plan.id,
          ...(sourceMetadata ? { planSource: sourceMetadata } : {}),
          executionCount: result.executions.length
        },
        items: store.orderedItems()
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

function controlFlowDecision(): UnauditedObservationDecision {
  return {
    status: "not-applicable",
    reason: "Control-flow items do not resolve to a page surface."
  };
}

function resolveSurfaceAuditDecision(
  observation: PageSurfaceObservation
): UnauditedObservationDecision | undefined {
  if (observation.operation.kind === "state" && observation.expectedMatchCount !== 1) {
    return {
      status: "skipped",
      reason: `Expected match count ${observation.expectedMatchCount} cannot be scoped to one matched locator.`
    };
  }
  return undefined;
}
