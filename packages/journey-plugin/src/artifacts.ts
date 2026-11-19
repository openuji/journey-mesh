/** Which execution an artifact belongs to; artifacts without an operation describe the whole execution. */
export type ArtifactScope = Readonly<{ runId: string; executionId: string; profileId: string; operationId?: string }>;
/**
 * A registered evidence file. `href` is relative to the run directory, so a run can be moved and published.
 * `format` names the data format of the content (e.g. `journey-mesh/axe-audit`) for consumers that interpret it.
 */
export type JourneyArtifact = Readonly<{ name: string; href: string; contentType: string; scope?: ArtifactScope; format?: string }>;
export type JourneyArtifactStore = {
  /** Write `data` at the relative path `name` and register it. */
  write(input: { name: string; data: string | Uint8Array; contentType: string; scope?: ArtifactScope; format?: string }): Promise<JourneyArtifact>;
  /** Read a registered artifact back. */
  read(artifact: Pick<JourneyArtifact, "href">): Promise<Uint8Array>;
  readonly files: readonly JourneyArtifact[];
};
