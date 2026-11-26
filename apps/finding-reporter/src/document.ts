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

/**
 * Text from the report, made inert for GitHub. Page text ends up here (accessible names, markup), and
 * filing an issue must not notify anyone, reference an issue or pull request, or render HTML or
 * Markdown the page chose: `@name`, `#1` and `GH-1` get a zero-width space, and Markdown is escaped.
 */
export function inline(text: string): string {
  return text
    .replace(/\s*\r?\n\s*/g, " ")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/[\\`*_[\]~|]/g, "\\$&")
    .replace(/([@#])(?=[\p{L}\p{N}_])/gu, "$1&#8203;")
    .replace(/\b(GH)-(?=\d)/gi, "$1&#8203;-");
}

/** `inline`, where the text starts a paragraph or list item and must not start a list or heading of its own. */
export function paragraph(text: string): string {
  return inline(text).replace(/^([#+=-]|\d+[.)])/, "\\$1");
}

/** A code span holding `text` whatever backticks it contains. GitHub links nothing inside one. */
export function code(text: string): string {
  const flat = text.replace(/\s*\r?\n\s*/g, " ");
  const fence = "`".repeat(longestBacktickRun(flat) + 1);
  const pad = /^`|`$/.test(flat) ? " " : "";
  return `${fence}${pad}${flat}${pad}${fence}`;
}

/** A fenced code block holding `text`, with a fence longer than any backtick run inside it. */
function fenced(language: string, text: string): string[] {
  const fence = "`".repeat(Math.max(3, longestBacktickRun(text) + 1));
  return [`${fence}${language}`, ...text.split("\n"), fence];
}

const longestBacktickRun = (text: string) => Math.max(0, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));

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
  const viewport = finding.frames.at(-1)?.viewport;
  // The target line comes from the suite configuration, and references the pull request under test on purpose.
  const tested = [
    profiles.length ? `Reproduced with ${profiles.map(code).join(", ")}` : undefined,
    targetLine(context.target) ? `tested on ${targetLine(context.target)}` : undefined,
    finding.browser ? inline(finding.browser) : undefined,
    viewport ? `${viewport.width}×${viewport.height}` : undefined
  ].filter(Boolean).join(" · ");
  const steps = finding.reproduce.map((step) => `${paragraph(step.label)}${step.keys ? `: ${code(step.keys)}` : ""}`);
  const lines = [`## ${inline(finding.title)}`, ""];
  if (tested) lines.push(tested, "");
  if (files.annotated) lines.push(`![${inline(altText(finding.frames).replace(/[[\]]/g, ""))}](${image(files.annotated, context, finding.id)})`, "");
  if (steps.length) lines.push("### Steps to reproduce", "", ...steps.map((step, index) => `${index + 1}. ${step}`), "");
  lines.push("### Expected", "", paragraph(finding.expected), "", "### Actual", "", paragraph(finding.observed), "");
  const details: string[] = [];
  if (finding.path) details.push(`- Page: ${code(finding.path)}`);
  if (files.frames.length) details.push(`- Screenshots, unedited: ${files.frames.map((frame) => `[${inline(frame.label)}](${image(frame.file, context, finding.id)})`).join(", ")}`);
  details.push(`- Error: ${code(finding.error)}`);
  for (const markup of finding.markup) details.push(`- Markup of ${inline(markup.label)}:`, "", ...fenced("html", markup.html).map((line) => `  ${line}`), "");
  details.push(`- Found by [Journey Mesh](https://github.com/openuji/journey-mesh): test ${code(finding.test)}, finding ${code(finding.id)}${context.generatedAt ? `, report of ${context.generatedAt}` : ""}. Details in \`evidence.json\`.`);
  lines.push("<details><summary>Evidence</summary>", "", ...details, "", "</details>", "");
  return lines.join("\n");
}

export type IndexEntry = Readonly<{ id: string; test: string; title: string; profiles: readonly string[]; issue?: string }>;

export const indexEntry = (finding: Finding, issue?: string): IndexEntry =>
  ({ id: finding.id, test: finding.test, title: finding.title, profiles: profilesOf(finding), ...(issue ? { issue } : {}) });

export function indexMarkdown(entries: readonly IndexEntry[], context: IssueContext): string {
  // A pipe splits a table cell even inside a code span, so code spans escape theirs too.
  const cell = (value: string) => code(value).replace(/\|/g, "\\|");
  const lines = ["# Findings", ""];
  if (targetLine(context.target)) lines.push(`Tested on ${targetLine(context.target)}.`, "");
  lines.push(`${entries.length} ${entries.length === 1 ? "finding" : "findings"} in this run: operations that failed against what the model declares.`, "");
  if (!entries.length) return `${lines.join("\n")}\n`;
  lines.push("| Finding | Test | Profiles |", "| --- | --- | --- |");
  for (const entry of entries) {
    const title = entry.issue ? `[${inline(entry.title)}](${entry.issue})` : inline(entry.title);
    lines.push(`| ${title}<br>${cell(entry.id)} | ${inline(entry.test)} | ${inline(entry.profiles.join(", "))} |`);
  }
  return `${lines.join("\n")}\n`;
}
