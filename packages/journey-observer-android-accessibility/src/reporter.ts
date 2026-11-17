import { defineReporterPlugin, noOptions, type JourneyReporter } from "@openuji/journey-plugin";
import { isAndroidAccessibilityOutput } from "./output.js";
import { renderAndroidAccessibilityReport } from "./report.js";
import { loadAndroidReportResources } from "./report-resources.js";

export function androidAccessibilityReporter(): JourneyReporter {
  return { name: "journey-mesh/android-accessibility", async report({ bundle, artifacts }) {
    if (bundle.kind !== "test") throw new Error("The Android accessibility reporter must be configured on a test");
    for (const output of bundle.outputs.filter(isAndroidAccessibilityOutput)) {
      const { report } = output.evidence;
      const resources = await loadAndroidReportResources(report, (artifact) => artifacts.read(artifact));
      const name = encodeURIComponent(output.id);
      await artifacts.write({ name: `${name}.json`, data: JSON.stringify(report, null, 2), contentType: "application/json" });
      await artifacts.write({ name: `${name}.html`, data: renderAndroidAccessibilityReport(report, resources), contentType: "text/html", label: "Android accessibility report" });
    }
  } };
}
export const journeyMeshPlugin = defineReporterPlugin({ kind: "reporter", parse: noOptions, create: () => androidAccessibilityReporter() });
