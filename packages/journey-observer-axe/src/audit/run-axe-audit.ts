import { axeArtifacts } from "../artifacts/artifact-target.js";
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
import { isAxeStrict } from "./strict-mode.js";

export async function runAxeAudit(input: AxeAuditRunnerInput): Promise<AxeAuditReport> {
  const tags = [...(input.tags ?? wcag22Tags)];
  const strict = input.strict ?? isAxeStrict();
  const pageState = await scanPage(input.page, tags);
  const matchedSurface = await withScopedLocator(input.resolvedLocator, input.auditId, (selector) =>
    scanSelector(input.page, selector, tags)
  );
  const report = buildAxeAuditReport({
    auditId: input.auditId,
    metadata: input.metadata,
    createdAt: new Date().toISOString(),
    url: input.page.url(),
    strict
  }, tags, {
    pageState,
    matchedSurface
  });

  await attachAxeAuditReport(axeArtifacts(input), report);
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
