export type PlaywrightLifecycleStatus = "created" | "starting" | "started" | "closing" | "closed";

export type PlaywrightResource = Readonly<{
  id: string;
  kind: "browser" | "context" | "session";
  value: unknown;
  close?: () => Promise<void> | void;
}>;

export type PlaywrightLifecycleState = Readonly<{
  status: PlaywrightLifecycleStatus;
  resources: readonly PlaywrightResource[];
  failures: readonly unknown[];
}>;

export type PlaywrightLifecycleEvent =
  | Readonly<{ type: "start" }>
  | Readonly<{ type: "started" }>
  | Readonly<{ type: "register"; resource: PlaywrightResource }>
  | Readonly<{ type: "release"; id: string }>
  | Readonly<{ type: "fail"; error: unknown }>
  | Readonly<{ type: "close" }>
  | Readonly<{ type: "closed" }>;

export function initialPlaywrightLifecycleState(): PlaywrightLifecycleState {
  return freezeState({ status: "created", resources: [], failures: [] });
}

export function reducePlaywrightLifecycle(
  state: PlaywrightLifecycleState,
  event: PlaywrightLifecycleEvent
): PlaywrightLifecycleState {
  switch (event.type) {
    case "start":
      requireStatus(state, "created", event.type);
      return freezeState({ ...state, status: "starting" });
    case "started":
      requireStatus(state, "starting", event.type);
      return freezeState({ ...state, status: "started" });
    case "register":
      if (state.status !== "starting" && state.status !== "started") {
        throw new Error(`Cannot register Playwright resource while ${state.status}`);
      }
      if (state.resources.some((resource) => resource.id === event.resource.id)) {
        throw new Error(`Duplicate Playwright resource ${event.resource.id}`);
      }
      return freezeState({ ...state, resources: [...state.resources, Object.freeze(event.resource)] });
    case "release":
      return freezeState({ ...state, resources: state.resources.filter((resource) => resource.id !== event.id) });
    case "fail":
      return freezeState({ ...state, failures: [...state.failures, event.error] });
    case "close":
      if (state.status === "closed" || state.status === "closing") return state;
      return freezeState({ ...state, status: "closing" });
    case "closed":
      if (state.status === "closed") return state;
      requireStatus(state, "closing", event.type);
      return freezeState({ ...state, status: "closed", resources: [] });
  }
}

function requireStatus(
  state: PlaywrightLifecycleState,
  expected: PlaywrightLifecycleStatus,
  event: string
): void {
  if (state.status !== expected) throw new Error(`Cannot ${event} Playwright execution from ${state.status}`);
}

function freezeState(input: {
  status: PlaywrightLifecycleStatus;
  resources: readonly PlaywrightResource[];
  failures: readonly unknown[];
}): PlaywrightLifecycleState {
  return Object.freeze({
    status: input.status,
    resources: Object.freeze([...input.resources]),
    failures: Object.freeze([...input.failures])
  });
}
