/**
 * Architecture guard. TypeScript sources are type-checked by `pnpm typecheck`; this checks the boundaries
 * described in docs/architecture.md:
 *
 *   execution  ──writes──▶  run record  ◀──reads──  reporting  ◀──renders──  apps
 *
 * Layers:
 * 1. Execution packages never depend on, or import, a reporting package (dev dependencies and tests included).
 * 2. Reporting packages never depend on the host, the CLI, platforms, toolkits, vendors, executors, environments,
 *    services, or observer capture code; from observers they import only the `./evidence` entry.
 * 3. Only composition roots (journey-cli, apps/*, examples/*) depend on both sides.
 * 4. Nothing under packages/ renders: no .tsx, no React, no HTML.
 * 5. Observer `./evidence` entries load no browser or device runtime.
 *
 * Execution architecture (dev dependencies and tests included):
 * 6. Platform packages depend on no toolkit, service, executor, vendor or observer package.
 * 7. Vendor packages depend on no executor or observer package.
 * 8. Executor packages depend on no vendor package.
 * 9. Observer packages import an executor only through its `./observation` entry; every executor declares one,
 *    and it loads no browser or device runtime.
 * 10. journey-runner depends on no platform, vendor or executor package.
 * 11. Toolkit packages depend on no vendor, executor or observer package.
 *
 * Command-line contract:
 * 12. Every bin commits its --help output as contract/<bin>.help.txt, and a test under test/ compares the two.
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
/** Browser and device runtimes. */
const deviceRuntime = /^(playwright|playwright-core|@axe-core\/|appium|webdriverio)/;
/** What an observer `./evidence` entry must not load: device runtimes and the packages that wrap them. */
const runtimeOfDevices = new RegExp(`${deviceRuntime.source}|^@openuji\\/journey-(executor|platform|toolkit|vendor)-`);
/** Rules 6, 7, 8, 10 and 11: which packages a package of each kind must not depend on or import. */
const forbiddenDependencies = [
  { rule: 6, from: /^journey-platform-/, to: /^journey-(toolkit|service|executor|vendor|observer)-/, kind: "platform" },
  { rule: 7, from: /^journey-vendor-/, to: /^journey-(executor|observer)-/, kind: "vendor" },
  { rule: 8, from: /^journey-executor-/, to: /^journey-vendor-/, kind: "executor" },
  { rule: 10, from: /^journey-runner$/, to: /^journey-(platform|vendor|executor)-/, kind: "runner" },
  { rule: 11, from: /^journey-toolkit-/, to: /^journey-(vendor|executor|observer)-/, kind: "toolkit" }
];
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

/** Follow the runtime (non-type) imports of an entry through its own package and report every forbidden specifier. */
async function assertEntryLoadsNo(forbidden, entryFile, message) {
  const pending = [entryFile];
  const seen = new Set();
  while (pending.length) {
    const file = pending.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const { specifier, typeOnly } of imports(await readFile(file, "utf8"))) {
      if (typeOnly) continue;
      if (forbidden.test(specifier)) fail(file, `${message} ${specifier} at runtime`);
      if (specifier.startsWith(".")) pending.push(resolve(dirname(file), specifier.replace(/\.js$/, ".ts")));
    }
  }
}

const packagesDirectory = join(root, "packages");
for (const name of (await readdir(packagesDirectory, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name)) {
  const directory = join(packagesDirectory, name);
  const manifestPath = join(directory, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8").catch(() => "null"));
  if (!manifest) continue;
  const layer = layerOf(name);
  if (!layer) { fail(manifestPath, `package ${name} has no layer; classify it in scripts/lint.mjs`); continue; }
  const forbidden = forbiddenDependencies.filter((item) => item.from.test(name));
  const dependencies = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies, ...manifest.peerDependencies });
  for (const dependency of dependencies) {
    const target = packageName(dependency);
    if (dependency === "react" || dependency === "react-dom") fail(manifestPath, `rule 4: packages do not render (${dependency})`);
    if (!target) continue;
    if (layer === "execution" && (layerOf(target) === "reporting" || target === "report-renderer")) fail(manifestPath, `rule 1: execution package depends on reporting package ${dependency}`);
    if (layer === "reporting" && forbiddenForReporting(target)) fail(manifestPath, `rule 2: reporting package depends on ${dependency}`);
    for (const { rule, to, kind } of forbidden) if (to.test(target)) fail(manifestPath, `rule ${rule}: ${kind} package depends on ${dependency}`);
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
      for (const { rule, to, kind } of forbidden) if (to.test(target)) fail(file, `rule ${rule}: ${kind} code imports ${specifier}`);
      if (/^journey-observer-/.test(name) && /^journey-executor-/.test(target) && specifier !== `${scope}${target}/observation`) {
        fail(file, `rule 9: observer code imports ${specifier}; import the executor only through its ./observation entry`);
      }
    }
  }
  // Rule 5: follow runtime imports from an observer's evidence entry.
  const evidenceEntry = manifest.exports?.["./evidence"];
  if (layer === "execution" && typeof evidenceEntry === "string") await assertEntryLoadsNo(runtimeOfDevices, resolve(directory, evidenceEntry), "rule 5: the ./evidence entry loads");
  // Rule 9: every executor publishes a pure observation entry.
  if (/^journey-executor-/.test(name)) {
    const observationEntry = manifest.exports?.["./observation"];
    if (typeof observationEntry !== "string") fail(manifestPath, "rule 9: executor package declares no ./observation entry");
    else await assertEntryLoadsNo(deviceRuntime, resolve(directory, observationEntry), "rule 9: the ./observation entry loads");
  }
  // Rule 12: third-party tools rely on what a CLI says, so every bin commits its help and a test checks it.
  const bins = typeof manifest.bin === "string" ? [name] : Object.keys(manifest.bin ?? {});
  for (const bin of bins) {
    const contract = `contract/${bin}.help.txt`;
    if (!await readFile(join(directory, contract), "utf8").then(() => true, () => false)) fail(manifestPath, `rule 12: bin ${bin} has no committed ${contract}`);
    const tests = (await files(join(directory, "test"))).filter((file) => sourceExtensions.test(file));
    const sources = await Promise.all(tests.map((file) => readFile(file, "utf8")));
    if (!sources.some((source) => source.includes(contract))) fail(manifestPath, `rule 12: no test under test/ checks ${contract}`);
  }
}

if (errors.length) {
  console.error(`Architecture boundaries violated (${errors.length}):\n${errors.map((error) => `  - ${error}`).join("\n")}`);
  process.exit(1);
}
console.log("lint: architecture boundaries hold (execution → run record → reporting → rendering; platform, vendor, executor, observer)");
