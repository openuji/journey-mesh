import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { publishAtomically } from "@openuji/journey-run-record/node";
import { fromInvocation, parseArgs, runScript } from "./args.js";
import { defaultMaxFileBytes, ReportFileSizeError, reportFileLimit, writeJsonDocument } from "./json-document.js";

export const viewerDirectory = fileURLToPath(new URL("../dist/", import.meta.url));

/** A file the site adds next to the run data, e.g. the viewer's `index.html` and assets. */
export type SiteFile = Readonly<{ name: string; data: string | Uint8Array }>;
export type PublishSiteOptions = Readonly<{ maxFileBytes?: number; files?: readonly SiteFile[] }>;

async function* walk(root: string, directory = root): AsyncGenerator<string> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) yield* walk(root, path);
    else if (entry.isFile()) yield relative(root, path).split(sep).join("/");
  }
}

/** The built viewer, as site files. */
export async function viewerFiles(directory = viewerDirectory): Promise<SiteFile[]> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true }).catch(() => { throw new Error("The viewer is not built. Run pnpm build."); });
  return Promise.all(entries.filter((entry) => entry.isFile()).map(async (entry) => {
    const path = resolve(entry.parentPath, entry.name);
    return { name: relative(directory, path).split(sep).join("/"), data: await readFile(path) };
  }));
}

/**
 * Publish a run or comparison directory (with its report model) as a static site next to `files`.
 * Hosting limits apply here only: JSON larger than `maxFileBytes` is split into linked chunks the viewer
 * reassembles; any other oversized file fails with `ReportFileSizeError`. Publication is atomic.
 */
export async function publishSite(source: string, outputDir: string, options: PublishSiteOptions = {}): Promise<void> {
  const root = resolve(source);
  const limit = options.maxFileBytes ?? defaultMaxFileBytes;
  await publishAtomically(resolve(outputDir), [root], async (staging) => {
    const write = async (name: string, data: string | Uint8Array) => {
      const path = resolve(staging, name);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, data);
    };
    const written = new Set<string>();
    for await (const name of walk(root)) {
      const data = await readFile(resolve(root, name));
      written.add(name);
      if (data.byteLength <= limit) { await write(name, data); continue; }
      if (!name.endsWith(".json")) throw new ReportFileSizeError(name, data.byteLength, limit);
      await writeJsonDocument({ maxFileBytes: limit, write }, name, JSON.parse(new TextDecoder().decode(data)));
    }
    for (const file of options.files ?? []) {
      if (written.has(file.name)) throw new Error(`Site file ${file.name} would replace run data`);
      const bytes = typeof file.data === "string" ? new TextEncoder().encode(file.data) : file.data;
      if (bytes.byteLength > limit) throw new ReportFileSizeError(file.name, bytes.byteLength, limit);
      await write(file.name, bytes);
    }
  });
}

const usage = "Usage: pnpm --filter @openuji/report-renderer site <run-directory> --out <directory> [--max-file-size-mib <number>]";
runScript(import.meta.url, async (args) => {
  const { positionals: [directory], flags } = parseArgs(args, usage);
  if (!flags["--out"]) throw new Error(usage);
  const maxFileBytes = flags["--max-file-size-mib"] === undefined ? defaultMaxFileBytes : reportFileLimit(Number(flags["--max-file-size-mib"]));
  const output = fromInvocation(flags["--out"]);
  await publishSite(fromInvocation(directory), output, { files: await viewerFiles(), maxFileBytes });
  console.log(`Site: ${resolve(output, "index.html")}`);
});
