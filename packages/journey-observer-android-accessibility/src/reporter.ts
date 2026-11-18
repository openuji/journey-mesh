import { defineReporterPlugin, noOptions, writeJsonDocument, writeHtmlPages, type JourneyReporter } from "@openuji/journey-plugin";
import { isAndroidAccessibilityOutput } from "./output.js";
import { androidAccessibilityHtmlParts } from "./report.js";

export function androidAccessibilityReporter(): JourneyReporter {
  return { name: "journey-mesh/android-accessibility", async report({ bundle, artifacts }) {
    if (bundle.kind !== "test") throw new Error("The Android accessibility reporter must be configured on a test");
    for (const output of bundle.outputs.filter(isAndroidAccessibilityOutput)) {
      const { report } = output.evidence;
      const name = encodeURIComponent(output.id);
      await writeJsonDocument(artifacts, { name: `${name}.json`, value: report });
      await writeHtmlPages(artifacts, { name: `${name}.html`, ...androidAccessibilityHtmlParts(report), label: "Android accessibility report" });
    }
  } };
}
export const journeyMeshPlugin = defineReporterPlugin({ kind: "reporter", parse: noOptions, create: () => androidAccessibilityReporter() });
