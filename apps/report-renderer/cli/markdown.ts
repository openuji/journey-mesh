/**
 * A Markdown summary for CI job summaries and pull request comments. It reads the report model as plain
 * JSON files (type-only imports, no library at runtime): any stack can consume the model the same way.
 */
import { writeFile } from "node:fs/promises";
import { runReader } from "@openuji/journey-run-record/node";
import type { ReportModel, TestModel } from "@openuji/journey-reporter/model";
import { fromInvocation, reportDirectory, runScript } from "./args.js";

/** Reads a UTF-8 file of the directory; `href` is relative to it. */
export type TextReader = (href: string) => Promise<string>;

const cell = (value: unknown) => String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
const icon = (ok: boolean) => ok ? "✅" : "❌";
const value = (metric: { value: unknown; unit: string }) => metric.value === null ? "unavailable"
  : typeof metric.value === "boolean" ? String(metric.value) : `${String(metric.value)} ${metric.unit}`.trim();

async function suite(read: TextReader, model: ReportModel, heading = "#"): Promise<string[]> {
  const lines = [`${heading} ${icon(model.ok)} ${cell(model.label ?? "Journey Mesh run")}`, ""];
  if (model.finishedAt) lines.push(`Finished ${model.finishedAt} · ${model.tests.length} test(s)`, "");
  for (const error of model.runErrors) lines.push(`- ${cell(error.name)}: ${cell(error.message)}`);
  if (model.runErrors.length) lines.push("");
  lines.push("| Test | Result | Profiles |", "| --- | --- | --- |");
  for (const test of model.tests) {
    const profiles = test.profiles.map((profile) => `${profile.id}: ${profile.outcome}${profile.failedSteps ? ` (${profile.failedSteps}/${profile.steps} steps failed)` : ""}`).join("<br>");
    lines.push(`| ${cell(test.id)} | ${icon(test.ok)} ${test.ok ? "passed" : "failed"} | ${cell(profiles)} |`);
  }
  lines.push("");
  for (const entry of model.tests) {
    const test = JSON.parse(await read(entry.href)) as TestModel;
    const details: string[] = [];
    for (const failure of test.failures) details.push(`- ${failure.source} · ${cell(failure.name)}: ${cell(failure.message)}`);
    for (const profile of test.profiles) {
      for (const step of profile.steps.filter((item) => item.outcome === "failed")) details.push(`- ${profile.id} · step "${cell(step.label)}" failed${step.error ? `: ${cell(step.error)}` : ""}`);
      for (const metric of profile.measurements.filter((item) => item.status === "available")) details.push(`- ${profile.id} · ${cell(metric.label)}: ${cell(value(metric))}`);
    }
    if (details.length) lines.push(`${heading}# ${cell(test.id)}`, "", ...details, "");
  }
  if (model.errors.length) {
    lines.push(`${heading}# Report warnings`, "", ...model.errors.map((error) => `- ${error.test ? `${cell(error.test)} · ` : ""}${cell(error.message)}`), "");
  }
  return lines;
}

/** Render `report/report.json` of a run or comparison directory as Markdown. */
export async function renderMarkdown(read: TextReader): Promise<string> {
  const model = JSON.parse(await read("report/report.json")) as ReportModel;
  if (model.format !== "journey-mesh/report-model" || model.version !== 1) throw new Error("Expected report/report.json (journey-mesh/report-model, version 1)");
  if (!model.comparison) return (await suite(read, model)).join("\n").trimEnd() + "\n";
  const { comparison } = model;
  const lines = [`# ${icon(model.ok)} ${cell(comparison.title)}`, ""];
  for (const side of ["baseline", "candidate"] as const) {
    const subject = comparison.subjects[side];
    lines.push(`- ${side}: ${icon(subject.ok)} ${cell(subject.label ?? side)}${subject.errors.map((error) => ` — ${cell(error.message)}`).join("")}`);
  }
  const changed = comparison.differences.filter((row) => row.changed);
  lines.push("", `${comparison.differences.length} paired measurement(s), ${changed.length} changed.`, "");
  if (changed.length) {
    lines.push("| Pairing | Measurement | Baseline | Candidate | Change |", "| --- | --- | --- | --- | --- |");
    for (const row of changed) {
      lines.push(`| ${cell(row.pairing)} | ${cell(row.label)} | ${cell(row.baseline?.value)} | ${cell(row.candidate?.value)} | ${cell(row.delta !== null ? (row.delta > 0 ? `+${row.delta}` : row.delta) : "changed")} |`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}

runScript(import.meta.url, "markdown", async ({ positionals: [directory], options: flags }) => {
  const read = runReader(await reportDirectory(directory));
  const markdown = await renderMarkdown(async (href) => new TextDecoder().decode(await read(href)));
  if (flags["--output"]) {
    await writeFile(fromInvocation(flags["--output"]), markdown);
    console.log(`Markdown: ${fromInvocation(flags["--output"])}`);
  } else process.stdout.write(markdown);
});
