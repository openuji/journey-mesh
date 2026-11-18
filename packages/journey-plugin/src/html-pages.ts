import type { JourneyArtifact, JourneyArtifactStore } from "./artifacts.js";
import { byteLength, checkReportFile, ReportFileSizeError } from "./report-storage.js";
import { escapeHtml } from "./html.js";

export type HtmlDocumentParts = Readonly<{ header: string; sections: readonly string[]; footer: string }>;

// Existing finding links target the first page. Follow the bounded page chain to locate their fragment.
const fragmentNavigation = `<script>(async()=>{const id=decodeURIComponent(location.hash.slice(1));if(!id||document.getElementById(id))return;let page=document,base=location.href;for(;;){const link=page.querySelector('a[rel="next"]');if(!link)return;const url=new URL(link.getAttribute('href'),base);const response=await fetch(url);if(!response.ok)throw new Error('Report detail page could not be loaded');page=new DOMParser().parseFromString(await response.text(),'text/html');if(page.getElementById(id)){location.replace(url.href+location.hash);return;}base=url.href;}})().catch(error=>{const message=document.createElement('p');message.setAttribute('role','alert');message.textContent=error.message;document.body.append(message);});</script>`;

/** Providers supply complete semantic sections; storage and navigation policy are shared. */
export async function writeHtmlPages(store: JourneyArtifactStore,
  input: Omit<Parameters<JourneyArtifactStore["write"]>[0], "data" | "contentType" | "storage"> & HtmlDocumentParts
): Promise<JourneyArtifact> {
  const { header, sections, footer, name, ...metadata } = input;
  const stem = name.replace(/\.html$/, "");
  const filename = (index: number) => index === 0 ? name : `${stem}.page-${index}.html`;
  const basename = (path: string) => path.split("/").pop()!;
  function end(previous?: number, next?: number): string {
    const nav = `<nav aria-label="Report pages">${previous === undefined ? "" : `<a rel="prev" href="${escapeHtml(encodeURIComponent(basename(filename(previous))))}">Previous page</a>`} ${next === undefined ? "" : `<a rel="next" href="${escapeHtml(encodeURIComponent(basename(filename(next))))}">Next page</a>`}</nav>`;
    return footer.replace("</body>", `${nav}${fragmentNavigation}</body>`);
  }
  const overhead = byteLength(header + end(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER));
  checkReportFile(name, header + end(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER), store.maxFileBytes);
  const pages: string[][] = []; let page: string[] = []; let size = overhead;
  for (const section of sections) {
    const bytes = byteLength(section);
    if (overhead + bytes > store.maxFileBytes) throw new ReportFileSizeError(name, overhead + bytes, store.maxFileBytes);
    if (page.length && size + bytes > store.maxFileBytes) { pages.push(page); page = []; size = overhead; }
    page.push(section); size += bytes;
  }
  if (page.length || !pages.length) pages.push(page);
  let first: JourneyArtifact | undefined;
  for (const [index, sections] of pages.entries()) {
    const artifact = await store.write({ ...metadata, name: filename(index), contentType: "text/html",
      ...(index ? { auxiliary: true, label: undefined } : {}),
      data: header + sections.join("") + end(index ? index - 1 : undefined, index < pages.length - 1 ? index + 1 : undefined) });
    first ??= artifact;
  }
  return first!;
}
