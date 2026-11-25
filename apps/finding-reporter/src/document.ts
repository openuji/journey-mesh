/**
 * The text of a bundle: issue.md for a maintainer who knows nothing about Journey Mesh, and index.md for
 * whoever files the issues. Every word comes from the finding, that is, from what the run captured.
 */
import type { Finding, FindingFrame } from "@openuji/journey-report-findings";
import type { ReportModel } from "@openuji/journey-reporter/model";

/** `annotated` is absent when the finding has no screenshot to draw on. */
export type BundleFiles = Readonly<{ annotated?: string; frames: readonly Readonly<{ key: string; file: string; label: string }>[] }>;
export type IssueContext = Readonly<{ target?: ReportModel["target"]; imageBaseUrl?: string; generatedAt?: string }>;

const toneWords = { problem: "red box", expected: "dashed green box", context: "grey box" } as const;

/** `nextcloud/tables#3215 @ bf35d90 (3.0.0-dev.2)`, from the run's target identity. */
export function targetLine(target: ReportModel["target"]): string | undefined {
  if (!target) return undefined;
  const repository = target.repository.replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "");
  return `${repository}${target.pullRequest !== undefined ? `#${target.pullRequest}` : ""} @ ${target.sourceSha.slice(0, 7)}${target.version ? ` (${target.version})` : ""}`;
}

/** What the annotated image shows, in words: the image is never the only way to learn the finding. */
export function altText(frames: readonly FindingFrame[]): string {
  return frames.map((frame, index) => {
    const parts = [`${frames.length > 1 ? `${index + 1}. ` : ""}${frame.label}`];
    if (frame.banner) parts.push(frame.banner);
    for (const mark of frame.marks) parts.push(`${toneWords[mark.tone]}: ${mark.label}`);
    return parts.join(". ");
  }).join(". ") + ".";
}

const image = (file: string, context: IssueContext, id: string) =>
  context.imageBaseUrl ? `${context.imageBaseUrl.replace(/\/+$/, "")}/${encodeURIComponent(id)}/${file}` : file;

const profilesOf = (finding: Finding) => finding.executions.map((execution) => execution.profileId);

export function issueMarkdown(finding: Finding, files: BundleFiles, context: IssueContext): string {
  const profiles = profilesOf(finding);
  const viewport = finding.frames.find((frame) => !frame.fullPage)?.viewport;
  const tested = [
    profiles.length ? `Reproduced with ${profiles.map((profile) => `\`${profile}\``).join(", ")}` : undefined,
    targetLine(context.target) ? `tested on ${targetLine(context.target)}` : undefined,
    finding.browser,
    viewport ? `${viewport.width}×${viewport.height}` : undefined
  ].filter(Boolean).join(" · ");
  const steps = finding.reproduce.map((step) => `${step.label}${step.keys ? `: \`${step.keys}\`` : ""}`);
  const lines = [`## ${finding.title}`, ""];
  if (tested) lines.push(tested, "");
  if (files.annotated) lines.push(`![${altText(finding.frames).replace(/[[\]]/g, "")}](${image(files.annotated, context, finding.id)})`, "");
  if (steps.length) lines.push("### Steps to reproduce", "", ...steps.map((step, index) => `${index + 1}. ${step}`), "");
  lines.push("### Expected", "", finding.expected, "", "### Actual", "", finding.observed, "");
  const details: string[] = [];
  if (finding.path) details.push(`- Page: \`${finding.path}\``);
  if (files.frames.length) details.push(`- Screenshots, unedited: ${files.frames.map((frame) => `[${frame.label}](${image(frame.file, context, finding.id)})`).join(", ")}`);
  details.push(`- Error: \`${finding.error.replace(/`/g, "'")}\``);
  for (const markup of finding.markup) details.push(`- Markup of ${markup.label}:`, "", "  ```html", ...markup.html.split("\n").map((line) => `  ${line}`), "  ```", "");
  details.push(`- Found by [Journey Mesh](https://github.com/openuji/journey-mesh): test \`${finding.test}\`, finding \`${finding.id}\`${context.generatedAt ? `, report of ${context.generatedAt}` : ""}. Details in \`evidence.json\`.`);
  lines.push("<details><summary>Evidence</summary>", "", ...details, "", "</details>", "");
  return lines.join("\n");
}

export type IndexEntry = Readonly<{ id: string; test: string; title: string; profiles: readonly string[]; issue?: string }>;

export const indexEntry = (finding: Finding, issue?: string): IndexEntry =>
  ({ id: finding.id, test: finding.test, title: finding.title, profiles: profilesOf(finding), ...(issue ? { issue } : {}) });

export function indexMarkdown(entries: readonly IndexEntry[], context: IssueContext): string {
  const cell = (value: string) => value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
  const lines = ["# Findings", ""];
  if (targetLine(context.target)) lines.push(`Tested on ${targetLine(context.target)}.`, "");
  lines.push(`${entries.length} ${entries.length === 1 ? "finding" : "findings"} in this run: operations that failed against what the model declares.`, "");
  if (!entries.length) return `${lines.join("\n")}\n`;
  lines.push("| Finding | Test | Profiles |", "| --- | --- | --- |");
  for (const entry of entries) {
    const title = entry.issue ? `[${cell(entry.title)}](${entry.issue})` : cell(entry.title);
    lines.push(`| ${title}<br>\`${cell(entry.id)}\` | ${cell(entry.test)} | ${cell(entry.profiles.join(", "))} |`);
  }
  return `${lines.join("\n")}\n`;
}
