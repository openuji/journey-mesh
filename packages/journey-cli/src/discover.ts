import { mkdir, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import type { DiscoveredMaterialization, DiscoveredMaterializationStep } from "@openuji/journey-plugin";
import { declareFindings, executeSuite, prepareSuite, validateSuite } from "@openuji/journey-host";
import { testFailures } from "@openuji/journey-run-record";
import { consoleJourneyProgress } from "@openuji/journey-runner/console";

/**
 * `journey-mesh discover`: an authoring aid that finds the keyboard and pointer steps a model does not
 * declare yet. Web only: it runs a test with the discovery mode of its executors, and only the
 * Playwright executor has one. A test with any journey on another executor, such as Appium on Android,
 * is rejected before anything starts. Profiles accept transitions without steps, and observers are
 * left out. It reports each path found, and with --apply declares the paths through the suite's model
 * plugin. A test run then performs exactly what was declared.
 */

export type DiscoverOptions = Readonly<{
  test?: string;
  /** Run only this profile combination of each selected test. */
  profile?: string;
  /** Where the findings and the discovery run record go; default `<outputDir>/discover`. */
  outputDir?: string;
  apply: boolean;
  rediscover: boolean;
  signal?: AbortSignal;
}>;

export type DiscoverySummary = Readonly<{
  /** One per transition and modality: the path every profile found, or none when rediscovery found a field already focused. */
  proposals: readonly DiscoveredMaterialization[];
  /** Profiles found different paths for the same transition and modality; none is proposed. */
  conflicts: readonly (readonly DiscoveredMaterialization[])[];
  notFound: readonly DiscoveredMaterialization[];
  declared: number;
  atTarget: number;
}>;

/** Merge what every profile found; a transition's path must not depend on the profile that took it. */
export function summarizeDiscoveries(records: readonly DiscoveredMaterialization[]): DiscoverySummary {
  const groups = new Map<string, DiscoveredMaterialization[]>();
  for (const record of records) {
    const key = JSON.stringify([record.transitionId, record.modalityId]);
    groups.set(key, [...groups.get(key) ?? [], record]);
  }
  const proposals: DiscoveredMaterialization[] = [];
  const conflicts: DiscoveredMaterialization[][] = [];
  const notFound: DiscoveredMaterialization[] = [];
  let declared = 0, atTarget = 0;
  for (const group of groups.values()) {
    notFound.push(...group.filter((record) => record.status === "not-found"));
    if (group.some((record) => record.status === "declared")) { declared++; continue; }
    const reached = group.filter((record) => record.status === "found" || record.status === "at-target");
    const paths = new Set(reached.map((record) => JSON.stringify(record.steps ?? [])));
    if (paths.size > 1) conflicts.push(reached);
    else if (reached[0]?.status === "found") proposals.push(reached[0]);
    // A rediscovered field that has focus already replaces its declared steps with none.
    else if (reached[0]?.status === "at-target" && reached[0].replaces) proposals.push(reached[0]);
    else if (reached.length) atTarget++;
  }
  return { proposals, conflicts, notFound, declared, atTarget };
}

export function describeSteps(steps: readonly DiscoveredMaterializationStep[] = []): string {
  const parts: string[] = [];
  for (const step of steps) {
    const name = step.kind === "activation" ? "activate" : step.moveKindId.replace(/^operability:/, "");
    const last = parts.at(-1)?.match(/^(.+?)(?: ×(\d+))?$/);
    if (last && last[1] === name && step.kind === "move") parts[parts.length - 1] = `${name} ×${Number(last[2] ?? 1) + 1}`;
    else parts.push(name);
  }
  return parts.join(", ") || "nothing (focus is already there)";
}

const modalityName = (id: string) => id.replace(/^.*[:/#]/, "");

export async function discover(path: string, options: DiscoverOptions): Promise<number> {
  const configPath = resolve(path);
  const records: DiscoveredMaterialization[] = [];
  const prepared = await prepareSuite(configPath, {
    test: options.test, profile: options.profile, signal: options.signal,
    discovery: { rediscover: options.rediscover, record(finding) { records.push(finding); } }
  });
  const directory = options.outputDir ? resolve(options.outputDir) : resolve(prepared.outputDir, "discover");
  await mkdir(directory, { recursive: true });

  const run = await executeSuite(prepared, { signal: options.signal, progress: [consoleJourneyProgress()], outputDir: resolve(directory, "run") });
  for (const test of run.tests) {
    console.log(`${test.ok ? "PASS" : "FAIL"} ${test.id}`);
    for (const error of testFailures(test)) console.error(`  ${error.name}: ${error.message}`);
  }
  for (const error of run.errors) console.error(`  ${error.name}: ${error.message}`);

  const summary = summarizeDiscoveries(records);
  await writeFile(resolve(directory, "materializations.json"), `${JSON.stringify(summary, null, 2)}\n`);
  printSummary(summary);
  console.log(`Findings: ${resolve(directory, "materializations.json")}`);

  let declared = true;
  if (options.apply) declared = await apply(configPath, summary, options.test);
  else if (summary.proposals.length) console.log("Review the paths, then declare them with --apply.");
  return run.ok && declared && !summary.notFound.length && !summary.conflicts.length ? 0 : 1;
}

function printSummary(summary: DiscoverySummary): void {
  console.log(`\nDiscovered ${summary.proposals.length} paths; ${summary.declared} already declared, ${summary.atTarget} text fields already focused, ${summary.notFound.length} not found, ${summary.conflicts.length} differing between profiles.`);
  for (const record of summary.proposals) {
    console.log(`  ${modalityName(record.modalityId).padEnd(10)} ${record.transitionId}: ${describeSteps(record.steps)}`);
    if (record.note) console.log(`             note: ${record.note}`);
  }
  for (const group of summary.conflicts) {
    console.log(`  DIFFERS    ${group[0].transitionId} (${modalityName(group[0].modalityId)}):`);
    for (const record of group) console.log(`             ${record.testId} / ${record.profileId}: ${describeSteps(record.steps)} (from ${record.start ?? "?"})`);
  }
  for (const record of summary.notFound) {
    console.log(`  NOT FOUND  ${record.transitionId} (${modalityName(record.modalityId)}, ${record.testId} / ${record.profileId}): ${record.note}`);
    if (record.passed?.length) console.log(`             passed: ${record.passed.join(" → ")}`);
  }
}

/** Declare the proposals through the suite's model plugin, write the changed sources, then check preflight again. */
async function apply(configPath: string, summary: DiscoverySummary, test: string | undefined): Promise<boolean> {
  const written = new Set<string>();
  for (const { source, document, writes } of await declareFindings(configPath, summary.proposals, test === undefined ? {} : { test })) {
    for (const write of writes) {
      if (write.outcome === "kept") console.log(`  kept ${write.transitionId} (${modalityName(write.modalityId)}): ${write.note}`);
      else written.add(JSON.stringify([write.transitionId, write.modalityId]));
    }
    if (document === undefined) continue;
    await writeFile(source, document);
    const declared = writes.filter((write) => write.outcome === "added" || write.outcome === "replaced").length;
    const removed = writes.filter((write) => write.outcome === "removed").length;
    console.log(`Declared ${declared} materializations${removed ? ` and removed ${removed}` : ""} in ${relative(process.cwd(), source)}`);
  }
  for (const proposal of summary.proposals) {
    if (!written.has(JSON.stringify([proposal.transitionId, proposal.modalityId]))) {
      console.warn(`  ${proposal.transitionId} (${modalityName(proposal.modalityId)}) was not written: it is not in a source document of the test, or it was kept above.`);
    }
  }
  try {
    const valid = await validateSuite(configPath, test === undefined ? {} : { test });
    console.log(`Preflight passes for ${valid.tests.join(", ")}: every transition it runs declares its steps.`);
    return true;
  } catch (error) {
    console.error(`Preflight still fails: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}
