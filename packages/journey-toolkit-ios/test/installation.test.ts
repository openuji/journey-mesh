import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { bundleSha256, parseInfoPlist, readBundleInfoPlist } from "../src/bundle.js";
import { verifyAppBundleChecksum, verifyInstalledIosApp } from "../src/installation.js";

const xmlPlist = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>it.twsweb.Nextcloud</string>
  <key>CFBundleVersion</key><string>42</string>
  <key>CFBundleShortVersionString</key><string>7.3.0</string>
</dict></plist>`;

test("parseInfoPlist supports both XML and JSON plists", () => {
  const fromXml = parseInfoPlist(xmlPlist);
  const fromJson = parseInfoPlist(JSON.stringify({
    CFBundleIdentifier: "it.twsweb.Nextcloud",
    CFBundleVersion: "42",
    CFBundleShortVersionString: "7.3.0"
  }));
  assert.deepEqual(fromXml, fromJson);
  assert.equal(fromXml.bundleId, "it.twsweb.Nextcloud");
});

test("bundleSha256 and verifyInstalledIosApp detect bundle mutations", async (t: TestContext) => {
  const root = await mkdtemp(join(tmpdir(), "ios-bundle-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const appPath = join(root, "Nextcloud.app");
  await mkdir(join(appPath, "Frameworks"), { recursive: true });
  await writeFile(join(appPath, "Info.plist"), xmlPlist);
  await writeFile(join(appPath, "Nextcloud"), "mach-o-binary");
  await symlink("../Nextcloud", join(appPath, "Frameworks/Link"));

  const info = await readBundleInfoPlist(appPath);
  const sha256 = await bundleSha256(appPath);
  const expected = { path: appPath, sha256, ...info };
  await assert.doesNotReject(verifyAppBundleChecksum(expected));

  const verified = await verifyInstalledIosApp(expected, "SIM-1", {
    inspect: async () => ({ ...info, sha256 })
  });
  assert.equal(verified.matches, true);

  const mismatched = await verifyInstalledIosApp(expected, "SIM-1", {
    inspect: async () => ({ ...info, sha256: "0".repeat(64) })
  });
  assert.equal(mismatched.matches, false);

  await writeFile(join(appPath, "Nextcloud"), "tampered-binary");
  await assert.rejects(verifyAppBundleChecksum(expected), /checksum differs/);
});
