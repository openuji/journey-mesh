import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ObservationPublisher } from "@openuji/journey-plugin";
import { composeCommand, composeStackContract, startComposeStack, type ComposeExecutor } from "../src/compose.js";

test("a stack input addresses its own Compose project", () => {
  assert.equal(composeStackContract.id, "@openuji/docker-compose-stack/v1");
  assert.deepEqual(composeCommand({ project: "moodle-stack", envFile: "/run/stack.env", composeFiles: ["/a.yaml", "/b.yaml"] }),
    ["compose", "--project-name", "moodle-stack", "--env-file", "/run/stack.env", "-f", "/a.yaml", "-f", "/b.yaml"]);
});

test("bootstrap can tell whether an image has finished its entrypoint script", async () => {
  const directory = await mkdtemp(join(tmpdir(), "compose-entrypoint-"));
  const pid1: Record<string, string | Error> = { starting: "/bin/sh\0/entrypoint.sh\0apache2-foreground", serving: "apache2-foreground", custom: "/usr/local/bin/moodle-entrypoint\0apache2", gone: new Error("no such service") };
  const execute: ComposeExecutor = async (_command, args) => {
    if (args.at(-1) !== "/proc/1/cmdline") return "";
    const answer = pid1[args.at(-3)!]!;
    if (answer instanceof Error) throw answer;
    return answer;
  };
  const observations: ObservationPublisher = { async publish() {} };
  const seen: Record<string, boolean> = {};
  const lease = await startComposeStack({ label: "Example", project: "example", composeFiles: ["/compose.yaml"], directory, environment: {}, envFileVariable: "EXAMPLE_ENV_FILE", services: ["app"], ownershipFile: join(directory, "ownership.json") }, {
    async bootstrap({ entrypointFinished }) {
      seen.starting = await entrypointFinished("starting", "entrypoint.sh");
      seen.serving = await entrypointFinished("serving", "entrypoint.sh");
      seen.otherImage = await entrypointFinished("serving", "moodle-entrypoint");
      seen.custom = await entrypointFinished("custom", "moodle-entrypoint");
      seen.gone = await entrypointFinished("gone", "entrypoint.sh");
      return { outputs: {} };
    }
  }, { observations }, { execute });
  await lease.release();
  assert.deepEqual(seen, { starting: false, serving: true, otherImage: true, custom: false, gone: false });
});
