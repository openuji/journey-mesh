import { readdir, readFile } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type AppAsset = Readonly<{ name: string; data: Uint8Array; contentType: string }>;
const builds = new Map<string, Promise<readonly AppAsset[]>>();
const contentTypes: Record<string, string> = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json"
};

/** Read the ordinary Vite build output. Report generation does not compile a UI. */
export function viteAssets(directory: URL): Promise<readonly AppAsset[]> {
  const root = fileURLToPath(directory);
  let assets = builds.get(root);
  if (!assets) {
    assets = readdir(root, { recursive: true, withFileTypes: true }).then(async (entries) => Promise.all(entries.filter((entry) => entry.isFile()).map(async (entry) => {
      const name = relative(root, resolve(entry.parentPath, entry.name)).replaceAll("\\", "/");
      return { name, data: await readFile(resolve(root, name)), contentType: contentTypes[extname(name)] ?? "application/octet-stream" };
    }))).catch((error) => {
      builds.delete(root);
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("Vite report assets are missing. Run pnpm build before generating reports.");
      throw error;
    });
    builds.set(root, assets);
  }
  return assets;
}
