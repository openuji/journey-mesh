/** JSON-shaped evidence owned by the observer, detached from runtime inputs. */
export type Immutable<T> = T extends readonly (infer TItem)[]
  ? readonly Immutable<TItem>[]
  : T extends object ? { readonly [TKey in keyof T]: Immutable<T[TKey]> } : T;

export function immutableSnapshot<T>(value: T): Immutable<T> {
  return freezeOwned(structuredClone(value)) as Immutable<T>;
}

function freezeOwned(value: unknown): unknown {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(freezeOwned);
    Object.freeze(value);
  }
  return value;
}
