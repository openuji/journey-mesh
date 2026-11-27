import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { testRecordFormat, type TestRecord } from "@openuji/journey-run-record";
import { writeRunRecord } from "@openuji/journey-run-record/node";
import { buildReport, parseReportConfig } from "@openuji/journey-reporter";
import type { IosAccessibilityEvidence, IosAccessibilityObserverOutput } from "@openuji/journey-observer-ios-accessibility/evidence";
import { iosReportFormat, type IosAccessibilityReport } from "../src/index.js";

const interpreter = fileURLToPath(new URL("../src/index.ts", import.meta.url));

test("a recorded iOS native journal becomes an evidence report and native node metrics", async () => {
  const directory = await mkdtemp(join(tmpdir(), "report-ios-"));
  const operation = (id: string, sequence: number) => ({
    id,
    sequence,
    kind: "state" as const,
    actorId: "actor",
    touchpointId: "device",
    entry: { id: "entry", stateId: id },
    state: { id },
    surface: { id: "surface" },
    target: { bindings: [], expectedMatchCount: 0, observation: { bindings: [], stateId: id, surfaceId: "surface", expectedMatchCount: 0 } }
  });
  const plan = { id: "plan", operations: [operation("checked", 0), operation("missing", 1)] };
  const hierarchy = "tests/native/files/ios-1.hierarchy.xml";
  await mkdir(join(directory, "tests/native/files"), { recursive: true });
  await writeFile(join(directory, hierarchy), "<AppiumAUT/>");
  const journal: IosAccessibilityEvidence[] = [
    {
      kind: "execution-started",
      execution: { runId: "run", executionId: "execution", plan, profile: { id: "touch" } }
    } as IosAccessibilityEvidence,
    {
      kind: "operation-observed",
      evidence: {
        runId: "run",
        executionId: "execution",
        profileId: "touch",
        operation: plan.operations[0],
        stage: "state-asserted",
        hierarchy: { kind: "captured", value: { nodes: [], artifact: { href: hierarchy } } },
        metrics: { kind: "captured", value: { scale: 3 } },
        screenshot: { kind: "not-requested" },
        checks: [
          { rule: "actionable-label", status: "finding", message: "Missing label" },
          { rule: "touch-target-size", status: "passed", message: "OK" }
        ]
      }
    } as unknown as IosAccessibilityEvidence
  ];
  const output: IosAccessibilityObserverOutput = {
    id: "ios-native",
    kind: "ios-accessibility",
    measurements: [],
    errors: [],
    evidence: { reportId: "ios-native", createdAt: "now", strict: false, journal }
  };
  const record: TestRecord = {
    format: testRecordFormat,
    version: 2,
    id: "ios-native",
    ok: true,
    segments: [],
    views: {},
    plan,
    observers: [output],
    observerErrors: [],
    files: [
      {
        name: "ios-1.hierarchy.xml",
        href: hierarchy,
        contentType: "application/xml",
        scope: { runId: "run", executionId: "execution", profileId: "touch", operationId: "checked" }
      }
    ],
    result: {
      ok: true,
      runId: "run",
      plan: { id: "plan" },
      errors: [],
      assessments: [{ kind: "applicable", profile: { id: "touch" } }],
      executions: [{ executionId: "execution", profileId: "touch", outcome: { kind: "passed" } }],
      evidence: {
        executions: [
          {
            executionId: "execution",
            profileId: "touch",
            operations: [{ operationId: "checked", operationKind: "state", outcome: { kind: "passed" } }]
          }
        ]
      }
    }
  };
  await writeRunRecord(directory, { ok: true, startedAt: "now", finishedAt: "now", errors: [], provenance: {}, files: [], tests: [record] });
  const { model, tests } = await buildReport(directory, { config: parseReportConfig({ report: { interpreters: [{ use: interpreter }] } }) });
  assert.deepEqual(model.errors, []);
  assert.deepEqual(
    tests[0].profiles[0].steps.map((step) => step.metrics),
    [
      { kind: "native", findings: 1, passes: 1 },
      { kind: "skipped", reason: "No native evidence was collected before execution ended." }
    ]
  );
  assert.deepEqual(tests[0].profiles[0].steps[0].files.map((file) => file.href), [hierarchy]);
  assert.equal(tests[0].data[0].format, iosReportFormat);
  const report = JSON.parse(await readFile(join(directory, tests[0].data[0].href), "utf8")) as IosAccessibilityReport;
  assert.deepEqual(report.summary, {
    executionCount: 1,
    notApplicableProfileCount: 0,
    checked: 1,
    skipped: 1,
    notApplicable: 0,
    errors: 0,
    findings: 1,
    unassessed: 0
  });
  assert.equal(report.items[0].observation?.hierarchy?.kind, "captured");
});
