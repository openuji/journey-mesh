import type { JourneyArtifactStore } from "@openuji/journey-runtime/plugin";

/** Structural compatibility keeps existing Playwright Test callers working. */
export type AxeArtifactSink = {
  readonly outputDir?: string;
  outputPath(...segments: string[]): string;
  attach(name: string, input: { path: string; contentType: string }): Promise<void> | void;
};
export type AxeArtifactOptions = { artifacts?: JourneyArtifactStore; testInfo?: AxeArtifactSink };
export function axeArtifacts(options: AxeArtifactOptions): AxeArtifactSink {
  const target = options.artifacts ?? options.testInfo;
  if (!target) throw new Error("Axe requires an artifact store");
  return target;
}
