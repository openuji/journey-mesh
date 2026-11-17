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
  await writeFile(join(root, "sharing/app.js"), "console.log('report');");
  await writeFile(join(root, "sharing/style.css"), "body { margin: 0; }");
  const server = await serveReport(root, 0);
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}/sharing/index.html`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /fixture-evidence/);
    for (const [file, type] of [["app.js", "text/javascript"], ["style.css", "text/css"]]) {
      const asset: Awaited<ReturnType<typeof fetch>> = await fetch(`http://127.0.0.1:${address.port}/sharing/${file}`);
      assert.equal(asset.status, 200);
      assert.ok(asset.headers.get("content-type")?.startsWith(type));
    }
  } finally {
    await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()));
  }
});
