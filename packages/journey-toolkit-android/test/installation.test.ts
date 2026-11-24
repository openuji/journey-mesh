import assert from "node:assert/strict";
import test from "node:test";
import { verifyInstalledApk } from "../src/installation.js";

const apk = { path: "/build/application.apk", sha256: "a".repeat(64), package: "com.example.app", versionCode: 42, versionName: "1.2.3" };
test("installed subject evidence compares bytes and package/version, without exposing paths", async () => {
  const expected = { sha256: apk.sha256, package: apk.package, versionCode: apk.versionCode, versionName: apk.versionName };
  const match = await verifyInstalledApk(apk, "emulator-5554", { inspect: async (udid, packageName) => {
    assert.equal(udid, "emulator-5554"); assert.equal(packageName, apk.package); return expected;
  } });
  assert.equal(match.matches, true);
  assert.ok(!JSON.stringify(match).includes(apk.path));
  for (const observed of [{ ...expected, sha256: "b".repeat(64) }, { ...expected, versionCode: 43 }, { ...expected, package: "other" }]) {
    assert.equal((await verifyInstalledApk(apk, "emulator-5554", { inspect: async () => observed })).matches, false);
  }
});
