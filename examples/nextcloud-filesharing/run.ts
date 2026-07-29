import { writeFile } from "node:fs/promises";

import { expect, test, type Browser, type TestInfo } from "@playwright/test";

import { playwrightAdapter } from "@openuji/journey-adapter-playwright";
import { nextcloudDriver } from "@openuji/journey-driver-nextcloud";
import { compileUjgJourneyPlan } from "@openuji/journey-model-ujg";
import { axeObserver, isAxeStrict, type AxeObserver } from "@openuji/journey-observer-axe";
import { defaultProfile, keyboardOnlyProfile } from "@openuji/journey-profiles";
import {
  runJourney,
  type JourneyPlan,
  type JourneyPlanOperation,
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
          executionObservers: [axe]
        }),
        profiles: [defaultProfile(), keyboardOnlyProfile()],
        reporters: [axe]
      });

  const evidencePath = await attachEvidence(testInfo, result);
  printSummary(plan, result, evidencePath, axe);

  if (process.env.UJG_EVIDENCE_STDOUT === "1") {
    console.log(JSON.stringify(result, null, 2));
  }

  expect(result.ok, failureSummary(plan, result)).toBe(true);
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

function printSummary(
  plan: JourneyPlan,
  result: RunResult,
  evidencePath: string,
  axe: AxeObserver
): void {
  console.log(`UJG journey ${result.ok ? "passed" : "failed"}: ${result.runId}`);
  for (const execution of result.executions) {
    const suffix = execution.ok
      ? "ok"
      : `failed: ${execution.error?.message ?? "unknown error"}`;
    console.log(`  ${execution.profileId}: ${suffix}`);

    for (const failure of failedOperationSummaries(plan, result, execution.executionId)) {
      console.log(`    failed operation: ${failure}`);
    }
  }
  if (result.executions.length === 0 && result.errors.length > 0) {
    for (const error of result.errors) {
      console.log(`  preflight: ${error.message}`);
    }
  }
  console.log(`  evidence: ${evidencePath}`);
  if (axe.latestPathReportPath) {
    console.log(`  axe html: ${axe.latestPathReportPath}`);
  }
  if (axe.latestAccessibilitySummaryReportPath) {
    console.log(`  axe json: ${axe.latestAccessibilitySummaryReportPath}`);
  }
  console.log("  report: pnpm --filter @openuji/example-nextcloud-filesharing e2e:report");
}

function failureSummary(plan: JourneyPlan, result: RunResult): string {
  if (result.ok) return "UJG journey should pass";
  const details = [
    ...result.errors.map(formatError),
    ...failedOperationSummaries(plan, result).map((failure) => `Failed operation: ${failure}`)
  ];
  return details.join("\n\n") || "UJG journey failed";
}

function formatError(error: JourneyRunError): string {
  return `${error.name}: ${error.message}`;
}

function failedOperationSummaries(
  plan: JourneyPlan,
  result: RunResult,
  executionId?: string
): string[] {
  const operationsById = new Map(
    plan.operations.map((operation) => [operation.id, operation])
  );
  const executions = executionId
    ? result.evidence.executions.filter((execution) => execution.executionId === executionId)
    : result.evidence.executions;

  return executions.flatMap((execution) =>
    execution.operations
      .filter((operation) => !operation.ok)
      .map((operation) => {
        const planOperation = operationsById.get(operation.operationId);
        return [
          `profile=${execution.profileId}`,
          `execution=${execution.executionId}`,
          `operation=${operation.operationId}`,
          `kind=${operation.operationKind}`,
          ...operationGraphDetails(planOperation),
          `error=${operation.error?.message ?? "unknown error"}`
        ].join(" ");
      })
  );
}

function operationGraphDetails(operation: JourneyPlanOperation | undefined): string[] {
  if (!operation) return ["graph=unknown"];
  if (operation.kind === "state") {
    return [
      `state=${operation.state.id}`,
      `surface=${operation.surface.id}`,
      ...sourceGraphNodeDetail(operation)
    ];
  }
  return [
    `transition=${operation.transition.id}`,
    ...sourceGraphNodeDetail(operation)
  ];
}

function sourceGraphNodeDetail(operation: JourneyPlanOperation): string[] {
  const graphNodeId = operation.source?.references?.graphNodeId;
  return typeof graphNodeId === "string" ? [`graph=${graphNodeId}`] : [];
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
