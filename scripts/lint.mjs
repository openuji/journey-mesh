/**
 * Architecture guard. TypeScript sources are type-checked by `pnpm typecheck`; this checks the layer boundaries
 * described in docs/architecture.md:
 *
 *   execution  ──writes──▶  run record  ◀──reads──  reporting  ◀──renders──  apps
 *
 * 1. Execution packages never depend on, or import, a reporting package (dev dependencies and tests included).
 * 2. Reporting packages never depend on the host, the CLI, platforms, toolkits, vendors, executors, environments, services, or
 *    observer capture code; from observers they import only the `./evidence` entry.
 * 3. Only composition roots (journey-cli, apps/*, examples/*) depend on both sides.
 * 4. Nothing under packages/ renders: no .tsx, no React, no HTML.
 * 5. Observer `./evidence` entries load no browser or device runtime.
 */
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scope = "@openuji/";
const layerOf = (name) => {
  if (name === "journey-cli") return "composition";
  if (name === "journey-reporter" || name.startsWith("journey-report-")) return "reporting";
  if (["journey-core", "journey-execution-model", "journey-runner", "journey-plugin", "journey-run-record", "journey-profiles", "journey-model-ujg", "journey-host"].includes(name)
    || /^journey-(platform|toolkit|vendor|executor|observer|environment|service)-/.test(name)) return "execution";
  return undefined;
};
/** Execution packages reporting must not use at runtime or in tests. */
const forbiddenForReporting = (name) => name === "journey-host" || name === "journey-cli" || /^journey-(platform|toolkit|vendor|executor|environment|service)-/.test(name);
const runtimeOfDevices = /^(playwright|playwright-core|@axe-core\/|appium|webdriverio|@openuji\/journey-(executor|platform|toolkit|vendor)-)/;
const sourceExtensions = /\.(ts|mts|mjs|js|tsx)$/;
const errors = [];
const fail = (file, message) => errors.push(`${relative(root, file)}: ${message}`);

async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(path));
    else result.push(path);
  }
  return result;
}

/** Module specifiers of a source file, with whether each is a type-only import or re-export. */
function imports(source) {
  const found = [];
  for (const match of source.matchAll(/^\s*(import|export)\s+(type\s+)?([^;]*?)\s+from\s+["']([^"']+)["']/gm)) found.push({ specifier: match[4], typeOnly: !!match[2] });
  for (const match of source.matchAll(/^\s*import\s+["']([^"']+)["']/gm)) found.push({ specifier: match[1], typeOnly: false });
  for (const match of source.matchAll(/(?<![\w.])import\(\s*["']([^"']+)["']\s*\)/g)) found.push({ specifier: match[1], typeOnly: false });
  return found;
}
const packageName = (specifier) => specifier.startsWith(scope) ? specifier.slice(scope.length).split("/")[0] : undefined;

const packagesDirectory = join(root, "packages");
for (const name of (await readdir(packagesDirectory, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name)) {
  const directory = join(packagesDirectory, name);
  const manifestPath = join(directory, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8").catch(() => "null"));
  if (!manifest) continue;
  const layer = layerOf(name);
  if (!layer) { fail(manifestPath, `package ${name} has no layer; classify it in scripts/lint.mjs`); continue; }
  const dependencies = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies, ...manifest.peerDependencies });
  for (const dependency of dependencies) {
    const target = packageName(dependency);
    if (dependency === "react" || dependency === "react-dom") fail(manifestPath, `rule 4: packages do not render (${dependency})`);
    if (!target) continue;
    if (layer === "execution" && (layerOf(target) === "reporting" || target === "report-renderer")) fail(manifestPath, `rule 1: execution package depends on reporting package ${dependency}`);
    if (layer === "reporting" && forbiddenForReporting(target)) fail(manifestPath, `rule 2: reporting package depends on ${dependency}`);
  }
  for (const file of await files(directory)) {
    if (file.endsWith(".tsx")) fail(file, "rule 4: packages do not render (.tsx)");
    if (!sourceExtensions.test(file)) continue;
    const source = await readFile(file, "utf8");
    if (/<html[\s>]|<!doctype html|text\/html|escapeHtml|writeHtmlPages/i.test(source)) fail(file, "rule 4: packages do not render HTML");
    for (const { specifier } of imports(source)) {
      const target = packageName(specifier);
      if (specifier === "react" || specifier.startsWith("react/") || specifier.startsWith("react-dom")) fail(file, `rule 4: packages do not render (${specifier})`);
      if (!target) continue;
      if (layer === "execution" && (layerOf(target) === "reporting" || target === "report-renderer")) fail(file, `rule 1: execution code imports ${specifier}`);
      if (layer === "reporting" && forbiddenForReporting(target)) fail(file, `rule 2: reporting code imports ${specifier}`);
      if (layer === "reporting" && /^journey-observer-/.test(target) && !specifier.endsWith("/evidence")) fail(file, `rule 2: reporting code imports observer capture code ${specifier}; use its ./evidence entry`);
    }
  }
  // Rule 5: follow runtime imports from an observer's evidence entry.
  const evidenceEntry = manifest.exports?.["./evidence"];
  if (layer === "execution" && typeof evidenceEntry === "string") {
    const pending = [resolve(directory, evidenceEntry)];
    const seen = new Set();
    while (pending.length) {
      const file = pending.pop();
      if (seen.has(file)) continue;
      seen.add(file);
      for (const { specifier, typeOnly } of imports(await readFile(file, "utf8"))) {
        if (typeOnly) continue;
        if (runtimeOfDevices.test(specifier)) fail(file, `rule 5: the ./evidence entry loads ${specifier} at runtime`);
        if (specifier.startsWith(".")) pending.push(resolve(dirname(file), specifier.replace(/\.js$/, ".ts")));
      }
    }
  }
}

if (errors.length) {
  console.error(`Architecture boundaries violated (${errors.length}):\n${errors.map((error) => `  - ${error}`).join("\n")}`);
  process.exit(1);
}
console.log("lint: layer boundaries hold (execution → run record → reporting → rendering)");
