import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";

export async function serveDirectory(directory: string, prefix = "/report/") {
  const root = resolve(directory);
  const requests: string[] = [];
  const types: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".xml": "application/xml" };
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url!, "http://localhost").pathname;
      if (!pathname.startsWith(prefix)) throw new Error("Invalid prefix");
      const name = decodeURIComponent(pathname.slice(prefix.length)) || "index.html";
      const path = resolve(root, name);
      const child = relative(root, path);
      if (child === ".." || child.startsWith(`..${sep}`)) throw new Error("Invalid path");
      requests.push(name);
      const data = await readFile(path);
      response.setHeader("content-type", types[extname(path)] ?? "application/octet-stream"); response.end(data);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise<void>((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
  return { origin: `http://127.0.0.1:${(server.address() as { port: number }).port}${prefix}`, requests,
    close: () => new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done())) };
}
