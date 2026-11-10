import type {
  InputModalityDecision,
  ResolvedEffect,
  TransitionPlanOperation
} from "@openuji/journey-execution-model";
import type { JourneyExecutionContext } from "../adapters/contracts.js";

export type JourneyEnvironmentTeardownInput = {
  readonly context: JourneyExecutionContext;
  readonly executionFailed: boolean;
};

export type JourneyEffectVerificationInput = {
  readonly context: JourneyExecutionContext;
  readonly operation: TransitionPlanOperation;
  readonly effect: ResolvedEffect;
  readonly decision?: InputModalityDecision;
};

/** Shared service fixtures and checks, independent of automation runtimes. */
export type JourneyEnvironment = {
  setup?(context: JourneyExecutionContext): Promise<void> | void;
  teardown?(input: JourneyEnvironmentTeardownInput): Promise<void> | void;
  verifyEffect?(input: JourneyEffectVerificationInput): Promise<void> | void;
};
