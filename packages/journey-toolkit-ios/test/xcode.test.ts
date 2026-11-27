import assert from "node:assert/strict";
import test from "node:test";
import { hostXcodeToolchain, parseXcodeVersionOutput } from "../src/xcode.js";

test("hostXcodeToolchain resolves Xcode version, build, Swift version, and deterministic fingerprint", async () => {
  assert.deepEqual(parseXcodeVersionOutput("Xcode 26.6\nBuild version 17F113\n"), {
    xcodeVersion: "26.6",
    xcodeBuild: "17F113"
  });
  const tool = async (command: string, args: readonly string[]) => {
    if (command === "xcode-select") return "/Applications/Xcode.app/Contents/Developer\n";
    if (command === "xcodebuild" && args[0] === "-version") return "Xcode 26.6\nBuild version 17F113\n";
    if (command === "xcrun" && args[0] === "swift") return "Apple Swift version 6.2 (swiftlang-6.2)\nTarget: arm64-apple-macosx\n";
    throw new Error(`Unexpected tool ${command}`);
  };
  const first = await hostXcodeToolchain("26", {}, undefined, tool);
  const second = await hostXcodeToolchain("26.6", {}, undefined, tool);
  assert.equal(first.xcodeVersion, "26.6");
  assert.equal(first.xcodeBuild, "17F113");
  assert.equal(first.fingerprint, second.fingerprint);
  await assert.rejects(hostXcodeToolchain("25", {}, undefined, tool), /requires Xcode 25/);
});
