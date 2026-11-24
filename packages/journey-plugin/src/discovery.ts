/**
 * Discovery contracts: `journey-mesh discover` runs a test with each executor's discovery mode to find
 * the input steps its model does not declare yet. Discovery is an authoring aid and never part of a
 * test run. Only an executor that can find paths declares a discovery mode; today that is the
 * Playwright executor, so discovery covers Web journeys only.
 */

/** Whether a run checks the model (`test`) or finds steps for it (`discovery`). */
export type JourneyRunMode = "test" | "discovery";

/** One step of a discovered path, in the platform-neutral terms of a declared step. */
export type DiscoveredMaterializationStep = Readonly<
  | { kind: "move"; moveKindId: string; locatorId?: string }
  | { kind: "activation"; locatorId?: string }
>;

/**
 * What an executor's discovery mode found for one transition. A found path is a proposal for the
 * author to review and declare in the model; no test run performs it until it is declared.
 */
export type DiscoveredMaterialization = Readonly<{
  testId: string;
  /** The profile combination that executed the transition. */
  profileId: string;
  operationId: string;
  transitionId: string;
  transitionLabel?: string;
  modalityId: string;
  /**
   * `declared`: performed through the materialization the model declares.
   * `found`: `steps` reached the bound object and the transition was taken.
   * `at-target`: text entry into a field that already had focus, which needs no materialization.
   * `not-found`: no path reached the bound object; `note` says why, and the journey stopped there.
   */
  status: "declared" | "found" | "at-target" | "not-found";
  steps?: readonly DiscoveredMaterializationStep[];
  /** The declared materialization a rediscovered path replaces. */
  replaces?: string;
  /** For review: the object focus started at, and the last objects the walk passed. */
  start?: string;
  passed?: readonly string[];
  note?: string;
}>;

/** A finding as an executor reports it; the host adds the test that produced it. */
export type DiscoveryFinding = Omit<DiscoveredMaterialization, "testId">;

/** The host's port for findings. Executors report through it and never write findings themselves. */
export type DiscoveryFindings = Readonly<{ record(finding: DiscoveryFinding): Promise<void> | void }>;

/** What the host gives an executor's discovery mode. */
export type ExecutorDiscoveryInput = Readonly<{
  /** Find a new path also where the model declares one, and name the declared one as replaced. */
  rediscover: boolean;
  findings: DiscoveryFindings;
}>;

/** What declaring one finding in a model document did. */
export type MaterializationWrite = Readonly<{
  transitionId: string;
  modalityId: string;
  /** `removed`: a rediscovered text field already has focus and needs no steps. `kept`: nothing written, `note` says why. */
  outcome: "added" | "replaced" | "removed" | "kept";
  materializationId?: string;
  note?: string;
}>;

/** The result of declaring findings in one model source. */
export type DeclaredMaterializations = Readonly<{
  /** The rewritten source document, when anything changed. The caller decides whether to write it. */
  document?: string;
  writes: readonly MaterializationWrite[];
}>;
