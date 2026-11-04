import type {
  ControlFlowPlanOperation,
  InputModalityDecision,
  JourneyPlanOperation,
  StatePlanOperation,
  TransitionPlanOperation
} from "@openuji/journey-execution-model";

import type {
  JourneyAdapter,
  JourneyAdapterCloseInput,
  JourneyAdapterExecution,
  JourneyAdapterExecutionInput
} from "./contracts.js";
import { componentDescriptor } from "../observers/contracts.js";

/** Route operations without introducing runtime or model-specific configuration. */
export function routedAdapter(resolve: (operation: JourneyPlanOperation) => JourneyAdapter): JourneyAdapter {
  const cache = new WeakMap<JourneyPlanOperation, JourneyAdapter>();
  const select = (operation: JourneyPlanOperation) => {
    let adapter = cache.get(operation);
    if (!adapter) { adapter = resolve(operation); cache.set(operation, adapter); }
    return adapter;
  };
  return {
    name: "@openuji/journey-runner/routed-adapter",
    version: "0.1.0",
    describeOperation(operation) {
      const adapter = select(operation);
      return componentDescriptor(adapter.describeOperation?.(operation) ?? adapter);
    },
    createExecution(input) { return new RoutedAdapterExecution(input, select); }
  };
}

class RoutedAdapterExecution implements JourneyAdapterExecution {
  private readonly executions = new Map<JourneyAdapter, JourneyAdapterExecution>();
  private lifecycle: "created" | "starting" | "started" | "closing" | "closed" = "created";

  constructor(
    private readonly input: JourneyAdapterExecutionInput,
    private readonly resolve: (operation: JourneyPlanOperation) => JourneyAdapter
  ) {}

  async start(): Promise<void> {
    if (this.lifecycle !== "created") {
      throw new Error(`Routed adapter execution cannot start from ${this.lifecycle}`);
    }
    this.lifecycle = "starting";

    // Resolve the whole plan before allocating resources or running fixture setup.
    const adapters = new Set(
      this.input.context.plan.operations.map((operation) => this.resolve(operation))
    );
    for (const adapter of adapters) {
      this.input.context.signal?.throwIfAborted();
      const execution = adapter.createExecution(this.input);
      // Track before start so partially allocated runtimes are also closed.
      this.executions.set(adapter, execution);
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

  async close(input: JourneyAdapterCloseInput): Promise<void> {
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
      throw new AggregateError(failures, `Routed adapter cleanup failed: ${messages.join("; ")}`);
    }
  }

  private executionForOperation(operation: JourneyPlanOperation): JourneyAdapterExecution {
    if (this.lifecycle !== "started") {
      throw new Error(`Routed adapter execution is not started (${this.lifecycle})`);
    }
    const adapter = this.resolve(operation);
    const execution = this.executions.get(adapter);
    if (!execution) {
      throw new Error(`Adapter ${adapter.name} was not started for touchpoint ${operation.touchpointId}`);
    }
    return execution;
  }
}

