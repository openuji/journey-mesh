import { AxeBuilder } from "@axe-core/playwright";
import type { Page } from "playwright";

import { wcag22Tags } from "../constants.js";
import type {
  AxeAuditReport,
  AxeAuditRunnerInput,
  AxeResults
} from "../types.js";
import { attachAxeAuditReport } from "../artifacts/report-attachments.js";
import { buildAxeAuditReport } from "./audit-report.js";
import { withScopedLocator } from "./scoped-locator.js";

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
