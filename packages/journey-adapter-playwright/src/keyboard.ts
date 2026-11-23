import { isPlaywrightRole } from "./locators.js";

/**
 * Platform gestures for platform-neutral Operability steps. UJG names a move kind
 * (`operability:nextItem`) or an activation, never a key; this table names the key.
 * It is configuration, not inference: a missing entry fails the step.
 */

/** A Playwright key, or a map from the ARIA role of the focused object to a key. `"*"` matches any role. */
export type PlaywrightKeyBinding = string | Readonly<Record<string, string>>;

export type PlaywrightKeyboard = Readonly<{
  /** FocusMoveKind IRI (standard or producer-defined) to its key. */
  moves: Readonly<Record<string, PlaywrightKeyBinding>>;
  /** The activation gesture for an ActivationStep, by the role of the focused object. */
  activation: PlaywrightKeyBinding;
}>;

export const anyRole = "*";

/**
 * WAI-ARIA Authoring Practices keyboard conventions for a left-to-right, horizontal tab list.
 * Buttons and toggles activate with Space, everything else with Enter; both are platform
 * activation gestures for a button, and mesh.yaml can choose the other one to check it.
 */
export const defaultPlaywrightKeyboard: PlaywrightKeyboard = deepFreeze({
  moves: {
    "operability:nextStop": "Tab",
    "operability:previousStop": "Shift+Tab",
    "operability:firstItem": "Home",
    "operability:lastItem": "End",
    "operability:nextItem": { tab: "ArrowRight", option: "ArrowDown", combobox: "ArrowDown", menuitem: "ArrowDown", treeitem: "ArrowDown", radio: "ArrowDown" },
    "operability:previousItem": { tab: "ArrowLeft", option: "ArrowUp", combobox: "ArrowUp", menuitem: "ArrowUp", treeitem: "ArrowUp", radio: "ArrowUp" }
  },
  activation: { button: "Space", checkbox: "Space", radio: "Space", switch: "Space", menuitemcheckbox: "Space", menuitemradio: "Space", [anyRole]: "Enter" }
});

/**
 * Parse the `keyboard` adapter option. Each entry it declares replaces the default entry
 * for that move kind, or the whole activation binding; other defaults stay.
 */
export function parsePlaywrightKeyboard(value: unknown, label = "keyboard"): PlaywrightKeyboard {
  if (value === undefined) return defaultPlaywrightKeyboard;
  const options = record(value, label);
  for (const key of Object.keys(options)) if (key !== "moves" && key !== "activation") throw new Error(`Unknown option ${label}.${key}`);
  const moves = options.moves === undefined ? {} : record(options.moves, `${label}.moves`);
  return deepFreeze({
    moves: {
      ...defaultPlaywrightKeyboard.moves,
      ...Object.fromEntries(Object.entries(moves).map(([kind, binding]) => [kind, keyBinding(binding, `${label}.moves.${kind}`)]))
    },
    activation: options.activation === undefined ? defaultPlaywrightKeyboard.activation : keyBinding(options.activation, `${label}.activation`)
  });
}

/**
 * The key a binding names for the focused object. `hasRole` reports whether the focused
 * object has a role, as the platform's accessibility API computes it.
 */
export async function resolveKey(binding: PlaywrightKeyBinding, hasRole: (role: string) => Promise<boolean>): Promise<string | undefined> {
  if (typeof binding === "string") return binding;
  for (const [role, key] of Object.entries(binding)) if (role !== anyRole && await hasRole(role)) return key;
  return binding[anyRole];
}

function keyBinding(value: unknown, label: string): PlaywrightKeyBinding {
  if (typeof value === "string") return key(value, label);
  const roles = record(value, label);
  if (!Object.keys(roles).length) throw new Error(`${label} must name at least one role`);
  for (const role of Object.keys(roles)) {
    if (role !== anyRole && !isPlaywrightRole(role)) throw new Error(`${label}.${role} is not an ARIA role Playwright supports`);
  }
  return Object.fromEntries(Object.entries(roles).map(([role, item]) => [role, key(item, `${label}.${role}`)]));
}

function key(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a nonempty Playwright key`);
  return value;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}
