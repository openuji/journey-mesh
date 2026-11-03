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

export type JourneyTouchpointAdapters = Readonly<Record<string, JourneyAdapter>>;

/** Compose adapters by exact touchpoint id without coupling the runner to a runtime. */
export function touchpointAdapter(adapters: JourneyTouchpointAdapters): JourneyAdapter {
  const routes = new Map(Object.entries(adapters));
  if (routes.size === 0) {
    throw new Error("touchpointAdapter requires at least one touchpoint adapter");
  }

  return {
    name: "@openuji/journey-runner/touchpoint-adapter",
    version: "0.1.0",
    describeOperation(operation) {
      const adapter = adapterForOperation(routes, operation);
      return componentDescriptor(adapter.describeOperation?.(operation) ?? adapter);
    },
    createExecution(input) {
      return new TouchpointAdapterExecution(input, routes);
    }
  };
}

class TouchpointAdapterExecution implements JourneyAdapterExecution {
  private readonly executions = new Map<JourneyAdapter, JourneyAdapterExecution>();
  private lifecycle: "created" | "starting" | "started" | "closing" | "closed" = "created";

  constructor(
    private readonly input: JourneyAdapterExecutionInput,
    private readonly routes: ReadonlyMap<string, JourneyAdapter>
  ) {}

  async start(): Promise<void> {
    if (this.lifecycle !== "created") {
      throw new Error(`Touchpoint adapter execution cannot start from ${this.lifecycle}`);
    }
    this.lifecycle = "starting";

    // Resolve the whole plan before allocating resources or running fixture setup.
    const adapters = new Set(
      this.input.context.plan.operations.map((operation) => adapterForOperation(this.routes, operation))
    );
    for (const adapter of adapters) {
      const execution = adapter.createExecution(this.input);
      // Track before start so partially allocated runtimes are also closed.
      this.executions.set(adapter, execution);
      await execution.start();
    }
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
      throw new AggregateError(failures, `Touchpoint adapter cleanup failed: ${messages.join("; ")}`);
    }
  }

  private executionForOperation(operation: JourneyPlanOperation): JourneyAdapterExecution {
    if (this.lifecycle !== "started") {
      throw new Error(`Touchpoint adapter execution is not started (${this.lifecycle})`);
    }
    const adapter = adapterForOperation(this.routes, operation);
    const execution = this.executions.get(adapter);
    if (!execution) {
      throw new Error(`Adapter ${adapter.name} was not started for touchpoint ${operation.touchpointId}`);
    }
    return execution;
  }
}

function adapterForOperation(
  routes: ReadonlyMap<string, JourneyAdapter>,
  operation: JourneyPlanOperation
): JourneyAdapter {
  const adapter = routes.get(operation.touchpointId);
  if (!adapter) {
    throw new Error(`No adapter for touchpoint ${operation.touchpointId} (operation ${operation.id})`);
  }
  return adapter;
}
