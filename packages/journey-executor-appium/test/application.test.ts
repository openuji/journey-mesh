import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ensureApk } from "../src/application.js";

async function serveOnce(payload: Buffer, status = 200): Promise<{ url: string; close: () => Promise<void>; requests: () => number }> {
  let requests = 0;
  const server: Server = createServer((_request, response) => {
    requests++;
    response.writeHead(status);
    response.end(status === 200 ? payload : undefined);
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}/app.apk`,
    close: () => new Promise<void>((done) => server.close(() => done())),
    requests: () => requests
  };
}

test("ensureApk downloads and verifies once; a cached match skips the network entirely", async () => {
  const data = Buffer.from("fake apk bytes");
  const sha256 = createHash("sha256").update(data).digest("hex");
  const server = await serveOnce(data);
  const directory = await mkdtemp(join(tmpdir(), "journey-apk-"));
  const path = join(directory, "nested/app.apk");
  try {
    await ensureApk({ path, url: server.url, sha256 });
    assert.deepEqual(await readFile(path), data);
    assert.equal(server.requests(), 1);
    await ensureApk({ path, url: server.url, sha256 });
    assert.equal(server.requests(), 1);
  } finally { await server.close(); }
});

test("ensureApk re-downloads when a cached file's checksum no longer matches", async () => {
  const fresh = Buffer.from("fresh bytes");
  const sha256 = createHash("sha256").update(fresh).digest("hex");
  const server = await serveOnce(fresh);
  const directory = await mkdtemp(join(tmpdir(), "journey-apk-"));
  const path = join(directory, "app.apk");
  await writeFile(path, Buffer.from("stale bytes"));
  try {
    await ensureApk({ path, url: server.url, sha256 });
    assert.deepEqual(await readFile(path), fresh);
    assert.equal(server.requests(), 1);
  } finally { await server.close(); }
});

test("ensureApk rejects a checksum mismatch and leaves no partial file", async () => {
  const server = await serveOnce(Buffer.from("unexpected bytes"));
  const directory = await mkdtemp(join(tmpdir(), "journey-apk-"));
  const path = join(directory, "app.apk");
  try {
    await assert.rejects(ensureApk({ path, url: server.url, sha256: "0".repeat(64) }), /checksum does not match/);
    await assert.rejects(readFile(path), /ENOENT/);
    await assert.rejects(readFile(`${path}.partial`), /ENOENT/);
  } finally { await server.close(); }
});

test("ensureApk surfaces a non-OK download response", async () => {
  const server = await serveOnce(Buffer.alloc(0), 404);
  const directory = await mkdtemp(join(tmpdir(), "journey-apk-"));
  try {
    await assert.rejects(ensureApk({ path: join(directory, "app.apk"), url: server.url, sha256: "0".repeat(64) }), /HTTP 404/);
  } finally { await server.close(); }
});
