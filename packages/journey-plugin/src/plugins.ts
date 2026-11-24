import type { JourneyObserverOutput } from "@openuji/journey-core";
import type { JourneyPlan, JourneyPlanOperation } from "@openuji/journey-execution-model";
import type { JourneyExecutor, JourneyEnvironment, JourneyProfile, RunResult } from "@openuji/journey-runner";
import type { JourneyArtifactStore } from "./artifacts.js";
import type { ExecutorDiscoveryInput, DeclaredMaterializations, DiscoveredMaterialization, JourneyRunMode } from "./discovery.js";
import type { ObservationPublisher, RuntimeObserver } from "./runtime-observations.js";

/**
 * A named compatibility contract between plugins. The host only compares `id`s;
 * the type parameter types what crosses the contract, so executors receive typed clients and observers.
 */
export type Contract<T> = Readonly<{ id: string; readonly __type?: T }>;
export function contract<T>(id: string): Contract<T> {
  return Object.freeze({ id });
}

/** Configuration-only context. Parsing cannot write evidence or access runtime inputs. */
export type JourneyConfigContext = {
  readonly configPath: string;
  readonly testId: string;
  readonly operations: readonly JourneyPlanOperation[];
  readonly env: Readonly<Record<string, string | undefined>>;
  /**
   * `discovery` in a run of `journey-mesh discover`, where transitions may lack declared steps
   * because the executor finds them. Absent or `test` everywhere else.
   */
  readonly mode?: JourneyRunMode;
  resolvePath(path: string): string;
  resolveOperation(reference: string): JourneyPlanOperation;
};

/** Runtime ports belong to the component being constructed, never to input lookup. */
export type JourneyPluginContext = JourneyConfigContext & {
  readonly artifacts: JourneyArtifactStore;
  /** The single publishing channel for runtime observations, under this component's host-assigned source. */
  readonly observations: ObservationPublisher;
  /** Stable within a configuration; separates persistent ownership of different services. */
  readonly componentId: string;
};
export type InputDeclarations = {
  readonly inputs?: Readonly<Record<string, Contract<unknown>>>;
  readonly optionalInputs?: Readonly<Record<string, Contract<unknown>>>;
};
type ContractValue<C> = C extends Contract<infer T> ? T : never;
export type ResolvedInputs<R extends Record<string, Contract<unknown>> = Record<string, Contract<unknown>>, O extends Record<string, Contract<unknown>> = {}> =
  Readonly<{ [K in keyof R]: ContractValue<R[K]> } & { [K in keyof O]?: ContractValue<O[K]> }>;
export type InputMetadata = Readonly<{ names: readonly string[] }>;
export type ServiceDependencies<I = ResolvedInputs> = Readonly<{ inputs: I }>;

/** A successful acquisition. Producers compensate partial failures before throwing. */
export type StartedService = Readonly<{
  outputs: Readonly<Record<string, unknown>>;
  provenance?: unknown;
  release(): Promise<void>;
}>;
export type JourneyService = Readonly<{
  name: string;
  start(input: Readonly<{ signal?: AbortSignal }>): Promise<StartedService>;
}>;

/** A snapshot of the model document behind a journey source (e.g. format `journey-map`), recorded with the run. */
export type JourneyModelView = Readonly<{ format: string; document: unknown }>;

export type JourneyModelCompiler = {
  compile(source: string, selection: string): Promise<JourneyPlan>;
  resolveOperation(plan: Pick<JourneyPlan, "id" | "operations">, selector: string): JourneyPlanOperation;
  /** The model document behind `source`, if the model has one, so consumers need no model sources. Read-only; called during preparation. */
  view?(source: string): Promise<JourneyModelView | undefined>;
  /**
   * Declare reviewed discovery findings in the model document at `source` (`journey-mesh discover --apply`).
   * Returns the rewritten document instead of writing it. A model without it cannot take discovered steps.
   */
  declareMaterializations?(source: string, found: readonly DiscoveredMaterialization[]): Promise<DeclaredMaterializations>;
};

export type JourneyObserverComponent<O = unknown> = {
  observer: O;
  output(input: { result: RunResult }): JourneyObserverOutput | Promise<JourneyObserverOutput>;
};

export type ExecutorDependencies<C = unknown, O = unknown, I = ResolvedInputs> = Readonly<{ client?: C; observers: readonly O[]; inputs: I }>;

/**
 * `parse` validates raw options into settings; `create` builds the component from them.
 * Parsing and operation validation run before startup. Construction is resource-free and receives resolved inputs only at runtime.
 */
type Plugin<K extends string, S, T, D = undefined> = {
  readonly kind: K;
  parse(options: Record<string, unknown>, context: JourneyConfigContext, metadata?: InputMetadata): S | Promise<S>;
  create: D extends undefined ? (settings: S, context: JourneyPluginContext) => T | Promise<T> : (settings: S, context: JourneyPluginContext, dependencies: D) => T | Promise<T>;
};

/**
 * An executor's discovery mode, built only in a run of `journey-mesh discover` and never in a test run.
 * It takes the executor's own settings, so a suite's executor options apply unchanged; executor observers
 * are not attached. Only executors that can find paths declare one: today the Playwright (Web) executor.
 */
export type ExecutorDiscovery<S = unknown, C = unknown, O = unknown, I = ResolvedInputs> = Readonly<{
  create(settings: S, context: JourneyPluginContext, dependencies: ExecutorDependencies<C, O, I>, discovery: ExecutorDiscoveryInput): JourneyExecutor | Promise<JourneyExecutor>;
}>;

export type ExecutorPlugin<S = unknown, C = unknown, O = unknown, I = ResolvedInputs> = Plugin<"executor", S, JourneyExecutor, ExecutorDependencies<C, O, I>> & InputDeclarations & {
  /** The observation contract this executor publishes; its executor observers must declare the same one. */
  readonly observationContract: Contract<O>;
  validateOperations?(settings: S, context: JourneyConfigContext, dependencies: Readonly<{ client?: C }>): void;
  /** Clients must declare the same contract; omitted when the executor needs no client. */
  readonly clientContract?: Contract<C>;
  /** Omitted by executors that cannot find paths; `journey-mesh discover` rejects tests that use them. */
  readonly discovery?: ExecutorDiscovery<S, C, O, I>;
};
export type ClientPlugin<S = unknown, C = unknown> = Plugin<"client", S, C> & { readonly clientContract: Contract<C> };
/** Attached to an executor; implements the observation contract that executor publishes. */
export type ExecutorObserverPlugin<S = unknown, O = unknown> = Plugin<"executor-observer", S, JourneyObserverComponent<O>> & { readonly observationContract: Contract<O> };
export type RuntimeObserverPlugin<S = unknown> = Plugin<"runtime-observer", S, RuntimeObserver>;
export type ModelPlugin<S = unknown> = Plugin<"model", S, JourneyModelCompiler>;
export type ProfilePlugin<S = unknown> = Plugin<"profile", S, JourneyProfile>;
export type EnvironmentPlugin<S = unknown> = Plugin<"environment", S, JourneyEnvironment>;
export type ServicePlugin<S = unknown, I = ResolvedInputs> = Plugin<"service", S, JourneyService, ServiceDependencies<I>> & InputDeclarations & {
  /** Explicit CLI shutdown reads persisted ownership, never fabricated runtime inputs. */
  stopConfigured?(context: JourneyPluginContext): Promise<void>;
  readonly outputs?: Readonly<Record<string, Contract<unknown>>>;
};

/** What a module exports as `journeyMeshPlugin`. */
export type JourneyMeshPlugin = ExecutorPlugin | ClientPlugin | ExecutorObserverPlugin | RuntimeObserverPlugin | ModelPlugin | ProfilePlugin | EnvironmentPlugin | ServicePlugin;
export type JourneyPluginKind = JourneyMeshPlugin["kind"];
export type PluginOfKind<K extends JourneyPluginKind> = Extract<JourneyMeshPlugin, { kind: K }>;

type Contracts = Record<string, Contract<unknown>>;
type DeclaredInputs<R extends Contracts, O extends Contracts> = { readonly inputs?: R; readonly optionalInputs?: O };
export const defineExecutorPlugin = <S, C = unknown, Observer = unknown, R extends Contracts = {}, O extends Contracts = {}>(
  plugin: Omit<ExecutorPlugin<S, C, Observer, ResolvedInputs<R, O>>, "inputs" | "optionalInputs"> & DeclaredInputs<R, O>
) => plugin;
export const defineClientPlugin = <S, C>(plugin: ClientPlugin<S, C>) => plugin;
export const defineExecutorObserverPlugin = <S, O>(plugin: ExecutorObserverPlugin<S, O>) => plugin;
export const defineRuntimeObserverPlugin = <S>(plugin: RuntimeObserverPlugin<S>) => plugin;
export const defineModelPlugin = <S>(plugin: ModelPlugin<S>) => plugin;
export const defineProfilePlugin = <S>(plugin: ProfilePlugin<S>) => plugin;
export const defineEnvironmentPlugin = <S>(plugin: EnvironmentPlugin<S>) => plugin;
export const defineServicePlugin = <S, R extends Contracts = {}, O extends Contracts = {}>(
  plugin: Omit<ServicePlugin<S, ResolvedInputs<R, O>>, "inputs" | "optionalInputs"> & DeclaredInputs<R, O>
) => plugin;
