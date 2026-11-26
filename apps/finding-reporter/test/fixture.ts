/** A run directory with a report model and findings data, as the findings interpreter writes it. */
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { findingsReportFormat, type Finding, type FindingsReport } from "@openuji/journey-report-findings";

export const target = { repository: "https://github.com/nextcloud/tables.git", sourceSha: "bf35d901e34e5384e9ceb4fc20060c4d5225dfc4", pullRequest: 3215, version: "3.0.0-dev.2" };

const box = (x: number, y: number) => ({ x, y, width: 120, height: 32 });

export const targetMissing: Finding = {
  id: "page-arrange--data-widget-form", test: "page-arrange", failureClass: "target-missing",
  title: `Combobox "Table or view" not found in the dialog "Add widget"`,
  expected: `A combobox "Table or view" in the dialog "Add widget" ("The table widget settings are shown").`,
  observed: `No combobox with that name is there. Found instead: combobox "Tables or views".`,
  operationId: "form", executions: [{ executionId: "keyboard-only-02", profileId: "keyboard-only" }, { executionId: "default-01", profileId: "default" }],
  frames: [
    { key: "before", label: `Last confirmed: "Matching widget types are listed"`, screenshot: "tests/page-arrange/files/state.png", viewport: { width: 800, height: 600 }, scale: 1, marks: [] },
    { key: "failure", label: `At failure: "The table widget settings are shown"`, screenshot: "tests/page-arrange/files/failure.png", viewport: { width: 800, height: 600 }, scale: 1,
      marks: [{ tone: "problem", box: box(300, 200), label: `combobox "Tables or views"` }, { tone: "context", box: box(300, 120), label: `combobox "Widget type"` }] }
  ],
  reproduce: [{ label: "Complete the setup (2 steps, left out of this report)" }, { label: "Open Add widget", keys: "Shift+Tab ×3, Space" }, { label: "Choose Table or view", keys: "Enter" }],
  path: "/apps/tables#/application/4/page/9", browser: "chromium 141.0", markup: [{ label: `combobox "Tables or views"`, html: `<div role="combobox" aria-label="Tables or views">Pick one</div>` }],
  error: "Expected locator count 1; last value: count:0"
};

/** A focus finding whose screenshot could not be taken: its text has to stand alone. */
export const focusWithoutScreenshot: Finding = {
  id: "page-manage--open-page-actions-again", test: "page-arrange", failureClass: "focus-mismatch",
  title: `Focus is not on button "Page actions" in "Open Page actions again"`,
  expected: `Focus is on button "Page actions", so it can be activated.`, observed: "No element has focus: the document has it.",
  operationId: "again", executions: [{ executionId: "keyboard-only-02", profileId: "keyboard-only" }], frames: [], reproduce: [], markup: [],
  error: "(ActivationStep): the user must be at urn:locator:page-actions: focus is at document"
};

export async function runDirectory(findings: readonly Finding[], { images = {} as Record<string, Uint8Array> } = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "finding-reporter-"));
  const write = async (path: string, data: string | Uint8Array) => { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), data); };
  const report: FindingsReport = { format: findingsReportFormat, version: 1, observerId: "findings", test: "page-arrange", findings };
  await write("report/report.json", JSON.stringify({
    format: "journey-mesh/report-model", version: 1, kind: "suite", generatedAt: "2026-11-25T10:52:35.947Z", finishedAt: "2026-11-25T10:52:34.000Z", label: "Tables grid pages",
    target, ok: false, runErrors: [], errors: [], files: [], tests: [{ id: "page-arrange", ok: false, href: "report/tests/page-arrange.json", metricKinds: [], profiles: [] }]
  }));
  await write("report/tests/page-arrange.json", JSON.stringify({ format: "journey-mesh/test-model", version: 1, id: "page-arrange", ok: false, failures: [], excludedPhaseIds: [], views: {}, journeys: [], maps: [], mapErrors: [], files: [], profiles: [],
    data: [{ href: "report/data/page-arrange/findings/findings.json", name: "findings.json", format: findingsReportFormat, observer: "findings" }] }));
  await write("report/data/page-arrange/findings/findings.json", JSON.stringify(report));
  for (const [href, data] of Object.entries(images)) await write(href, data);
  return root;
}

/** A run directory whose report has no findings data: the run had no findings observer. */
export async function runWithoutFindings(): Promise<string> {
  const root = await runDirectory([]);
  await writeFile(join(root, "report/tests/page-arrange.json"), JSON.stringify({ format: "journey-mesh/test-model", version: 1, id: "page-arrange", ok: false, data: [] }));
  return root;
}
