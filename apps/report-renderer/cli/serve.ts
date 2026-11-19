import { createServer, type Server } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fromInvocation, parseArgs, runScript } from "./args.js";
import { viewerDirectory } from "./site.js";
const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".png": "image/png", ".xml": "application/xml", ".svg": "image/svg+xml"
};

const inside = (root: string, path: string) => {
  const child = relative(root, path);
  return child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
};

/**
 * Serve a run (or comparison) directory together with the viewer, bound to loopback. Run files take
 * precedence; the viewer's own files fill the rest. Nothing is copied into the run directory.
 */
export async function serveReport(directory: string, port = 9323, viewer = viewerDirectory): Promise<Server> {
  const roots = [resolve(directory), resolve(viewer)];
  await stat(resolve(viewer, "index.html")).catch(() => { throw new Error("The viewer is not built. Run pnpm build."); });
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
      const name = `.${pathname.endsWith("/") ? `${pathname}index.html` : pathname}`;
      for (const root of roots) {
        const path = resolve(root, name);
        if (!inside(root, path)) { response.writeHead(403).end(); return; }
        const data = await readFile(path).catch(() => undefined);
        if (!data) continue;
        response.writeHead(200, { "content-type": types[extname(path)] ?? "application/octet-stream", "x-content-type-options": "nosniff" });
        response.end(data); return;
      }
      response.writeHead(404).end("Not found");
    } catch { response.writeHead(400).end(); }
  });
  await new Promise<void>((done, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", done); });
  return server;
}

const usage = "Usage: pnpm --filter @openuji/report-renderer serve <run-directory> [--port <number>]";
runScript(import.meta.url, async (args) => {
  const { positionals: [directory], flags } = parseArgs(args, usage);
  const port = flags["--port"] === undefined ? 9323 : Number(flags["--port"]);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("--port must be a TCP port");
  const server = await serveReport(fromInvocation(directory), port);
  const address = server.address();
  console.log(`Journey Mesh report: http://127.0.0.1:${typeof address === "object" && address ? address.port : port}/`);
});
