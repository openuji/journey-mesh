import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitSource, validateGitSource } from "../src/index.js";
import { journeyMeshPlugin } from "../src/plugin.js";
test("the same PR source resolves a fresh head on every run", async () => {
  const directory = join(await mkdtemp(join(tmpdir(), "git-source-")), "checkout");
  let head = "a".repeat(40); const fetches: readonly string[][] = [];
  const source = gitSource({ repository: "https://example.test/repo.git", pullRequest: 42, directory }, async (_command, args) => {
    if (args[0] === "fetch") (fetches as string[][]).push([...args]);
    if (args[0] === "rev-parse" && args[1] !== "--show-toplevel") return head;
    return "";
  });
  const first = (await source.start({})).outputs; head = "b".repeat(40); const second = (await source.start({})).outputs;
  assert.equal((first?.source as { identity: { sourceSha: string } }).identity.sourceSha, "a".repeat(40));
  assert.equal((second?.source as { identity: { sourceSha: string } }).identity.sourceSha, head);
  assert.deepEqual(fetches, Array(2).fill(["fetch", "origin", "refs/pull/42/head"]));
});
test("source validation requires an exact SHA or positive PR and forbids credential URLs", () => {
  const options = { repository: "https://example.test/repo.git", directory: "/tmp/test" };
  assert.throws(() => validateGitSource(options), /exactly one/);
  assert.throws(() => validateGitSource({ ...options, sha: "main" }), /exact commit/);
  assert.throws(() => validateGitSource({ ...options, pullRequest: 1, sha: "a".repeat(40) }), /exactly one/);
  assert.throws(() => validateGitSource({ ...options, repository: "https://secret@example.test/repo.git", pullRequest: 1 }), /without credentials/);
  assert.throws(() => journeyMeshPlugin.parse({ ...options, pullRequest: true }, { resolvePath: (path: string) => path } as never), /positive integer/);
});
