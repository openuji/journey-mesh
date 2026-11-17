/** Which execution an artifact belongs to; artifacts without an operation describe the whole execution. */
export type ArtifactScope = Readonly<{ runId: string; executionId: string; profileId: string; operationId?: string }>;
/**
 * A registered file. `href` is relative: test artifacts to their test directory, suite artifacts to the
 * suite output directory. Saved bundles rely only on `href`, so they can be moved and published.
 */
export type JourneyArtifact = Readonly<{ name: string; href: string; contentType: string; scope?: ArtifactScope }>;
export type JourneyArtifactStore = {
  /** Write `data` at the relative path `name` and register it. */
  write(input: { name: string; data: string | Uint8Array; contentType: string; scope?: ArtifactScope }): Promise<JourneyArtifact>;
  /** Read a registered artifact back, e.g. to embed a capture in a report. */
  read(artifact: Pick<JourneyArtifact, "href">): Promise<Uint8Array>;
  readonly files: readonly JourneyArtifact[];
};
