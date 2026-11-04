import { executionDescriptor, type JourneyAdapter, type JourneyAdapterExecution, type JourneyAdapterExecutionInput } from "@openuji/journey-runner";
import type { AppiumConnection, AppiumExecutionObserver, AppiumJourneyDriver, AppiumJourneyDriverExecution, AppiumOperationObservation, AppiumSession, AppiumSessionFactory } from "./contracts.js";
import { appiumCommandForModality, appiumObservationQuery } from "./queries.js";
import { createWebdriverIoSession } from "./session.js";

export type * from "./contracts.js";
export { appiumCommandForModality, appiumLocatorQuery, appiumObservationQuery, touchTapInputModalityId, xpathLiteral } from "./queries.js";
export type { AppiumInteractionCommand } from "./queries.js";
export const appiumAdapterName = "@openuji/journey-adapter-appium";

export type AppiumAdapterOptions = Readonly<{
  driver: AppiumJourneyDriver;
  connection?: AppiumConnection;
  sessionFactory?: AppiumSessionFactory;
  executionObservers?: readonly AppiumExecutionObserver[];
  assertionTimeoutMs?: number;
  pollIntervalMs?: number;
}>;

export function appiumAdapter(options: AppiumAdapterOptions): JourneyAdapter {
  return {
    name: appiumAdapterName,
    version: "0.1.0",
    describeOperation(operation) {
      // Routing calls this only for our operations, before shared service setup.
      if (operation.kind === "state") {
        if (!Number.isInteger(operation.target.expectedMatchCount) || operation.target.expectedMatchCount < 0) {
          throw new Error(`Invalid native match count ${operation.target.expectedMatchCount}`);
        }
        appiumObservationQuery(operation.target.bindings);
      } else if (operation.kind === "transition" && operation.activation.requiredInputModalityProfiles.length > 0) {
        appiumObservationQuery(operation.activation.bindings);
      }
      return { name: appiumAdapterName, version: "0.1.0" };
    },
    createExecution: (input) => new AppiumExecution(input, options)
  };
}

class AppiumExecution implements JourneyAdapterExecution {
  private lifecycle: "created" | "starting" | "started" | "closing" | "closed" = "created";
  private readonly sessions: AppiumSession[] = [];
  private driver?: AppiumJourneyDriverExecution;
  private readonly execution;

  constructor(private readonly input: JourneyAdapterExecutionInput, private readonly options: AppiumAdapterOptions) {
    this.execution = executionDescriptor(input.context);
  }
  async start(): Promise<void> {
    if (this.lifecycle !== "created") throw new Error(`Appium execution cannot start from ${this.lifecycle}`);
    this.lifecycle = "starting";
    for (const observer of this.options.executionObservers ?? []) await observer.onExecutionStarted?.({ execution: this.execution });
    this.driver = this.options.driver.createExecution({ context: {
      ...this.input.context,
      createSession: async (options) => {
        if (!["starting", "started"].includes(this.lifecycle)) throw new Error("Appium execution is not open");
        const session = await (this.options.sessionFactory ?? createWebdriverIoSession)({ ...this.options.connection, ...options });
        if (this.input.context.signal?.aborted) {
          await session.close();
          this.input.context.signal.throwIfAborted();
        }
        // Ownership is established before application login or observer collection.
        if (!this.sessions.includes(session)) this.sessions.push(session);
        return session;
      }
    } });
    await this.driver.start();
    this.input.context.signal?.throwIfAborted();
    this.lifecycle = "started";
  }
  async openEntry(operation: Parameters<JourneyAdapterExecution["openEntry"]>[0]): Promise<void> {
    await this.requireDriver().openEntry(operation);
  }
  async assertState(operation: Parameters<JourneyAdapterExecution["assertState"]>[0]): Promise<void> {
    const query = appiumObservationQuery(operation.target.bindings);
    const session = await this.requireDriver().sessionForOperation(operation);
    const targets = await this.assertCount(session, query, operation.target.expectedMatchCount);
    await this.observe({ execution: this.execution, stage: "state-asserted", operation, session, targets, expectedMatchCount: operation.target.expectedMatchCount });
  }
  async performTransition(...[operation, decision]: Parameters<JourneyAdapterExecution["performTransition"]>): Promise<void> {
    const driver = this.requireDriver();
    if (!decision) {
      if (operation.activation.requiredInputModalityProfiles.length > 0) throw new Error(`Transition ${operation.transition.id} requires an input modality decision`);
      await driver.afterTransition(operation);
      await this.observe({ execution: this.execution, stage: "transition-completed", operation });
      return;
    }
    const command = appiumCommandForModality(decision.modality.id);
    const query = appiumObservationQuery(operation.activation.bindings);
    const session = await driver.sessionForOperation(operation);
    const targets = await this.assertCount(session, query, 1);
    await this.observe({ execution: this.execution, stage: "transition-ready", operation, session, targets, decision, expectedMatchCount: 1 });
    this.input.context.signal?.throwIfAborted();
    switch (command) {
      case "tap": await session.tap(targets[0]!.elementId); break;
      default: assertNever(command);
    }
    this.input.context.signal?.throwIfAborted();
    await driver.afterTransition(operation, decision);
  }
  async recordControlFlow(operation: Parameters<JourneyAdapterExecution["recordControlFlow"]>[0]): Promise<void> {
    await this.requireDriver().recordControlFlow(operation);
    await this.observe({ execution: this.execution, stage: "control-flow-recorded", operation });
  }
  async close(input: Parameters<JourneyAdapterExecution["close"]>[0]): Promise<void> {
    if (this.lifecycle === "closed" || this.lifecycle === "closing") return;
    this.lifecycle = "closing";
    const errors: unknown[] = [];
    try { await this.driver?.close(input); } catch (error) { errors.push(error); }
    for (const session of [...this.sessions].reverse()) {
      try { await session.close(); } catch (error) { errors.push(error); }
    }
    this.sessions.length = 0;
    this.lifecycle = "closed";
    if (errors.length) throw new AggregateError(errors, `Appium cleanup failed: ${errors.map((error) => error instanceof Error ? error.message : String(error)).join("; ")}`);
  }
  private requireDriver(): AppiumJourneyDriverExecution {
    this.input.context.signal?.throwIfAborted();
    if (this.lifecycle !== "started" || !this.driver) throw new Error(`Appium execution is not started (${this.lifecycle})`);
    return this.driver;
  }
  private async assertCount(session: AppiumSession, query: string, expected: number) {
    if (!Number.isInteger(expected) || expected < 0) throw new Error(`Invalid native match count ${expected}`);
    const deadline = Date.now() + (this.options.assertionTimeoutMs ?? 30_000);
    do {
      this.input.context.signal?.throwIfAborted();
      const found = await session.findElements(query);
      this.input.context.signal?.throwIfAborted();
      const unique = Object.freeze(found.filter((item, index) => found.findIndex((other) => other.elementId === item.elementId) === index));
      if (unique.length === expected) return unique;
      if (Date.now() >= deadline) throw new Error(`Native locator expected ${expected} matches, found ${unique.length}: ${query}`);
      await new Promise((resolve) => setTimeout(resolve, this.options.pollIntervalMs ?? 250));
    } while (true);
  }
  private async observe(observation: AppiumOperationObservation): Promise<void> {
    for (const observer of this.options.executionObservers ?? []) {
      this.input.context.signal?.throwIfAborted();
      await observer.observeOperation?.(observation);
    }
  }
}

function assertNever(command: never): never {
  throw new Error(`Unhandled Appium command ${command}`);
}
