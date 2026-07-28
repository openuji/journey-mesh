import type { JourneyPlan } from "@openuji/journey-execution-model";

import type { ExecutionResult, RunResult } from "../index.js";

export type JourneyComponentDescriptor = {
  readonly name: string;
  readonly version?: string;
};

export type JourneyProfileDescriptor = {
  readonly id: string;
  readonly label?: string;
};

export type JourneyExecutionDescriptor = {
  readonly runId: string;
  readonly executionId: string;
  readonly profile: JourneyProfileDescriptor;
  readonly plan: JourneyPlan;
};

export type JourneyObserver = {
  readonly name: string;
  readonly version?: string;
  onRunStarted?(input: JourneyObserverRunStartedInput): Promise<void> | void;
  onRunCompleted?(input: JourneyObserverRunCompletedInput): Promise<void> | void;
  onExecutionStarted?(input: JourneyObserverExecutionStartedInput): Promise<void> | void;
  onExecutionCompleted?(input: JourneyObserverExecutionCompletedInput): Promise<void> | void;
};

export type JourneyObserverRunStartedInput = {
  readonly runId: string;
  readonly plan: JourneyPlan;
  readonly profiles: readonly JourneyProfileDescriptor[];
  readonly adapter: JourneyComponentDescriptor;
};

export type JourneyObserverRunCompletedInput = {
  readonly result: RunResult;
};

export type JourneyObserverExecutionStartedInput = {
  readonly execution: JourneyExecutionDescriptor;
};

export type JourneyObserverExecutionCompletedInput = {
  readonly execution: JourneyExecutionDescriptor;
  readonly result: ExecutionResult;
};

export function componentDescriptor(
  component: {
    readonly name: string;
    readonly version?: string;
  }
): JourneyComponentDescriptor {
  return {
    name: component.name,
    ...(component.version ? { version: component.version } : {})
  };
}

export function profileDescriptor(
  profile: {
    readonly id: string;
    readonly label?: string;
  }
): JourneyProfileDescriptor {
  return {
    id: profile.id,
    ...(profile.label ? { label: profile.label } : {})
  };
}

export function executionDescriptor(
  context: {
    readonly runId: string;
    readonly executionId: string;
    readonly profile: {
      readonly id: string;
      readonly label?: string;
    };
    readonly plan: JourneyPlan;
  }
): JourneyExecutionDescriptor {
  return {
    runId: context.runId,
    executionId: context.executionId,
    profile: profileDescriptor(context.profile),
    plan: context.plan
  };
}
