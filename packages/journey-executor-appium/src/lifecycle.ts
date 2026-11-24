import type { AppiumSession } from "./contracts.js";

export type AppiumLifecycleStatus = "created" | "starting" | "started" | "closing" | "closed";
export type AppiumResource = Readonly<{
  id: string;
  kind: "session";
  key: string;
  actorId: string;
  touchpointId: string;
  udid: string;
  session: AppiumSession;
}>;
export type AppiumLifecycleState = Readonly<{
  status: AppiumLifecycleStatus;
  resources: readonly AppiumResource[];
  failures: readonly unknown[];
}>;
export type AppiumLifecycleEvent =
  | Readonly<{ type: "start" }>
  | Readonly<{ type: "started" }>
  | Readonly<{ type: "register"; resource: AppiumResource }>
  | Readonly<{ type: "release"; id: string }>
  | Readonly<{ type: "fail"; error: unknown }>
  | Readonly<{ type: "close" }>
  | Readonly<{ type: "closed" }>;

export function initialAppiumLifecycleState(): AppiumLifecycleState {
  return freezeState({ status: "created", resources: [], failures: [] });
}

export function reduceAppiumLifecycle(
  state: AppiumLifecycleState,
  event: AppiumLifecycleEvent
): AppiumLifecycleState {
  switch (event.type) {
    case "start": requireStatus(state, "created", event.type); return freezeState({ ...state, status: "starting" });
    case "started": requireStatus(state, "starting", event.type); return freezeState({ ...state, status: "started" });
    case "register":
      if (state.status !== "starting" && state.status !== "started") throw new Error(`Cannot register Appium resource while ${state.status}`);
      if (state.resources.some((resource) => resource.id === event.resource.id)) throw new Error(`Duplicate Appium resource ${event.resource.id}`);
      return freezeState({ ...state, resources: [...state.resources, Object.freeze(event.resource)] });
    case "release": return freezeState({ ...state, resources: state.resources.filter((resource) => resource.id !== event.id) });
    case "fail": return freezeState({ ...state, failures: [...state.failures, event.error] });
    case "close":
      if (state.status === "closed" || state.status === "closing") return state;
      return freezeState({ ...state, status: "closing" });
    case "closed":
      if (state.status === "closed") return state;
      requireStatus(state, "closing", event.type);
      return freezeState({ ...state, status: "closed", resources: [] });
  }
}

function requireStatus(state: AppiumLifecycleState, expected: AppiumLifecycleStatus, event: string): void {
  if (state.status !== expected) throw new Error(`Cannot ${event} Appium execution from ${state.status}`);
}
function freezeState(input: { status: AppiumLifecycleStatus; resources: readonly AppiumResource[]; failures: readonly unknown[] }): AppiumLifecycleState {
  return Object.freeze({ status: input.status, resources: Object.freeze([...input.resources]), failures: Object.freeze([...input.failures]) });
}
