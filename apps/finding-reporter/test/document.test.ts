import assert from "node:assert/strict";
import test from "node:test";
import { altText, indexEntry, indexMarkdown, issueMarkdown, targetLine } from "../src/document.js";
import { focusWithoutScreenshot, target, targetMissing } from "./fixture.js";

const files = { annotated: "annotated.png", frames: targetMissing.frames.map((frame) => ({ key: frame.key, file: `${frame.key}.png`, label: frame.label })) };

test("an issue states what was tested, shows the image with words for it, and says expected and actual", () => {
  const issue = issueMarkdown(targetMissing, files, { target, generatedAt: "2026-11-25T10:52:34.000Z" });
  const lines = issue.split("\n");
  assert.equal(lines[0], `## Combobox "Table or view" not found in the dialog "Add widget"`);
  assert.equal(lines[2], "Reproduced with `keyboard-only`, `default` · tested on nextcloud/tables#3215 @ bf35d90 (3.0.0-dev.2) · chromium 141.0 · 800×600");
  assert.match(issue, /!\[1\. Last confirmed: "Matching widget types are listed"\. 2\. At failure: "The table widget settings are shown"\. red box: combobox "Tables or views"\. grey box: combobox "Widget type"\.\]\(annotated\.png\)/);
  assert.match(issue, /### Steps to reproduce\n\n1\. Complete the setup \(2 steps, left out of this report\)\n2\. Open Add widget: `Shift\+Tab ×3, Space`\n3\. Choose Table or view: `Enter`/);
  assert.match(issue, /### Expected\n\nA combobox "Table or view" in the dialog "Add widget"/);
  assert.match(issue, /### Actual\n\nNo combobox with that name is there\./);
  assert.doesNotMatch(issue, /### Impact|### Notes/, "only what the run captured, no empty sections");
  assert.match(issue, /<details><summary>Evidence<\/summary>[\s\S]*Page: `\/apps\/tables#\/application\/4\/page\/9`[\s\S]*Error: `Expected locator count 1[\s\S]*```html\n  <div role="combobox"[\s\S]*finding `page-arrange--data-widget-form`/);
});

test("a finding without a screenshot still gets an issue, in words only", () => {
  const issue = issueMarkdown(focusWithoutScreenshot, { frames: [] }, { target });
  assert.match(issue, /^## Focus is not on button "Page actions" in "Open Page actions again"\n\nReproduced with `keyboard-only` · tested on/);
  assert.doesNotMatch(issue, /!\[/);
  assert.match(issue, /### Expected\n\nFocus is on button "Page actions", so it can be activated\.\n\n### Actual\n\nNo element has focus: the document has it\./);
  assert.doesNotMatch(issue, /Screenshots, unedited/);
});

test("images link to their host when the issue's images live elsewhere", () => {
  const issue = issueMarkdown(targetMissing, files, { imageBaseUrl: "https://example.org/findings/" });
  assert.match(issue, /\]\(https:\/\/example\.org\/findings\/page-arrange--data-widget-form\/annotated\.png\)/);
  assert.match(issue, /\[At failure: "The table widget settings are shown"\]\(https:\/\/example\.org\/findings\/page-arrange--data-widget-form\/failure\.png\)/);
});

test("the index lists every finding of the run, and links the bundles that exist", () => {
  const index = indexMarkdown([indexEntry(targetMissing, `${targetMissing.id}/issue.md`), indexEntry({ ...focusWithoutScreenshot, title: "Pipe | title" })], { target });
  assert.match(index, /^# Findings\n\nTested on nextcloud\/tables#3215 @ bf35d90 \(3\.0\.0-dev\.2\)\.\n\n2 findings in this run: operations that failed against what the model declares\./);
  assert.match(index, /\| \[Combobox "Table or view" not found in the dialog "Add widget"\]\(page-arrange--data-widget-form\/issue\.md\)<br>`page-arrange--data-widget-form` \| page-arrange \| keyboard-only, default \|/);
  assert.match(index, /\| Pipe \\\| title<br>`page-manage--open-page-actions-again` \| page-arrange \| keyboard-only \|/);
  assert.equal(indexMarkdown([], {}), "# Findings\n\n0 findings in this run: operations that failed against what the model declares.\n\n");
});

test("the target line and alt text read without Journey Mesh knowledge", () => {
  assert.equal(targetLine({ repository: "https://git.example.org/app.git", sourceSha: "0123456789" }), "https://git.example.org/app @ 0123456");
  assert.equal(targetLine(undefined), undefined);
  assert.equal(altText([{ ...targetMissing.frames[1]!, banner: "No element has focus", marks: [] }]), `At failure: "The table widget settings are shown". No element has focus.`);
});
