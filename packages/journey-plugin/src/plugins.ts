import type { JourneyObserverOutput } from "@openuji/journey-core";
import type { JourneyPlan, JourneyPlanOperation } from "@openuji/journey-execution-model";
import type { JourneyAdapter, JourneyEnvironment, JourneyProfile, RunResult } from "@openuji/journey-runner";
import type { JourneyArtifactStore } from "./artifacts.js";
import type { JourneyReporter } from "./results.js";

export type JourneyPluginContext = {
  readonly artifacts: JourneyArtifactStore;
  readonly configPath: string;
  /** The test a component belongs to, or `suite` / `service` for suite-wide components. */
  readonly testId: string;
  /** The operations this component will see: an adapter's own segments, or the whole test plan. */
  readonly operations: readonly JourneyPlanOperation[];
  readonly env: Readonly<Record<string, string | undefined>>;
  resolvePath(path: string): string;
  /** Resolve a configured `<journey item>.<alias>` or a plan operation ID of this test. */
  resolveOperation(reference: string): JourneyPlanOperation;
};

/**
 * A named compatibility contract between plugins. The host only compares `id`s;
 * the type parameter types what crosses the contract, so adapters receive typed drivers and observers.
 */
export type Contract<T> = Readonly<{ id: string; readonly __type?: T }>;
export function contract<T>(id: string): Contract<T> {
  return Object.freeze({ id });
}

/** Infrastructure a test needs (a server stack, an emulator, an Appium server), managed independently of executions. */
export type JourneyService = {
  readonly name: string;
  up(input?: { signal?: AbortSignal }): Promise<void>;
  down?(): Promise<void>;
  /** Identity of what the service provided, recorded in the suite bundle. Must not contain credentials. */
  provenance?(): unknown;
};

export type JourneyModelCompiler = {
  compile(source: string, selection: string): Promise<JourneyPlan>;
  resolveOperation(plan: Pick<JourneyPlan, "id" | "operations">, selector: string): JourneyPlanOperation;
};

export type JourneyObserverComponent<O = unknown> = {
  observer: O;
  output(input: { result: RunResult }): JourneyObserverOutput | Promise<JourneyObserverOutput>;
};

export type AdapterDependencies<D = unknown, O = unknown> = { driver?: D; observers: readonly O[] };

/**
 * `parse` validates raw options into settings; `create` builds the component from them.
 * Neither may allocate automation resources or mutate services: `journey-mesh validate` calls both.
 */
type Plugin<K extends string, S, T, D = Record<never, never>> = {
  readonly kind: K;
  parse(options: Record<string, unknown>, context: JourneyPluginContext): S | Promise<S>;
  create(settings: S, context: JourneyPluginContext, dependencies: D): T | Promise<T>;
};

export type AdapterPlugin<S = unknown, D = unknown, O = unknown> = Plugin<"adapter", S, JourneyAdapter, AdapterDependencies<D, O>> & {
  /** Observers must declare the same automation. */
  readonly automation: Contract<O>;
  /** Drivers must declare the same contract; omitted when the adapter needs no driver. */
  readonly driverContract?: Contract<D>;
};
export type DriverPlugin<S = unknown, D = unknown> = Plugin<"driver", S, D> & { readonly driverContract: Contract<D> };
export type ObserverPlugin<S = unknown, O = unknown> = Plugin<"observer", S, JourneyObserverComponent<O>> & { readonly automation: Contract<O> };
export type ModelPlugin<S = unknown> = Plugin<"model", S, JourneyModelCompiler>;
export type ProfilePlugin<S = unknown> = Plugin<"profile", S, JourneyProfile>;
export type EnvironmentPlugin<S = unknown> = Plugin<"environment", S, JourneyEnvironment>;
export type ServicePlugin<S = unknown> = Plugin<"service", S, JourneyService>;
export type ReporterPlugin<S = unknown> = Plugin<"reporter", S, JourneyReporter>;

/** What a module exports as `journeyMeshPlugin`. */
export type JourneyMeshPlugin = AdapterPlugin | DriverPlugin | ObserverPlugin | ModelPlugin | ProfilePlugin | EnvironmentPlugin | ServicePlugin | ReporterPlugin;
export type JourneyPluginKind = JourneyMeshPlugin["kind"];
export type PluginOfKind<K extends JourneyPluginKind> = Extract<JourneyMeshPlugin, { kind: K }>;

export const defineAdapterPlugin = <S, D = unknown, O = unknown>(plugin: AdapterPlugin<S, D, O>) => plugin;
export const defineDriverPlugin = <S, D>(plugin: DriverPlugin<S, D>) => plugin;
export const defineObserverPlugin = <S, O>(plugin: ObserverPlugin<S, O>) => plugin;
export const defineModelPlugin = <S>(plugin: ModelPlugin<S>) => plugin;
export const defineProfilePlugin = <S>(plugin: ProfilePlugin<S>) => plugin;
export const defineEnvironmentPlugin = <S>(plugin: EnvironmentPlugin<S>) => plugin;
export const defineServicePlugin = <S>(plugin: ServicePlugin<S>) => plugin;
export const defineReporterPlugin = <S>(plugin: ReporterPlugin<S>) => plugin;
