import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  writeFile,
  lstat,
  rm,
  mkdtemp,
  rename,
} from "node:fs/promises";
import { resolve, dirname, extname, join } from "node:path";
import { buildComparisonReport } from "../src/data.ts";
import { deriveJourneyMetrics } from "@openuji/journey-observer-ux";

async function optionalJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function copyEvidence(source, destination) {
  let entries;
  try {
    entries = await readdir(source, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  await mkdir(destination, { recursive: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const path = resolve(source, entry.name);
    if (entry.isDirectory())
      await copyEvidence(path, resolve(destination, entry.name));
    else if ([".html", ".json", ".png"].includes(extname(entry.name))) {
      if (!(await lstat(path)).isFile()) continue;
      // Source paths are local provenance, not portable public links. Preserve
      // operation identities while making published JSON independent of checkout.
      if (entry.name.endsWith(".json")) {
        const value = JSON.parse(await readFile(path, "utf8"));
        await writeFile(
          resolve(destination, entry.name),
          JSON.stringify(value, portableValue, 2),
        );
      } else await copyFile(path, resolve(destination, entry.name));
    }
  }
}

function portableValue(key, item) {
  if (key === "stack") return undefined;
  return ["config", "source", "path"].includes(key) &&
    typeof item === "string" &&
    item.startsWith("/")
    ? item.split("/").at(-1)
    : item;
}

const portableAudit = (profile, base) => ({
  ...profile,
  states: Object.fromEntries(
    Object.entries(profile.states ?? {}).map(([id, entry]) => [
      id,
      {
        ...entry,
        ...(entry.sourceScreenshotHref
          ? { sourceScreenshotHref: `${base}/${entry.sourceScreenshotHref}` }
          : {}),
        ...(entry.sourceHtmlHref
          ? { sourceHtmlHref: `${base}/${entry.sourceHtmlHref}` }
          : {}),
      },
    ]),
  ),
});

export async function publishReportBundle({
  manifest,
  resultRoot,
  destination,
  example,
  generatedAt,
  workflowUrl,
}) {
  await mkdir(dirname(destination), { recursive: true });
  const staging = await mkdtemp(
    join(dirname(destination), ".comparison-data-"),
  );
  try {
    const report = await buildReportBundle({
      manifest,
      resultRoot,
      destination: staging,
      example,
      generatedAt,
      workflowUrl,
    });
    // Replace derived publication only after validating the complete saved run.
    await rm(destination, { recursive: true, force: true });
    await rename(staging, destination);
    return report;
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

async function buildReportBundle({
  manifest,
  resultRoot,
  destination,
  example,
  generatedAt,
  workflowUrl,
}) {
  await mkdir(destination, { recursive: true });
  const variants = [];
  for (const variant of manifest.variants) {
    const root = resolve(resultRoot, variant.id);
    const test = resolve(root, "browser-sharing");
    const run = await optionalJson(resolve(root, "run.json"));
    const [deployment, summary, ux, audits, model] = await Promise.all([
      optionalJson(resolve(root, "deployment.json")),
      optionalJson(resolve(test, "ujg-summary.json")),
      optionalJson(resolve(test, "ux-metrics.json")),
      optionalJson(
        resolve(test, "axe-accessibility-nextcloud-filesharing.axe-path.json"),
      ),
      readFile(resolve(root, "model.ujg.yaml"), "utf8").catch(async (error) => {
        if (error.code !== "ENOENT" || run) throw error;
        return readFile(resolve(example, variant.visualization), "utf8");
      }),
    ]);
    if (ux && ux.runId !== summary?.result?.runId)
      throw new Error(`${variant.id}: mismatched UX run`);
    const metrics =
      ux?.operations && summary?.result
        ? deriveJourneyMetrics({
            operations: ux.operations,
            result: summary.result,
            selection: ux.selection,
            observations: ux.profiles.flatMap(
              (profile) => profile.observations,
            ),
          })
        : (ux?.profiles ?? []);
    const base = `./evidence/${variant.id}`;
    await copyEvidence(test, resolve(destination, "evidence", variant.id));
    variants.push({
      variant,
      model,
      run,
      deployment,
      result: summary?.result ?? null,
      reportingErrors: summary?.reportingErrors ?? [],
      metrics,
      audits: Object.fromEntries(
        Object.entries(audits?.profiles ?? {}).map(([id, profile]) => [
          id,
          portableAudit(profile, base),
        ]),
      ),
    });
  }
  const report = buildComparisonReport({
    manifest,
    variants,
    generatedAt,
    workflowUrl,
  });
  const json = JSON.stringify(report, portableValue, 2);
  await writeFile(resolve(destination, "comparison.json"), json);
  await writeFile(resolve(destination, ".nojekyll"), "");
  return report;
}
