/**
 * Executor observers as the host runs them. They only observe: what one throws during a run is recorded
 * against the test and never reaches the executor, so it cannot change what the run does.
 */
import type { JourneyObserverComponent } from "@openuji/journey-plugin";
import { errorToJourneyRunError, type JourneyRunError } from "@openuji/journey-runner";

export type IsolatedObserverComponent = JourneyObserverComponent & Readonly<{
  /** What the observer threw while the run called it, oldest first. */
  thrown(): readonly JourneyRunError[];
}>;

/** `label` names the observer in what is recorded. */
export function isolateObserver(component: JourneyObserverComponent, label: string): IsolatedObserverComponent {
  const errors: JourneyRunError[] = [];
  const record = (method: PropertyKey, thrown: unknown) => {
    const error = errorToJourneyRunError(thrown);
    errors.push(Object.freeze({ ...error, message: `Observer ${label} threw in ${String(method)}: ${error.message}` }));
  };
  return Object.freeze({
    observer: guarded(component.observer, record),
    output: (input: Parameters<JourneyObserverComponent["output"]>[0]) => component.output(input),
    thrown: () => Object.freeze([...errors])
  });
}

/**
 * `observer` with every method guarded, whatever its observation contract names them. Observer methods
 * are notifications: a failed one returns nothing, as a successful one does.
 */
function guarded(observer: unknown, failed: (method: PropertyKey, error: unknown) => void): unknown {
  if (typeof observer !== "object" || observer === null) return observer;
  // A new object in front of the observer, so a frozen observer can be guarded too.
  return new Proxy(Object.create(observer) as object, {
    get(_, key) {
      const value: unknown = Reflect.get(observer, key);
      if (typeof value !== "function") return value;
      return (...input: unknown[]) => {
        try {
          const result: unknown = Reflect.apply(value, observer, input);
          return isThenable(result) ? Promise.resolve(result).catch((error: unknown) => failed(key, error)) : result;
        } catch (error) {
          failed(key, error);
          return undefined;
        }
      };
    }
  });
}

const isThenable = (value: unknown): value is PromiseLike<unknown> => typeof (value as PromiseLike<unknown> | null | undefined)?.then === "function";
