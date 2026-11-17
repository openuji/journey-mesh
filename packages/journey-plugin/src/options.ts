/** Option helpers for `parse()`: they validate raw YAML values and return typed settings. */
export function optionsObject(value: unknown, label = "options"): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}
export function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a nonempty string`);
  return value;
}
export function optionalString(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : requiredString(value, label);
}
export function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((item) => requiredString(item, label));
}
export function booleanOption(value: unknown, fallback = false): boolean {
  if (value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  throw new Error("Expected a boolean option");
}
export function positiveNumber(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  const number = typeof value === "string" && value.trim() ? Number(value) : value;
  if (typeof number !== "number" || !Number.isFinite(number) || number <= 0) throw new Error("Expected a positive number");
  return number;
}
export function knownOptions(options: Record<string, unknown>, keys: readonly string[]): void {
  for (const key of Object.keys(options)) if (!keys.includes(key)) throw new Error(`Unknown option ${key}`);
}
/** `parse()` for components without options. */
export function noOptions(options: Record<string, unknown>): void {
  knownOptions(options, []);
}
