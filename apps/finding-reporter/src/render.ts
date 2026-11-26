/** Photographs annotation sheets with one headless Chromium, started on first use. */
import { chromium, type Browser } from "playwright";
import { layoutSheet, sheetHtml } from "./layout.js";
import type { FindingFrame } from "@openuji/journey-report-findings";

export type Renderer = Readonly<{
  /** The annotated PNG of `frames`; `images` holds each frame's screenshot by key. */
  annotate(frames: readonly FindingFrame[], images: Readonly<Record<string, Uint8Array>>): Promise<Uint8Array>;
  close(): Promise<void>;
}>;

export function chromiumRenderer(): Renderer {
  let browser: Promise<Browser> | undefined;
  return {
    async annotate(frames, images) {
      const sheet = layoutSheet(frames);
      const uris = Object.fromEntries(Object.entries(images).map(([key, png]) => [key, `data:image/png;base64,${Buffer.from(png).toString("base64")}`]));
      const page = await (browser ??= chromium.launch({ headless: true })).then((instance) => instance.newPage({ viewport: { width: sheet.width, height: sheet.height }, deviceScaleFactor: sheet.scale }));
      try {
        await page.setContent(sheetHtml(sheet, uris), { waitUntil: "load" });
        await page.evaluate("document.fonts.ready");
        return await page.screenshot({ type: "png" });
      } finally { await page.close(); }
    },
    async close() { if (browser) await (await browser).close(); }
  };
}
