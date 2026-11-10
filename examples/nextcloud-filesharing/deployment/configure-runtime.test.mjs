import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { configureStackRuntime, discoverStackHost } from "./configure-runtime.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "journey-stack-runtime-"));
  const put = async (path, value) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, value); };
  await put(join(root, "deployment/.env.example"), [
    "NEXTCLOUD_ALICE_HOST=host.docker.internal",
    "NEXTCLOUD_ALICE_URL=http://host.docker.internal:18081",
    "NEXTCLOUD_BOB_URL=http://host.docker.internal:18082",
    "NEXTCLOUD_FEDERATED_RECIPIENT=bob@http://host.docker.internal:18082",
    ""
  ].join("\n"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, put };
}

test("stack runtime discovers and persists one cross-runtime host", async (t) => {
  const { root } = await fixture(t);
  const first = await configureStackRuntime({ root, refresh: true, environment: {}, hostPlatform: "darwin", interfaces: {
    en0: [{ family: "IPv4", internal: false, address: "192.0.2.40" }]
  }, capture: async () => ({ stdout: "interface: en0\n" }) });
  assert.equal(first, join(root, ".runtime/stack.env"));
  const generated = await readFile(first, "utf8");
  assert.doesNotMatch(generated, /host\.docker\.internal/);
  assert.match(generated, /NEXTCLOUD_ALICE_URL=http:\/\/192\.0\.2\.40:18081/);
  const reused = await configureStackRuntime({ root, environment: {}, hostPlatform: "darwin", interfaces: {
    en0: [{ family: "IPv4", internal: false, address: "192.0.2.99" }]
  } });
  assert.equal(await readFile(reused, "utf8"), generated);
});

test("stack runtime materializes an explicit environment file", async (t) => {
  const { root, put } = await fixture(t);
  const custom = join(root, "custom.env");
  await put(custom, "NEXTCLOUD_ALICE_URL=http://198.51.100.8:18081\n");
  const target = await configureStackRuntime({ root, refresh: true, environment: { NEXTCLOUD_STACK_ENV_FILE: custom } });
  assert.equal(await readFile(target, "utf8"), "NEXTCLOUD_ALICE_URL=http://198.51.100.8:18081\n");
});

test("Linux host discovery uses the Docker bridge gateway and validates overrides", async () => {
  assert.equal(await discoverStackHost({ hostPlatform: "linux", environment: {}, capture: async () => ({ stdout: "172.17.0.1\n" }) }), "172.17.0.1");
  assert.equal(await discoverStackHost({ environment: { NEXTCLOUD_STACK_HOST: "203.0.113.7" } }), "203.0.113.7");
  await assert.rejects(discoverStackHost({ environment: { NEXTCLOUD_STACK_HOST: "localhost" } }), /IPv4/);
});
