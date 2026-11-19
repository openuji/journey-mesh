import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildReport, compareRuns } from "@openuji/journey-reporter";
import { renderMarkdown } from "../cli/markdown.js";
import { collectivesTest } from "../../../packages/journey-reporter/test/collectives-fixture.js";
import { fixtureConfig, savedTest, suiteRun, writeRun } from "../../../packages/journey-reporter/test/fixtures.js";

const reader = (directory: string) => (href: string) => readFile(join(directory, href), "utf8");

test("the Markdown summary reads the report model as plain JSON", async () => {
  const directory = await writeRun(await mkdtemp(join(tmpdir(), "markdown-")), suiteRun([await collectivesTest(), savedTest()], { label: "Release | candidate" }));
  await buildReport(directory, { config: fixtureConfig() });
  const markdown = await renderMarkdown(reader(directory));
  assert.match(markdown, /^# ❌ Release \\\| candidate\n/);
  assert.match(markdown, /\| collective-own \| ✅ passed \| default: passed<br>keyboard-only: passed \|/);
  assert.match(markdown, /\| manual-plan \| ❌ failed \| keyboard: failed \(1\/2 steps failed\) \|/);
  assert.match(markdown, /## manual-plan\n\n- execution · Error: Failure\n- keyboard · step "Completion" failed: Completion failed/);
  assert.doesNotMatch(markdown, /## collective-own/);
});

test("comparisons summarize subjects and changed measurements", async () => {
  const root = await mkdtemp(join(tmpdir(), "markdown-comparison-"));
  const measured = (value: number) => ({ ...savedTest(), observers: [{ id: "custom", kind: "custom", errors: [], evidence: {}, measurements: [{ id: "effort", label: "Effort", method: "count", unit: "command", aggregation: "count", status: "available" as const, value, scope: { runId: "run", executionId: "execution", profileId: "keyboard", operationIds: [] } }] }] });
  const baseline = await writeRun(join(root, "baseline"), suiteRun([measured(5)], { label: "Baseline" }));
  const candidate = await writeRun(join(root, "candidate"), suiteRun([measured(3)], { label: "Candidate" }));
  await compareRuns({ baseline, candidate, outputDir: join(root, "comparison"), title: "Release check" });
  const markdown = await renderMarkdown(reader(join(root, "comparison")));
  assert.match(markdown, /^# ❌ Release check/);
  assert.match(markdown, /- baseline: ❌ Baseline/);
  assert.match(markdown, /\| manual-plan\/keyboard \| Effort \| 5 \| 3 \| -2 \|/);
});
