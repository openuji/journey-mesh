import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { serveReport } from "../src/index.js";

test("report server serves portable artifact links from loopback", async () => {
  const root = await mkdtemp(join(tmpdir(), "journey-report-"));
  await mkdir(join(root, "sharing"));
  await writeFile(join(root, "index.html"), '<a href="sharing/index.html">sharing</a>');
  await writeFile(join(root, "sharing/index.html"), '<a href="evidence.json">fixture-evidence</a>');
  await writeFile(join(root, "sharing/evidence.json"), "{}");
  const server = await serveReport(root, 0);
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}/sharing/index.html`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /fixture-evidence/);
  } finally {
    await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()));
  }
});
