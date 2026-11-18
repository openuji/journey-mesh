import { readJsonDocument, validateReportHref, type JsonDocumentRef, type ReportStorageOptions } from "@openuji/journey-plugin";
import type { JourneyObserverOutput, JourneyNodeMetrics } from "@openuji/journey-core";
import type { SuiteResultBundle, ComparisonResultBundle, TestResultBundle, JourneyView } from "@openuji/journey-plugin";

export type ReportBundle = SuiteResultBundle | ComparisonResultBundle;
export type TestEntry = Readonly<{ id: string; ok: boolean; profiles: readonly string[]; metricKinds: readonly JourneyNodeMetrics["kind"][]; manifest: JsonDocumentRef }>;
export type ReportManifest = Readonly<{
  format: "journey-mesh/report"; version: 1; kind: ReportBundle["kind"];
  storage: ReportStorageOptions; summary: JsonDocumentRef;
  tests?: JsonDocumentRef;
  subjects?: Readonly<Record<"baseline" | "candidate", JsonDocumentRef | null>>;
}>;
export type TestManifest = Readonly<{
  format: "journey-mesh/test"; version: 1;
  summary: JsonDocumentRef; plan: JsonDocumentRef; views: JsonDocumentRef;
  outputs: JsonDocumentRef; executions: JsonDocumentRef;
}>;
export type StoredOutput = Omit<JourneyObserverOutput, "evidence"> & { evidence: JsonDocumentRef };
export type StoredExecution = Readonly<{ executionId: string; profileId: string; evidence: JsonDocumentRef }>;
export type StoredTestSummary = Omit<TestResultBundle, "plan" | "views" | "outputs" | "result"> & {
  result: Omit<TestResultBundle["result"], "evidence">;
};
export type ReportReader = (ref: JsonDocumentRef) => Promise<Uint8Array>;
export type ReportHandle = Readonly<{
  manifest: ReportManifest; bundle: ReportBundle; tests: readonly TestEntry[];
  subjects: Readonly<Record<"baseline" | "candidate", ReportHandle | null>>;
  loadTest(id: string, profile?: string, evidence?: boolean): Promise<TestResultBundle>;
}>;

/** Open only the report index. Test data and provider evidence have separate load boundaries. */
export async function openReport(read: ReportReader, prefix = ""): Promise<ReportHandle> {
  const scoped: ReportReader = (ref) => { validateReportHref(ref.href); return read({ href: prefix + ref.href }); };
  const json = <T>(ref: JsonDocumentRef) => readJsonDocument<T>(scoped, ref);
  const manifest = JSON.parse(new TextDecoder().decode(await scoped({ href: "manifest.json" }))) as ReportManifest;
  if (manifest?.format !== "journey-mesh/report" || manifest.version !== 1 || !["suite", "comparison"].includes(manifest.kind)) throw new Error("Expected a Journey Mesh report manifest (version 1); legacy bundle.json reports must be regenerated.");
  if (!Number.isSafeInteger(manifest.storage?.maxFileBytes) || manifest.storage.maxFileBytes <= 0) throw new Error("Invalid report storage policy");
  const summary = await json<ReportBundle>(manifest.summary);
  if (summary.kind !== manifest.kind) throw new Error("Report summary kind does not match its manifest");
  const tests = manifest.kind === "suite" ? await json<TestEntry[]>(manifest.tests!) : [];
  const subjects: Record<"baseline" | "candidate", ReportHandle | null> = { baseline: null, candidate: null };
  if (manifest.kind === "comparison") {
    for (const side of ["baseline", "candidate"] as const) {
      const ref = manifest.subjects?.[side];
      if (!ref) continue;
      validateReportHref(ref.href);
      if (!ref.href.endsWith("/manifest.json")) throw new Error("Invalid comparison subject manifest reference");
      subjects[side] = await openReport(read, prefix + ref.href.slice(0, -"manifest.json".length));
    }
  }
  const bundle: ReportBundle = summary.kind === "suite" ? { ...summary, storage: manifest.storage, tests: [] }
    : { ...summary, storage: manifest.storage, subjects: Object.fromEntries((["baseline", "candidate"] as const).map((side) =>
      [side, { ...summary.subjects[side], bundle: subjects[side]?.bundle ?? null }])) as ComparisonResultBundle["subjects"] };
  return {
    manifest, bundle, tests, subjects,
    async loadTest(id, profile, includeEvidence = false) {
      const entry = tests.find((item) => item.id === id);
      if (!entry) throw new Error(`Unknown report test ${id}`);
      const descriptor = JSON.parse(new TextDecoder().decode(await scoped(entry.manifest))) as TestManifest;
      if (descriptor?.format !== "journey-mesh/test" || descriptor.version !== 1) throw new Error(`Invalid test manifest for ${id}`);
      const summary = await json<StoredTestSummary>(descriptor.summary);
      const plan = await json<TestResultBundle["plan"]>(descriptor.plan);
      const viewRefs = await json<Record<string, JsonDocumentRef>>(descriptor.views);
      const views: Record<string, JourneyView> = {};
      for (const [key, ref] of Object.entries(viewRefs)) views[key] = await json<JourneyView>(ref);
      const outputs: JourneyObserverOutput[] = [];
      for (const output of await json<StoredOutput[]>(descriptor.outputs)) outputs.push({ ...output,
        evidence: includeEvidence ? await json(output.evidence) : { format: "journey-mesh/evidence-reference", document: output.evidence } });
      const executions: TestResultBundle["result"]["evidence"]["executions"][number][] = [];
      for (const item of await json<StoredExecution[]>(descriptor.executions)) {
        if (profile === undefined || item.profileId === profile) executions.push(await json(item.evidence));
      }
      return { ...summary, plan, views, outputs, result: { ...summary.result, evidence: { executions } } };
    }
  };
}

/** Materialize logical summaries for Node consumers; raw audit artifacts remain linked. */
export async function materializeReport(handle: ReportHandle): Promise<ReportBundle> {
  if (handle.bundle.kind === "suite") {
    const tests: TestResultBundle[] = [];
    for (const entry of handle.tests) tests.push(await handle.loadTest(entry.id, undefined, true));
    return { ...handle.bundle, tests };
  }
  const subjects = { ...handle.bundle.subjects };
  for (const side of ["baseline", "candidate"] as const) {
    const subject = handle.subjects[side];
    if (subject) subjects[side] = { ...subjects[side], bundle: await materializeReport(subject) as SuiteResultBundle };
  }
  return { ...handle.bundle, subjects };
}
