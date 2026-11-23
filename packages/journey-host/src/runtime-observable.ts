import { immutableSnapshot } from "@openuji/journey-core";
import type { Contract, ObservationPublisher, RuntimeObservation, RuntimeObservationSource } from "@openuji/journey-plugin";

export type RuntimeObservationFailure = Readonly<{ topic: string; source: string; observer: string; message: string }>;
/** Host-only. Plugins receive a publisher or the subscribe-only `source`, never this object. */
export type RuntimeObservable = Readonly<{
  /** A frozen facade exposing nothing but `subscribe`. */
  source: RuntimeObservationSource;
  publisher(source: string): ObservationPublisher;
  readonly failures: readonly RuntimeObservationFailure[];
  close(): void;
}>;

type Subscription = {
  topic: string; name: string; timeoutMs: number; capped: boolean;
  observe: (event: RuntimeObservation<unknown>, signal: AbortSignal) => Promise<void> | void;
};

/**
 * A run-scoped awaited observable; delivery and failures stay local to its owner. `maxDeliveryMs` belongs to
 * the owner, not to subscribers: a subscriber may ask for less, never for more, so it cannot hold back disposal.
 */
export function createRuntimeObservable(maxDeliveryMs: number): RuntimeObservable {
  if (!Number.isFinite(maxDeliveryMs) || maxDeliveryMs <= 0) throw new Error("Observation deadline must be positive");
  const subscriptions = new Set<Subscription>();
  const failures: RuntimeObservationFailure[] = [];
  let closed = false;
  const source: RuntimeObservationSource = Object.freeze({
    subscribe<T>(topic: Contract<T>, observe: (event: RuntimeObservation<T>, signal: AbortSignal) => Promise<void> | void,
      options: Readonly<{ name: string; timeoutMs?: number }>) {
      if (closed) throw new Error("Runtime observable is closed");
      const requested = options.timeoutMs ?? maxDeliveryMs;
      if (!Number.isFinite(requested) || requested <= 0) throw new Error("Observation timeout must be positive");
      const subscription: Subscription = { topic: topic.id, name: options.name, timeoutMs: Math.min(requested, maxDeliveryMs),
        capped: requested > maxDeliveryMs, observe: observe as Subscription["observe"] };
      subscriptions.add(subscription);
      return () => { subscriptions.delete(subscription); };
    }
  });
  return Object.freeze({
    source,
    publisher(name: string): ObservationPublisher {
      return Object.freeze({
        async publish<T>(topic: Contract<T>, value: T) {
          if (closed) return;
          const listeners = [...subscriptions].filter((subscription) => subscription.topic === topic.id);
          if (!listeners.length) return;
          let event: RuntimeObservation<unknown>;
          try { event = immutableSnapshot({ topic: topic.id, source: name, timestamp: new Date().toISOString(), value }); }
          catch (error) {
            failures.push(Object.freeze({ topic: topic.id, source: name, observer: "publisher", message: `Invalid observation: ${String(error)}` }));
            return;
          }
          await Promise.all(listeners.map(async (subscription) => {
            const controller = new AbortController();
            let timer: ReturnType<typeof setTimeout> | undefined;
            try {
              const timeout = new Promise<never>((_resolve, reject) => {
                timer = setTimeout(() => {
                  const limit = subscription.capped ? `the suite's runtimeObserverTimeoutMs of ${subscription.timeoutMs}ms` : `${subscription.timeoutMs}ms`;
                  const error = new Error(`Observation exceeded ${limit}`);
                  controller.abort(error); reject(error);
                }, subscription.timeoutMs);
              });
              await Promise.race([Promise.resolve().then(() => subscription.observe(event, controller.signal)), timeout]);
            } catch (error) {
              failures.push(Object.freeze({ topic: topic.id, source: name, observer: subscription.name,
                message: error instanceof Error ? error.message : String(error) }));
            } finally { clearTimeout(timer); }
          }));
        }
      });
    },
    get failures() { return Object.freeze([...failures]); },
    close() { closed = true; subscriptions.clear(); }
  });
}
