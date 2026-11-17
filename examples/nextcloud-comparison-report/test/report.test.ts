import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildComparisonReport,
  operationStatus,
  auditTotals,
  type VariantInput,
} from "../src/data.js";
// @ts-expect-error JavaScript artifact boundary has no declaration file.
import { publishReportBundle } from "../scripts/build-data.mjs";

const manifest = {
  title: "Example",
  contextUrl: "https://example.org",
  variants: [
    { id: "before", label: "Before", version: "1", image: "before" },
    { id: "after", label: "After", version: "2", image: "after" },
  ],
};
const variants: VariantInput[] = manifest.variants.map((variant) => ({
  variant,
  model: "states: {}",
  run: null,
  deployment: null,
  result: null,
  reportingErrors: [],
  metrics: [],
  audits: {},
}));
test("report projection is deterministic and leaves unavailable evidence explicit", () => {
  const input = {
    manifest,
    variants,
    generatedAt: "2026-11-17T12:00:00Z",
    workflowUrl: null,
  };
  const before = JSON.stringify(input);
  const report = buildComparisonReport(input);
  assert.deepEqual(report, buildComparisonReport(input));
  assert.equal(JSON.stringify(input), before);
  assert.equal(report.variants[1].status, "unavailable");
  assert.ok(Object.isFrozen(report.variants[0]));
  assert.equal(operationStatus(null, "default", "missing"), "unexecuted");
  assert.equal(auditTotals(undefined), null);
});

test("preflight failure and missing metrics cannot be promoted to a passed report", () => {
  const report = buildComparisonReport({
    manifest,
    variants: [
      { ...variants[0], run: { error: "preflight failed" } },
      variants[1],
    ],
    generatedAt: "now",
    workflowUrl: null,
  });
  assert.equal(report.variants[0].status, "failed");
  assert.throws(
    () =>
      buildComparisonReport({
        manifest,
        variants: [{ ...variants[0], metrics: [{}] as never }, variants[1]],
        generatedAt: "now",
        workflowUrl: null,
      }),
    /Metrics require/,
  );
});

test("publication regenerates from saved artifacts, excludes private files, and removes stale evidence", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "comparison-report-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const variant = { ...manifest.variants[0], visualization: "model.yaml" };
  await writeFile(join(root, "model.yaml"), "states: {}\n");
  const resultRoot = join(root, "results");
  const source = join(resultRoot, "before", "browser-sharing");
  await mkdir(source, { recursive: true });
  await writeFile(join(source, "screenshot.png"), "image");
  await writeFile(join(source, ".env"), "private");
  await writeFile(join(source, "runtime.log"), "private");
  const destination = join(root, "public");
  await mkdir(join(destination, "evidence", "stale"), { recursive: true });
  await writeFile(join(destination, "evidence", "stale", "old.json"), "{}");
  const input = {
    manifest: { ...manifest, variants: [variant] },
    resultRoot,
    destination,
    example: root,
    generatedAt: "now",
    workflowUrl: null,
  };
  await publishReportBundle(input);
  const first = await readFile(join(destination, "comparison.json"), "utf8");
  await publishReportBundle(input);
  assert.equal(
    await readFile(join(destination, "comparison.json"), "utf8"),
    first,
  );
  assert.equal(
    await readFile(
      join(destination, "evidence", "before", "screenshot.png"),
      "utf8",
    ),
    "image",
  );
  for (const path of [
    join(destination, "evidence", "stale", "old.json"),
    join(destination, "evidence", "before", ".env"),
    join(destination, "evidence", "before", "runtime.log"),
  ])
    await assert.rejects(readFile(path), /ENOENT/);
});

test("replay uses the tested model snapshot and preserves publication on mismatched evidence", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "comparison-snapshot-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const variant = { ...manifest.variants[0], visualization: "current.yaml" };
  const resultRoot = join(root, "results");
  const saved = join(resultRoot, "before");
  await mkdir(join(saved, "browser-sharing"), { recursive: true });
  await writeFile(
    join(saved, "run.json"),
    JSON.stringify({ startedAt: "now" }),
  );
  await writeFile(join(saved, "model.ujg.yaml"), "tested model");
  await writeFile(join(root, "current.yaml"), "different current model");
  const input = {
    manifest: { ...manifest, variants: [variant] },
    resultRoot,
    destination: join(root, "public"),
    example: root,
    generatedAt: "now",
    workflowUrl: null,
  };
  const report = await publishReportBundle(input);
  assert.equal(report.variants[0].model, "tested model");
  const previous = await readFile(
    join(root, "public", "comparison.json"),
    "utf8",
  );
  await writeFile(
    join(saved, "browser-sharing", "ux-metrics.json"),
    JSON.stringify({ runId: "foreign-run" }),
  );
  await assert.rejects(publishReportBundle(input), /mismatched UX run/);
  assert.equal(
    await readFile(join(root, "public", "comparison.json"), "utf8"),
    previous,
  );
});
