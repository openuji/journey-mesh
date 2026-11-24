import type { JourneyObserverOutput } from "@openuji/journey-core";
import type { JourneyPlan, JourneyPlanOperation } from "@openuji/journey-execution-model";
import type { JourneyAdapter, JourneyEnvironment, JourneyProfile, RunResult } from "@openuji/journey-runner";
import type { JourneyArtifactStore } from "./artifacts.js";
import type { AdapterDiscoveryInput, DeclaredMaterializations, DiscoveredMaterialization, JourneyRunMode } from "./discovery.js";
import type { ObservationPublisher, RuntimeObserver } from "./runtime-observations.js";

/**
 * A named compatibility contract between plugins. The host only compares `id`s;
 * the type parameter types what crosses the contract, so adapters receive typed drivers and observers.
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
   * because the adapter finds them. Absent or `test` everywhere else.
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

export type AdapterDependencies<D = unknown, O = unknown, I = ResolvedInputs> = Readonly<{ driver?: D; observers: readonly O[]; inputs: I }>;

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
 * An adapter's discovery mode, built only in a run of `journey-mesh discover` and never in a test run.
 * It takes the adapter's own settings, so a suite's adapter options apply unchanged; executor observers
 * are not attached. Only adapters that can find paths declare one: today the Playwright (Web) adapter.
 */
export type AdapterDiscovery<S = unknown, D = unknown, O = unknown, I = ResolvedInputs> = Readonly<{
  create(settings: S, context: JourneyPluginContext, dependencies: AdapterDependencies<D, O, I>, discovery: AdapterDiscoveryInput): JourneyAdapter | Promise<JourneyAdapter>;
}>;

export type AdapterPlugin<S = unknown, D = unknown, O = unknown, I = ResolvedInputs> = Plugin<"adapter", S, JourneyAdapter, AdapterDependencies<D, O, I>> & InputDeclarations & {
  /** Observers must declare the same automation. */
  readonly automation: Contract<O>;
  validateOperations?(settings: S, context: JourneyConfigContext, dependencies: Readonly<{ driver?: D }>): void;
  /** Drivers must declare the same contract; omitted when the adapter needs no driver. */
  readonly driverContract?: Contract<D>;
  /** Omitted by adapters that cannot find paths; `journey-mesh discover` rejects tests that use them. */
  readonly discovery?: AdapterDiscovery<S, D, O, I>;
};
export type DriverPlugin<S = unknown, D = unknown> = Plugin<"driver", S, D> & { readonly driverContract: Contract<D> };
export type ObserverPlugin<S = unknown, O = unknown> = Plugin<"observer", S, JourneyObserverComponent<O>> & { readonly automation: Contract<O> };
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
export type JourneyMeshPlugin = AdapterPlugin | DriverPlugin | ObserverPlugin | RuntimeObserverPlugin | ModelPlugin | ProfilePlugin | EnvironmentPlugin | ServicePlugin;
export type JourneyPluginKind = JourneyMeshPlugin["kind"];
export type PluginOfKind<K extends JourneyPluginKind> = Extract<JourneyMeshPlugin, { kind: K }>;

type Contracts = Record<string, Contract<unknown>>;
type DeclaredInputs<R extends Contracts, O extends Contracts> = { readonly inputs?: R; readonly optionalInputs?: O };
export const defineAdapterPlugin = <S, D = unknown, Observer = unknown, R extends Contracts = {}, O extends Contracts = {}>(
  plugin: Omit<AdapterPlugin<S, D, Observer, ResolvedInputs<R, O>>, "inputs" | "optionalInputs"> & DeclaredInputs<R, O>
) => plugin;
export const defineDriverPlugin = <S, D>(plugin: DriverPlugin<S, D>) => plugin;
export const defineObserverPlugin = <S, O>(plugin: ObserverPlugin<S, O>) => plugin;
export const defineRuntimeObserverPlugin = <S>(plugin: RuntimeObserverPlugin<S>) => plugin;
export const defineModelPlugin = <S>(plugin: ModelPlugin<S>) => plugin;
export const defineProfilePlugin = <S>(plugin: ProfilePlugin<S>) => plugin;
export const defineEnvironmentPlugin = <S>(plugin: EnvironmentPlugin<S>) => plugin;
export const defineServicePlugin = <S, R extends Contracts = {}, O extends Contracts = {}>(
  plugin: Omit<ServicePlugin<S, ResolvedInputs<R, O>>, "inputs" | "optionalInputs"> & DeclaredInputs<R, O>
) => plugin;
