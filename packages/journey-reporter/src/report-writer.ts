import { createHash } from "node:crypto";
import { join } from "node:path";
import { defaultMaxFileBytes, writeJsonDocument, type JsonDocumentRef, type JourneyArtifactStore, type SuiteResultBundle } from "@openuji/journey-plugin";
import { fileArtifactStore } from "./artifact-store.js";
import { testDirectory, subjectDirectory } from "./paths.js";
import { testPassed } from "./outcome.js";
import { viteAssets } from "./vite-assets.js";
import type { ReportBundle, ReportManifest, TestEntry, TestManifest, StoredOutput, StoredExecution } from "./report-data.js";

/** One format writer for new runs, republishing, and comparison subjects. */
export async function writeReportData(outputDir: string, bundle: ReportBundle, inheritedLimit?: number): Promise<void> {
  const maxFileBytes = inheritedLimit ?? bundle.storage?.maxFileBytes ?? defaultMaxFileBytes;
  const store = fileArtifactStore(outputDir, "", maxFileBytes);
  const json = async (name: string, value: unknown): Promise<JsonDocumentRef> => ({ href: (await writeJsonDocument(store, { name, value })).href });
  const manifest: ReportManifest = { format: "journey-mesh/report", version: 1, kind: bundle.kind,
    storage: { maxFileBytes }, summary: { href: "data/summary.json" } };
  if (bundle.kind === "suite") {
    const { tests, ...summary } = bundle;
    const models = new Map<string, JsonDocumentRef>();
    const entries: TestEntry[] = [];
    for (const test of tests) entries.push(await writeTest(store, test, models));
    await json(manifest.summary.href, { ...summary, storage: manifest.storage });
    Object.assign(manifest, { tests: await json("data/tests.json", entries) });
  } else {
    const subjects = { ...bundle.subjects };
    const refs: Record<"baseline" | "candidate", JsonDocumentRef | null> = { baseline: null, candidate: null };
    for (const side of ["baseline", "candidate"] as const) {
      const subject = subjects[side];
      if (subject.bundle) {
        await writeReportData(join(outputDir, subjectDirectory(side)), subject.bundle, maxFileBytes);
        refs[side] = { href: `${subjectDirectory(side)}/manifest.json` };
      }
      subjects[side] = { ...subject, bundle: null };
    }
    await json(manifest.summary.href, { ...bundle, storage: manifest.storage, subjects });
    Object.assign(manifest, { subjects: refs });
  }
  for (const asset of await viteAssets(new URL("../dist/app/", import.meta.url))) {
    await store.write({ name: asset.name, data: asset.data, contentType: asset.contentType });
  }
  // Commit the entry point after all its data, subject reports, and application assets exist.
  await store.write({ name: "manifest.json", data: JSON.stringify(manifest), contentType: "application/json" });
}

async function writeTest(store: JourneyArtifactStore, test: SuiteResultBundle["tests"][number], models: Map<string, JsonDocumentRef>): Promise<TestEntry> {
  const base = `data/tests/${testDirectory(test.id)}`;
  const json = async (name: string, value: unknown): Promise<JsonDocumentRef> => ({ href: (await writeJsonDocument(store, { name: `${base}/${name}.json`, value })).href });
  const { plan, views, outputs, result, ...metadata } = test;
  const { evidence, ...resultSummary } = result;
  const viewRefs: Record<string, JsonDocumentRef> = {};
  for (const [key, view] of Object.entries(views)) {
    const hash = createHash("sha256").update(JSON.stringify(view)).digest("hex");
    let ref = models.get(hash);
    if (!ref) { ref = { href: (await writeJsonDocument(store, { name: `data/models/${hash}.json`, value: view })).href }; models.set(hash, ref); }
    viewRefs[key] = ref;
  }
  const storedOutputs: StoredOutput[] = [];
  for (const [index, output] of outputs.entries()) {
    const { evidence, ...summary } = output;
    storedOutputs.push({ ...summary, evidence: await json(`observers/${index}/evidence`, evidence) });
  }
  const executions: StoredExecution[] = [];
  for (const [index, execution] of evidence.executions.entries()) executions.push({ executionId: execution.executionId,
    profileId: execution.profileId, evidence: await json(`executions/${index}`, execution) });
  const descriptor: TestManifest = { format: "journey-mesh/test", version: 1,
    summary: await json("summary", { ...metadata, result: resultSummary }), plan: await json("plan", plan),
    views: await json("views", viewRefs), outputs: await json("observers", storedOutputs), executions: await json("executions", executions) };
  const manifest = await store.write({ name: `${base}/manifest.json`, data: JSON.stringify(descriptor), contentType: "application/json" });
  return { id: test.id, ok: testPassed(test), profiles: result.executions.map((execution) => execution.profileId),
    metricKinds: [...new Set(outputs.flatMap((output) => output.nodes?.map((node) => node.metrics.kind) ?? []))], manifest: { href: manifest.href } };
}
