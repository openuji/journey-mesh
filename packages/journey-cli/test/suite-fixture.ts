import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { stringify } from "yaml";

/** The journey-mesh bin, run with the current Node.js. */
export const cli = fileURLToPath(new URL("../bin/journey-mesh.mjs", import.meta.url));
const hostFixture = (name: string) => fileURLToPath(new URL(`../../journey-host/test/fixtures/${name}.mjs`, import.meta.url));
const interpreter = fileURLToPath(new URL("./fixtures/interpreter.mjs", import.meta.url));

/** A two-journey suite of fixture components that writes its lifecycle events to events.jsonl. */
export async function suiteFixture(options: { label?: string; output?: string; journeys?: readonly string[] } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "journey-cli-"));
  const config = {
    kind: "suite", outputDir: options.output ?? "reports", ...(options.label ? { label: options.label } : {}), model: { use: hostFixture("model") },
    profiles: { basic: { use: hostFixture("profile") } },
    executors: {
      first: { use: hostFixture("executor"), options: { name: "first-provider", log: "events.jsonl" } as Record<string, unknown>, observers: [{ use: hostFixture("executor-observer"), options: {} }] },
      second: { use: hostFixture("executor"), options: { name: "second-provider", log: "events.jsonl" } as Record<string, unknown>, observers: [] }
    },
    report: { interpreters: [{ use: interpreter, options: {} as Record<string, unknown> }] } as Record<string, unknown>,
    tests: {
      sharing: {
        journeys: [
          { id: "alice", source: "model.json", select: "alice", executor: "first" },
          { id: "bob", source: "model.json", select: "bob", executor: "second" }
        ],
        profiles: [{ id: "default", journeys: { alice: "basic", bob: "basic" } }],
        environment: { use: hostFixture("environment"), options: { log: "events.jsonl" } },
        timeoutMs: 5_000
      }
    } as Record<string, unknown>
  };
  const path = join(directory, "mesh.yaml");
  await writeFile(join(directory, "model.json"), JSON.stringify({ journeys: options.journeys ?? ["alice", "bob"] }));
  const save = () => writeFile(path, stringify(config));
  await save();
  const events = async () => (await readFile(join(directory, "events.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line) as { event: string });
  return { directory, path, config, save, events, output: join(directory, config.outputDir) };
}
