/**
 * The annotated image: each frame cropped to its marks, frames side by side, marks drawn around (never
 * over) the elements, and a legend. Geometry is pure so tests can check it without a browser.
 */
import type { FindingFrame, MarkTone } from "@openuji/journey-report-findings";

export type Rect = Readonly<{ x: number; y: number; width: number; height: number }>;

const padding = 96;
const labelRoom = 28;
const minWidth = 640;
const minHeight = 360;
const maxSheetWidth = 1600;
const sheetPadding = 16;
const gap = 24;
const headHeight = 40;
const legendHeight = 36;
/** Marks sit this far outside the element, so the border never hides what it points at. */
const outset = 4;

/** The part of a frame worth showing: its marks with room around them, inside the viewport. */
export function cropOf(frame: FindingFrame): Rect {
  const { width: viewWidth, height: viewHeight } = frame.viewport;
  if (!frame.marks.length) return { x: 0, y: 0, width: viewWidth, height: viewHeight };
  let left = Math.min(...frame.marks.map((mark) => mark.box.x)) - padding;
  let top = Math.min(...frame.marks.map((mark) => mark.box.y)) - padding - labelRoom;
  let right = Math.max(...frame.marks.map((mark) => mark.box.x + mark.box.width)) + padding;
  let bottom = Math.max(...frame.marks.map((mark) => mark.box.y + mark.box.height)) + padding;
  const grow = (low: number, high: number, size: number): [number, number] => {
    const missing = size - (high - low);
    return missing > 0 ? [low - missing / 2, high + missing / 2] : [low, high];
  };
  [left, right] = grow(left, right, minWidth);
  [top, bottom] = grow(top, bottom, minHeight);
  const fit = (low: number, high: number, limit: number): [number, number] => {
    const size = Math.min(high - low, limit);
    const start = Math.min(Math.max(low, 0), limit - size);
    return [start, start + size];
  };
  [left, right] = fit(left, right, viewWidth);
  [top, bottom] = fit(top, bottom, viewHeight);
  return { x: Math.round(left), y: Math.round(top), width: Math.round(right - left), height: Math.round(bottom - top) };
}

export type PlacedFrame = Readonly<{ frame: FindingFrame; crop: Rect; left: number; width: number; height: number }>;
export type Sheet = Readonly<{ width: number; height: number; zoom: number; scale: number; frames: readonly PlacedFrame[]; tones: readonly MarkTone[] }>;

/** Frames side by side, scaled down together when they would be wider than a readable issue image. */
export function layoutSheet(frames: readonly FindingFrame[]): Sheet {
  const crops = frames.map(cropOf);
  const content = crops.reduce((sum, crop) => sum + crop.width, 0);
  const gaps = gap * Math.max(frames.length - 1, 0) + 2 * sheetPadding;
  const zoom = Math.min(1, (maxSheetWidth - gaps) / Math.max(content, 1));
  let left = sheetPadding;
  const placed = frames.map((frame, index) => {
    const crop = crops[index]!;
    const item = { frame, crop, left, width: Math.round(crop.width * zoom), height: Math.round(crop.height * zoom) };
    left += item.width + gap;
    return item;
  });
  const tones = (["problem", "expected", "context"] as const).filter((tone) => frames.some((frame) => frame.marks.some((mark) => mark.tone === tone)));
  return {
    width: Math.round(left - gap + sheetPadding),
    height: Math.round(sheetPadding + headHeight + Math.max(...placed.map((item) => item.height), 0) + legendHeight),
    zoom, scale: Math.max(...frames.map((frame) => frame.scale), 1), frames: placed, tones
  };
}

/** Where a mark's border goes inside its frame's view, in sheet pixels. */
export function markRect(placed: PlacedFrame, box: Rect, zoom: number): Rect {
  return {
    x: Math.round((box.x - placed.crop.x) * zoom - outset), y: Math.round((box.y - placed.crop.y) * zoom - outset),
    width: Math.round(box.width * zoom + 2 * outset), height: Math.round(box.height * zoom + 2 * outset)
  };
}

const escape = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
const numbers = ["①", "②", "③", "④"];
const symbols: Record<MarkTone, string> = { problem: "✗ ", expected: "✓ ", context: "" };
const legend: Record<MarkTone, string> = { problem: "problem", expected: "where it should be", context: "also there" };

/** The page Chromium photographs. `images` are data URIs, by frame key. */
export function sheetHtml(sheet: Sheet, images: Readonly<Record<string, string>>): string {
  const frames = sheet.frames.map((placed, index) => {
    const { frame, crop } = placed;
    const marks = frame.marks.map((mark) => {
      const rect = markRect(placed, mark.box, sheet.zoom);
      const above = rect.y - 24 >= (frame.banner ? 34 : 0);
      const tagTop = above ? rect.y - 24 : rect.y + rect.height + 4;
      // Symbols stand beside the colours, so the meaning never rests on colour alone.
      const label = `${symbols[mark.tone]}${mark.label}`;
      return `<div class="mark ${mark.tone}" style="left:${rect.x}px;top:${rect.y}px;width:${rect.width}px;height:${rect.height}px"></div>`
        + `<div class="tag t-${mark.tone}" style="left:${Math.max(rect.x, 0)}px;top:${tagTop}px">${escape(label)}</div>`;
    }).join("");
    const head = `${sheet.frames.length > 1 ? `<span class="num">${numbers[index] ?? index + 1}</span>` : ""}<span class="label">${escape(frame.label)}</span>`;
    return `<section class="frame" style="left:${placed.left}px;width:${placed.width}px">
      <div class="head">${head}</div>
      <div class="view" style="width:${placed.width}px;height:${placed.height}px">
        <img alt="" src="${images[frame.key]}" style="left:${Math.round(-crop.x * sheet.zoom)}px;top:${Math.round(-crop.y * sheet.zoom)}px;width:${Math.round(frame.viewport.width * sheet.zoom)}px">
        ${marks}
        ${frame.banner ? `<div class="banner">✗ ${escape(frame.banner)}</div>` : ""}
      </div>
    </section>`;
  }).join("");
  const key = sheet.tones.map((tone) => `<span><i class="swatch ${tone}"></i>${legend[tone]}</span>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; margin: 0; }
    body { font: 14px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #1f2328; }
    .sheet { position: relative; width: ${sheet.width}px; height: ${sheet.height}px; background: #f6f8fa; }
    .frame { position: absolute; top: ${sheetPadding}px; }
    .head { height: ${headHeight}px; display: flex; align-items: center; gap: 8px; font-weight: 600; white-space: nowrap; overflow: hidden; }
    .label { overflow: hidden; text-overflow: ellipsis; }
    .num { flex: none; font-size: 20px; line-height: 1; }
    .view { position: relative; overflow: hidden; background: #fff; outline: 1px solid #d0d7de; }
    .view img { position: absolute; display: block; max-width: none; }
    .mark { position: absolute; border-radius: 5px; }
    .problem { border: 3px solid #cf222e; }
    .expected { border: 3px dashed #1a7f37; }
    .context { border: 2px dotted #57606a; }
    .tag { position: absolute; max-width: 90%; padding: 1px 7px; border-radius: 4px; color: #fff; font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .t-problem { background: #cf222e; } .t-expected { background: #1a7f37; } .t-context { background: #57606a; }
    .banner { position: absolute; left: 0; right: 0; top: 0; padding: 6px 10px; background: #cf222e; color: #fff; font-weight: 600; }
    .legend { position: absolute; left: ${sheetPadding}px; bottom: 9px; display: flex; gap: 18px; font-size: 13px; color: #57606a; }
    .swatch { display: inline-block; width: 22px; height: 13px; margin-right: 6px; vertical-align: -2px; border-radius: 3px; }
  </style></head><body><div class="sheet">${frames}<div class="legend">${key}</div></div>
  <script>
    // Keep every tag inside its frame: a tag near the right edge moves left.
    for (const tag of document.querySelectorAll(".tag")) {
      const view = tag.parentElement.getBoundingClientRect();
      const box = tag.getBoundingClientRect();
      if (box.right > view.right) tag.style.left = Math.max(0, view.width - box.width) + "px";
    }
  </script></body></html>`;
}
