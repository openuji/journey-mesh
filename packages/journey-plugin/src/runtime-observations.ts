import type { Immutable } from "@openuji/journey-core";
import { contract, type Contract } from "./plugins.js";

export type RuntimeObservation<T> = Readonly<{ topic: string; source: string; timestamp: string; value: Immutable<T> }>;
export type ObservationPublisher = {
  /**
   * Await bounded delivery before the producer proceeds, including resource disposal. The host stamps
   * the source and caps every subscriber's deadline; with no subscribers, publishing does nothing.
   */
  publish<T>(topic: Contract<T>, value: T): Promise<void>;
};
/** The only port a runtime observer receives: it can subscribe, never publish or close the run's observable. */
export type RuntimeObservationSource = {
  /** `timeoutMs` is a request; the host never waits longer than the suite's `runtimeObserverTimeoutMs`. */
  subscribe<T>(topic: Contract<T>, observe: (event: RuntimeObservation<T>, signal: AbortSignal) => Promise<void> | void,
    options: Readonly<{ name: string; timeoutMs?: number }>): () => void;
};

/**
 * Published by the host for every service a run starts, under the source `services.<key>`.
 * `failed` ends whichever of starting or releasing was under way.
 */
export type ServiceLifecycleObservation = Readonly<{ phase: "starting" | "ready" | "failed" | "releasing" | "released" }>;
export const serviceLifecycle = contract<ServiceLifecycleObservation>("@openuji/service-lifecycle/v1");

/** Capture infrastructure evidence and report progress, independently of journey assessment and policy observers. */
export type RuntimeObserver = {
  start(source: RuntimeObservationSource): Promise<void> | void;
  close(): Promise<void> | void;
};
