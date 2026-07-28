import { writeFile } from "node:fs/promises";

import { expect, test, type Browser, type TestInfo } from "@playwright/test";

import {
  playwrightAdapter,
  type PlaywrightArtifactMode,
  type PlaywrightArtifactSink
} from "@openuji/journey-adapter-playwright";
import { nextcloudDriver } from "@openuji/journey-driver-nextcloud";
import { compileUjgJourneyPlan } from "@openuji/journey-model-ujg";
import { axeObserver, isAxeStrict, type AxeObserver } from "@openuji/journey-observer-axe";
import { defaultProfile, keyboardOnlyProfile } from "@openuji/journey-profiles";
import { runJourney, type EvidenceError, type JourneyPlan, type RunResult } from "@openuji/journey-runner";

import {
  nextcloudEnvironment,
  validateNextcloudEnvironmentForPlan
} from "./environment.js";

const journey = new URL("./ujg/filesharing.ujg.jsonld", import.meta.url);

test("executes the federated file-sharing UJG journey", async ({ browser }, testInfo) => {
  const plan = await compileUjgJourneyPlan(journey);
  const preflightErrors = validateNextcloudEnvironmentForPlan(plan);
  const axe = axeObserver({
    testInfo,
    reportId: "nextcloud-filesharing.axe-path",
    sourceScreenshots: {
      states: true,
      fullPage: true
    },
    strict: isAxeStrict()
  });
  const result = preflightErrors.length > 0
    ? preflightFailureResult({
        errors: preflightErrors,
        plan
      })
    : await runJourney({
        plan,
        adapter: playwrightAdapter({
          driver: nextcloudDriver(nextcloudEnvironment),
          browser: browser as Browser,
          executionObservers: [axe],
          artifacts: {
            mode: artifactModeFromEnv(),
            sink: testInfoArtifactSink(testInfo),
            traces: false,
            screenshots: true,
            videos: true
          }
        }),
        profiles: [defaultProfile(), keyboardOnlyProfile()],
        reporters: [axe]
      });

  const evidencePath = await attachEvidence(testInfo, result);
  printSummary(result, evidencePath, axe);

  if (process.env.UJG_EVIDENCE_STDOUT === "1") {
    console.log(JSON.stringify(result, null, 2));
  }

  expect(result.ok, failureSummary(result)).toBe(true);
});

async function attachEvidence(testInfo: TestInfo, result: RunResult): Promise<string> {
  const path = testInfo.outputPath("ujg-evidence.json");
  await writeFile(path, JSON.stringify(result, null, 2));
  await testInfo.attach("ujg-evidence.json", {
    path,
    contentType: "application/json"
  });
  return path;
}

function printSummary(result: RunResult, evidencePath: string, axe: AxeObserver): void {
  console.log(`UJG journey ${result.ok ? "passed" : "failed"}: ${result.runId}`);
  for (const execution of result.executions) {
    const suffix = execution.ok
      ? "ok"
      : `failed: ${execution.error?.message ?? "unknown error"}`;
    console.log(`  ${execution.profileId}: ${suffix}`);
  }
  if (result.executions.length === 0 && result.errors.length > 0) {
    for (const error of result.errors) {
      console.log(`  preflight: ${error.message}`);
    }
  }
  console.log(`  evidence: ${evidencePath}`);
  if (axe.latestPathReportPath) {
    console.log(`  axe: ${axe.latestPathReportPath}`);
  }
  console.log("  report: pnpm --filter @openuji/example-nextcloud-filesharing e2e:report");
}

function artifactModeFromEnv(): PlaywrightArtifactMode {
  const value = process.env.UJG_PLAYWRIGHT_ARTIFACTS;
  if (value === "always" || value === "retain-on-failure" || value === "off") {
    return value;
  }
  return "retain-on-failure";
}

function testInfoArtifactSink(testInfo: TestInfo): PlaywrightArtifactSink {
  return {
    outputPath(...pathSegments) {
      return testInfo.outputPath(...pathSegments);
    },
    attach(name, attachment) {
      return testInfo.attach(name, attachment);
    }
  };
}

function failureSummary(result: RunResult): string {
  if (result.ok) return "UJG journey should pass";
  return result.errors.map(formatError).join("\n\n") || "UJG journey failed";
}

function formatError(error: EvidenceError): string {
  return `${error.name}: ${error.message}`;
}

function preflightFailureResult(input: {
  errors: string[];
  plan: JourneyPlan;
}): RunResult {
  const errors: EvidenceError[] = input.errors.map((message) => ({
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
      events: []
    },
    errors
  };
}
