import type {
  ControlFlowPlanOperation,
  InputModalityDecision,
  JourneyPlanOperation,
  StatePlanOperation,
  TransitionPlanOperation
} from "@openuji/journey-execution-model";

import type {
  JourneyExecutor,
  JourneyExecutorCloseInput,
  JourneyExecutorSession,
  JourneyExecutorSessionInput
} from "./contracts.js";
import { componentDescriptor } from "../observers/contracts.js";

/** Route operations without introducing runtime or model-specific configuration. */
export function routedExecutor(resolve: (operation: JourneyPlanOperation) => JourneyExecutor): JourneyExecutor {
  const cache = new WeakMap<JourneyPlanOperation, JourneyExecutor>();
  const select = (operation: JourneyPlanOperation) => {
    let executor = cache.get(operation);
    if (!executor) { executor = resolve(operation); cache.set(operation, executor); }
    return executor;
  };
  return {
    name: "@openuji/journey-runner/routed-executor",
    version: "0.1.0",
    describeOperation(operation) {
      const executor = select(operation);
      return componentDescriptor(executor.describeOperation?.(operation) ?? executor);
    },
    createSession(input) { return new RoutedExecutorSession(input, select); }
  };
}

class RoutedExecutorSession implements JourneyExecutorSession {
  private readonly executions = new Map<JourneyExecutor, JourneyExecutorSession>();
  private lifecycle: "created" | "starting" | "started" | "closing" | "closed" = "created";

  constructor(
    private readonly input: JourneyExecutorSessionInput,
    private readonly resolve: (operation: JourneyPlanOperation) => JourneyExecutor
  ) {}

  async start(): Promise<void> {
    if (this.lifecycle !== "created") {
      throw new Error(`Routed executor execution cannot start from ${this.lifecycle}`);
    }
    this.lifecycle = "starting";

    // Resolve the whole plan before allocating resources or running fixture setup.
    const executors = new Set(
      this.input.context.plan.operations.map((operation) => this.resolve(operation))
    );
    for (const executor of executors) {
      this.input.context.signal?.throwIfAborted();
      const execution = executor.createSession(this.input);
      // Track before start so partially allocated runtimes are also closed.
      this.executions.set(executor, execution);
      await execution.start();
    }
    this.input.context.signal?.throwIfAborted();
    this.lifecycle = "started";
  }

  async openEntry(operation: JourneyPlanOperation): Promise<void> {
    await this.executionForOperation(operation).openEntry(operation);
  }

  async assertState(operation: StatePlanOperation): Promise<void> {
    await this.executionForOperation(operation).assertState(operation);
  }

  async performTransition(
    operation: TransitionPlanOperation,
    decision?: InputModalityDecision
  ): Promise<void> {
    await this.executionForOperation(operation).performTransition(operation, decision);
  }

  async recordControlFlow(operation: ControlFlowPlanOperation): Promise<void> {
    await this.executionForOperation(operation).recordControlFlow(operation);
  }

  async close(input: JourneyExecutorCloseInput): Promise<void> {
    if (this.lifecycle === "closing" || this.lifecycle === "closed") return;
    this.lifecycle = "closing";
    const failures: unknown[] = [];

    for (const execution of [...this.executions.values()].reverse()) {
      try {
        await execution.close(input);
      } catch (error) {
        failures.push(error);
      }
    }
    this.executions.clear();
    this.lifecycle = "closed";

    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
      const messages = failures.map((error) => error instanceof Error ? error.message : String(error));
      throw new AggregateError(failures, `Routed executor cleanup failed: ${messages.join("; ")}`);
    }
  }

  private executionForOperation(operation: JourneyPlanOperation): JourneyExecutorSession {
    if (this.lifecycle !== "started") {
      throw new Error(`Routed executor execution is not started (${this.lifecycle})`);
    }
    const executor = this.resolve(operation);
    const execution = this.executions.get(executor);
    if (!execution) {
      throw new Error(`Executor ${executor.name} was not started for touchpoint ${operation.touchpointId}`);
    }
    return execution;
  }
}

