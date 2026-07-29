import type { JsonObject, JsonValue } from "@openuji/journey-runner";

export function addOptional(metadata: JsonObject, key: string, value: JsonValue | undefined): void {
  if (value !== undefined) {
    metadata[key] = value;
  }
}

export function unique(values: string[]): string[] {
  return [...new Set(values)];
}
