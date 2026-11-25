/** `bundle`: GitHub-ready bundles for the findings of a run. Reads the report model; runs nothing. */
import { CliUsageError } from "@openuji/journey-plugin/cli";
import { runReader } from "@openuji/journey-run-record/node";
import { writeBundles } from "../src/bundle.js";
import { loadFindings } from "../src/load.js";
import { chromiumRenderer } from "../src/render.js";
import { fromInvocation, reportDirectory, runScript } from "./args.js";

runScript(import.meta.url, "bundle", async ({ positionals: [directory], options }) => {
  const run = await reportDirectory(directory!);
  const read = runReader(run);
  const loaded = await loadFindings(read);
  if (!loaded.reports.length) {
    // Name the run's date: the usual cause is an older run directory, made before the observer was configured.
    const when = loaded.model.finishedAt ?? loaded.model.generatedAt;
    throw new CliUsageError(`No findings data in ${directory} (run of ${when}): run the tests with @openuji/journey-observer-findings, and build the report with @openuji/journey-report-findings in report.interpreters.`);
  }
  const only = options["--finding"];
  const ids = loaded.reports.flatMap((report) => report.findings.map((finding) => finding.id));
  if (only && !ids.includes(only)) throw new CliUsageError(`Unknown finding ${only}; this run has ${ids.join(", ") || "none"}`);
  const renderer = chromiumRenderer();
  try {
    const result = await writeBundles({
      loaded, read, out: fromInvocation(options["--out"]!), renderer,
      ...(only ? { only } : {}), ...(options["--image-base-url"] ? { imageBaseUrl: options["--image-base-url"] } : {})
    });
    for (const bundle of result.bundles) console.log(`Finding: ${bundle.id} ${bundle.issue}`);
    console.log(`Findings: ${result.index}`);
  } finally { await renderer.close(); }
});
