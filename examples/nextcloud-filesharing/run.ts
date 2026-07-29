import { expect, test, type Browser } from "@playwright/test";

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
  type JourneyPlan,
  type JourneyRunError,
  type RunResult
} from "@openuji/journey-runner";

import {
  nextcloudEnvironment,
  validateNextcloudEnvironmentForPlan
} from "./environment.js";

const journey = new URL("./ujg/filesharing.ujg.jsonld", import.meta.url);

test("executes the federated file-sharing UJG journey", async ({ browser }, testInfo) => {
  const plan = await compileUjgJourneyPlan(journey);
  const preflightErrors = validateNextcloudEnvironmentForPlan(plan);
  const evidence = playwrightJsonEvidenceReporter({ testInfo });
  const axe = axeObserver({
    testInfo,
    reportId: "nextcloud-filesharing.axe-path",
    sourceScreenshots: {
      states: true,
      fullPage: true
    },
    strict: isAxeStrict()
  });
  const summary = playwrightJourneyRunSummaryReporter({
    testInfo,
    artifacts: () => [
      evidence.latestPath ? { label: "evidence", path: evidence.latestPath } : undefined,
      axe.latestPathReportPath ? { label: "axe html", path: axe.latestPathReportPath } : undefined,
      axe.latestAccessibilitySummaryReportPath
        ? {
            label: "accessibility",
            path: axe.latestAccessibilitySummaryReportPath
          }
        : undefined
    ],
    commands: [
      {
        label: "report",
        command: "pnpm --filter @openuji/example-nextcloud-filesharing e2e:report"
      }
    ]
  });
  const result = preflightErrors.length > 0
    ? await reportJourneyResult({
        reporters: [evidence, summary],
        result: preflightFailureResult({
          errors: preflightErrors,
          plan
        })
      })
    : await runJourney({
        plan,
        adapter: playwrightAdapter({
          driver: nextcloudDriver(nextcloudEnvironment),
          browser: browser as Browser,
          executionObservers: [axe]
        }),
        profiles: [defaultProfile(), keyboardOnlyProfile()],
        reporters: [evidence, axe, summary]
      });

  if (process.env.UJG_EVIDENCE_STDOUT === "1") {
    console.log(JSON.stringify(result, null, 2));
  }

  expect(result.ok, failureSummary(result)).toBe(true);
});

function failureSummary(result: RunResult): string {
  if (result.ok) return "UJG journey should pass";
  return result.errors.map(formatError).join("\n\n") || "UJG journey failed";
}

function formatError(error: JourneyRunError): string {
  return `${error.name}: ${error.message}`;
}

function preflightFailureResult(input: {
  errors: string[];
  plan: JourneyPlan;
}): RunResult {
  const errors: JourneyRunError[] = input.errors.map((message) => ({
    name: "PreflightError",
    message
  }));

  return {
    ok: false,
    runId: `preflight-${new Date().toISOString()}`,
    plan: {
      id: input.plan.id,
      ...(input.plan.source ? { source: input.plan.source } : {})
    },
    executions: [],
    evidence: {
      executions: []
    },
    errors
  };
}
