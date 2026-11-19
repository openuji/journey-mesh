import { publishSite, viewerFiles } from "../cli/site.js";
import { serveDirectory } from "./http-fixture.js";

/** Publish a run or comparison directory with the built viewer and serve it below a hosting prefix. */
export async function serveSite(source: string, site: string, maxFileBytes?: number) {
  await publishSite(source, site, { files: await viewerFiles(), ...(maxFileBytes ? { maxFileBytes } : {}) });
  return serveDirectory(site, "/project/");
}
