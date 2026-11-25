import assert from "node:assert/strict";
import test from "node:test";
import type { FindingFrame } from "@openuji/journey-report-findings";
import { cropOf, layoutSheet, markRect, sheetHtml } from "../src/layout.js";

const frame = (marks: FindingFrame["marks"], overrides: Partial<FindingFrame> = {}): FindingFrame =>
  ({ key: "failure", label: "At failure", screenshot: "x.png", viewport: { width: 1600, height: 1000 }, scale: 1, fullPage: false, marks, ...overrides });
const mark = (x: number, y: number, width = 100, height = 30) => ({ tone: "problem" as const, box: { x, y, width, height }, label: "button" });

test("a frame is cropped to its marks with room around them, at least 640×360, inside the viewport", () => {
  // 96px around the mark plus room for its label above, grown evenly to 640×360.
  assert.deepEqual(cropOf(frame([mark(700, 500)])), { x: 430, y: 321, width: 640, height: 360 });
  // Near the top-left corner the crop slides inside the viewport instead of leaving it.
  assert.deepEqual(cropOf(frame([mark(10, 10)])), { x: 0, y: 0, width: 640, height: 360 });
  // Marks far apart are all kept.
  assert.deepEqual(cropOf(frame([mark(100, 100), mark(1400, 800)])), { x: 4, y: 0, width: 1592, height: 950 });
  // A frame without marks (a reused full-page screenshot) shows the top viewport.
  assert.deepEqual(cropOf(frame([])), { x: 0, y: 0, width: 1600, height: 1000 });
  // A viewport smaller than the minimum is shown whole.
  assert.deepEqual(cropOf(frame([mark(100, 100)], { viewport: { width: 500, height: 300 } })), { x: 0, y: 0, width: 500, height: 300 });
});

test("frames sit side by side and shrink together when they would be wider than 1600 pixels", () => {
  const sheet = layoutSheet([frame([]), frame([mark(700, 500)])]);
  assert.equal(sheet.zoom, (1600 - 24 - 32) / (1600 + 640));
  assert.equal(sheet.width, 1600);
  assert.deepEqual(sheet.frames.map((item) => item.left), [16, 16 + Math.round(1600 * sheet.zoom) + 24]);
  assert.deepEqual(sheet.tones, ["problem"]);
  const narrow = layoutSheet([frame([mark(700, 500)])]);
  assert.equal(narrow.zoom, 1);
  assert.deepEqual([narrow.width, narrow.height], [640 + 32, 16 + 40 + 360 + 36]);
});

test("a mark goes around the element, in the frame's pixels, at any zoom and device scale", () => {
  const sheet = layoutSheet([frame([mark(700, 500)], { scale: 2 })]);
  assert.equal(sheet.scale, 2, "the sheet is photographed at the screenshot's device scale, so nothing is resampled");
  assert.deepEqual(markRect(sheet.frames[0]!, { x: 700, y: 500, width: 100, height: 30 }, 1), { x: 266, y: 175, width: 108, height: 38 });
  assert.deepEqual(markRect(sheet.frames[0]!, { x: 700, y: 500, width: 100, height: 30 }, 0.5), { x: 131, y: 86, width: 58, height: 23 });
});

test("labels are escaped and carry symbols, so meaning never rests on colour alone", () => {
  const html = sheetHtml(layoutSheet([frame([{ tone: "expected", box: { x: 700, y: 500, width: 100, height: 30 }, label: `expected focus: button "<Page actions>"` }], { banner: "No element has focus" })]), { failure: "data:image/png;base64," });
  assert.match(html, /✓ expected focus: button &#34;&#60;Page actions&#62;&#34;/);
  assert.match(html, /<div class="banner">✗ No element has focus<\/div>/);
  assert.match(html, /<i class="swatch expected"><\/i>where it should be/);
});
