import { expect, test, type Browser, type TestInfo } from "@playwright/test";

import {
  playwrightAdapter,
  playwrightJsonEvidenceReporter,
  playwrightJourneyRunSummaryReporter
} from "@openuji/journey-adapter-playwright";
import { nextcloudDriver } from "@openuji/journey-driver-nextcloud";
import { compileUjgJourneyPlan } from "@openuji/journey-model-ujg";
import { axeObserver, isAxeStrict } from "@openuji/journey-observer-axe";
import { defaultProfile, keyboardOnlyProfile } from "@openuji/journey-profiles";
import {
  reportJourneyResult,
  runJourney,
  touchpointAdapter,
  type JourneyRunError,
  type RunResult
} from "@openuji/journey-runner";
import { consoleJourneyProgress } from "@openuji/journey-runner/console";

import { nextcloudDriverOptions, nextcloudEnvironment } from "./environment.js";

// Architecture sketch:
// UJG JSON-LD -> JourneyPlan -> runJourney(profiles + adapters by touchpoint)
// Playwright adapter -> Nextcloud driver -> browser automation
// Axe observer + reporters -> Playwright artifacts + console summary
const journey = new URL("./ujg/filesharing.ujg.jsonld", import.meta.url);
const runner = createNextcloudFilesharingRunner();

function createNextcloudFilesharingRunner() {
  return {
    async run({ browser, testInfo }: { browser: Browser; testInfo: TestInfo }) {
      // The checked-in UJG is the source contract for this journey.
      const plan = await compileUjgJourneyPlan(journey);

      // Reporters stay Playwright-facing: evidence JSON, axe artifacts, and run summary.
      const evidence = playwrightJsonEvidenceReporter({ testInfo });
      const axe = axeObserver({
        testInfo,
        reportId: "nextcloud-filesharing.axe-path",
        sourceScreenshots: { states: true, fullPage: true },
        strict: isAxeStrict()
      });
      const summary = playwrightJourneyRunSummaryReporter({
        testInfo,
        artifacts: () => [
          evidence.latestPath ? { label: "evidence", path: evidence.latestPath } : undefined,
          axe.latestPathReportPath ? { label: "axe html", path: axe.latestPathReportPath } : undefined,
          axe.latestAccessibilitySummaryReportPath ? { label: "accessibility", path: axe.latestAccessibilitySummaryReportPath } : undefined
        ],
        commands: [{ label: "report", command: "pnpm --filter @openuji/example-nextcloud-filesharing e2e:report" }]
      });
      const reporters = [evidence, axe, summary];

      const web = playwrightAdapter({
        driver: nextcloudDriver(nextcloudDriverOptions),
        browser,
        executionObservers: [axe]
      });

      // Each model touchpoint selects its runtime. Both currently share the web adapter.
      const result = await runJourney({
        plan,
        environment: nextcloudEnvironment,
        adapter: touchpointAdapter({
          "urn:touchpoint:nextcloud-a": web,
          "urn:touchpoint:nextcloud-b": web
        }),
        profiles: [defaultProfile(), keyboardOnlyProfile()],
        progress: [consoleJourneyProgress()]
      });
      const reporting = await reportJourneyResult({ reporters, result });

      return { result, reporting };
    }
  };
}

test("executes the federated file-sharing UJG journey", async ({ browser }, testInfo) => {
  // Playwright only supplies runtime handles; Journey Mesh owns the actual journey.
  const { result, reporting } = await runner.run({ browser: browser as Browser, testInfo });

  if (process.env.UJG_EVIDENCE_STDOUT === "1") {
    console.log(JSON.stringify(result, null, 2));
  }

  expect(result.ok, failureSummary(result)).toBe(true);
  expect(reporting.errors, reportingFailureSummary(reporting.errors)).toEqual([]);
});

function failureSummary(result: RunResult): string {
  if (result.ok) return "UJG journey should pass";
  return result.errors.map(formatError).join("\n\n") || "UJG journey failed";
}

function formatError(error: JourneyRunError): string {
  return `${error.name}: ${error.message}`;
}

function reportingFailureSummary(errors: readonly JourneyRunError[]): string {
  return errors.map(formatError).join("\n\n") || "UJG reporting should pass";
}
