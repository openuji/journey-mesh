import { readFile } from "node:fs/promises";
import type { AndroidArtifact, AndroidArtifactReader } from "./evidence.js";
import { immutableSnapshot } from "./immutable.js";
import type { AndroidAccessibilityReport, AndroidReportResource } from "./report.js";

/** Resolve media before rendering or attaching HTML; rendering itself performs no I/O. */
export async function loadAndroidReportResources(
  report: AndroidAccessibilityReport,
  readArtifact: AndroidArtifactReader = (artifact) => readFile(artifact.path)
): Promise<readonly AndroidReportResource[]> {
  const artifacts = report.items.flatMap<{ kind: "hierarchy" | "screenshot"; artifact: AndroidArtifact }>((item) => {
    const observation = item.observation;
    return [
      ...(observation?.hierarchy?.kind === "captured" ? [{ kind: "hierarchy" as const, artifact: observation.hierarchy.value.artifact }] : []),
      ...(observation?.screenshot?.kind === "captured" ? [{ kind: "screenshot" as const, artifact: observation.screenshot.value }] : [])
    ];
  });
  const unique = artifacts.filter((item, index) => artifacts.findIndex((other) =>
    other.kind === item.kind && other.artifact.path === item.artifact.path
  ) === index);
  return immutableSnapshot(await Promise.all(unique.map(async ({ kind, artifact }): Promise<AndroidReportResource> => {
    const data = await readArtifact(artifact);
    if (kind === "hierarchy") return {
      kind, path: artifact.path, xml: typeof data === "string" ? data : Buffer.from(data).toString("utf8")
    };
    const png = Buffer.from(data);
    if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      throw new Error(`Native report screenshot is not a PNG image: ${artifact.path}`);
    }
    return { kind, path: artifact.path, pngDataUrl: `data:image/png;base64,${png.toString("base64")}` };
  })));
}
