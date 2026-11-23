import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RuntimeObservation, RuntimeObservationSource } from "@openuji/journey-plugin";
import { fileEvidenceStore } from "@openuji/journey-run-record/node";
import { composeLifecycle, type ComposeLifecycleObservation, type ComposeResource } from "@openuji/journey-service-docker/observations";
import { createDockerRuntimeObserver } from "../src/index.js";
import { journeyMeshPlugin } from "../src/plugin.js";

const resource: ComposeResource = { id: "lease", project: "unrelated-application", composeFiles: ["/fixture/compose.yaml"],
  directory: "/fixture", envFile: "/fixture/runtime.env", environment: { COMPOSE_ENV: "/fixture/runtime.env" }, services: ["api", "worker"] };

type Listener = (event: RuntimeObservation<ComposeLifecycleObservation>, signal: AbortSignal) => Promise<void> | void;
/** The subscribe-only port an observer receives; the host's delivery semantics are tested in journey-host. */
function lifecycleSource() {
  let listener: Listener | undefined;
  const source: RuntimeObservationSource = {
    subscribe(topic, observe) {
      assert.equal(topic.id, composeLifecycle.id);
      listener = observe as unknown as Listener;
      return () => { listener = undefined; };
    }
  };
  const publish = async (value: ComposeLifecycleObservation) => {
    await listener?.(Object.freeze({ topic: composeLifecycle.id, source: "services.example", timestamp: new Date().toISOString(), value }), new AbortController().signal);
  };
  return { source, publish };
}

test("an independent Compose producer collects configured data with no Nextcloud dependency", async () => {
  const directory = await mkdtemp(join(tmpdir(), "docker-observation-"));
  const artifacts = fileEvidenceStore(directory);
  const calls: readonly string[][] = [];
  const lifecycle = lifecycleSource();
  const observer = createDockerRuntimeObserver({ containerLogs: true, tail: 42, timeoutMs: 1000,
    files: [{ name: "application", path: "/logs/application.log" }] }, artifacts, async (args, observed, signal) => {
    (calls as string[][]).push([...args]);
    assert.deepEqual(observed, resource);
    assert.equal(signal.aborted, false);
    return args.includes("logs") ? "container output" : "application output";
  });
  await observer.start(lifecycle.source);
  await lifecycle.publish({ phase: "allocated", resource });
  assert.equal(calls.length, 0);
  await lifecycle.publish({ phase: "before-release", resource });
  assert.equal(calls.length, 3);
  assert.ok(calls.every((args) => args.includes(resource.project) && args.includes(resource.envFile) && args.includes(resource.composeFiles[0])));
  assert.ok(calls.some((args) => args.includes("api") && args.at(-1) === "/logs/application.log"));
  assert.ok(calls.some((args) => args.includes("worker") && args.at(-1) === "/logs/application.log"));
  assert.equal(await readFile(join(directory, "unrelated-application.compose.log"), "utf8"), "container output");
  await observer.close();
  await lifecycle.publish({ phase: "before-release", resource });
  assert.equal(calls.length, 3);
});

test("one unavailable log leaves evidence of that error and does not hide other captures", async () => {
  const directory = await mkdtemp(join(tmpdir(), "docker-observation-failure-"));
  const artifacts = fileEvidenceStore(directory);
  const lifecycle = lifecycleSource();
  const observer = createDockerRuntimeObserver({ containerLogs: false, tail: 10, timeoutMs: 1000,
    files: [{ name: "custom", path: "/logs/custom.log" }] }, artifacts, async (args) => {
    if (args.includes("api")) throw new Error("log file unavailable");
    return "worker diagnostic";
  });
  await observer.start(lifecycle.source);
  await lifecycle.publish({ phase: "before-release", resource });
  assert.equal(artifacts.files.length, 2);
  assert.match(await readFile(join(directory, "unrelated-application.api.custom.log"), "utf8"), /Diagnostic capture failed: log file unavailable/);
  assert.equal(await readFile(join(directory, "unrelated-application.worker.custom.log"), "utf8"), "worker diagnostic");
  await observer.close();
});

test("capture policy is validated before construction", () => {
  assert.throws(() => journeyMeshPlugin.parse({ tail: 0.5 }, {} as never), /integer/);
  assert.throws(() => journeyMeshPlugin.parse({ files: [{ name: "../escape", path: "/logs/app" }] }, {} as never), /file-name/);
  assert.throws(() => journeyMeshPlugin.parse({ files: [{ name: "app", path: "relative.log" }] }, {} as never), /absolute/);
  assert.throws(() => journeyMeshPlugin.parse({ containerLogs: "yes" }, {} as never), /boolean/);
});
