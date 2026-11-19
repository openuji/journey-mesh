import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { serveReport } from "../cli/serve.js";

test("the report server serves the viewer and the run directory from loopback without copying either", async () => {
  const run = await mkdtemp(join(tmpdir(), "journey-run-"));
  const viewer = await mkdtemp(join(tmpdir(), "journey-viewer-"));
  await mkdir(join(run, "report"), { recursive: true });
  await writeFile(join(run, "report/report.json"), "{}");
  await writeFile(join(viewer, "index.html"), "<!doctype html><title>viewer</title>");
  await mkdir(join(viewer, "assets"));
  await writeFile(join(viewer, "assets/app.js"), "console.log('viewer');");
  const server = await serveReport(run, 0, viewer);
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    assert.equal(address.address, "127.0.0.1");
    const base = `http://127.0.0.1:${address.port}`;
    assert.match(await (await fetch(`${base}/`)).text(), /viewer/);
    const model = await fetch(`${base}/report/report.json`);
    assert.equal(model.status, 200);
    assert.ok(model.headers.get("content-type")?.startsWith("application/json"));
    assert.ok((await fetch(`${base}/assets/app.js`)).headers.get("content-type")?.startsWith("text/javascript"));
    assert.equal((await fetch(`${base}/missing.json`)).status, 404);
  } finally {
    await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()));
  }
});
