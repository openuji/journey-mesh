import type { JourneyPlan, JourneyPlanOperation, JourneyReporter } from "@openuji/journey-runner";

export type JourneyArtifact = Readonly<{ name: string; path: string; href: string; contentType: string }>;
export type JourneyArtifactStore = {
  readonly outputDir: string;
  outputPath(...segments: string[]): string;
  attach(name: string, input: { path: string; contentType?: string }): Promise<void>;
  write(input: { name: string; data: string | Uint8Array; contentType: string }): Promise<JourneyArtifact>;
  read(artifact: { path: string }): Promise<Uint8Array>;
  readonly files: readonly JourneyArtifact[];
};

export type JourneyPluginContext = {
  readonly artifacts: JourneyArtifactStore;
  readonly configPath: string;
  readonly testId: string;
  readonly operations: readonly JourneyPlanOperation[];
  readonly env: Readonly<Record<string, string | undefined>>;
  resolvePath(path: string): string;
};
export type JourneyPluginDependencies = { driver?: unknown; observers?: readonly unknown[] };
export type JourneyPluginKind = "model" | "adapter" | "driver" | "observer" | "profile" | "environment";
/** Imports, validation and construction must not allocate automation resources or mutate services. */
export type JourneyMeshPlugin<T = unknown> = {
  apiVersion: 1;
  kind: JourneyPluginKind;
  /** Pure driver compatibility. Concrete runtimes belong only to adapters and observers. */
  driverContract?: string;
  runtime?: string;
  validate(options: Record<string, unknown>, context: JourneyPluginContext): void | Promise<void>;
  create(options: Record<string, unknown>, context: JourneyPluginContext, dependencies: JourneyPluginDependencies): T | Promise<T>;
};
export type JourneyModelCompiler = {
  compile(source: string, selection: string): Promise<JourneyPlan>;
};
export type JourneyObserverComponent = { observer: unknown; reporter?: JourneyReporter };

export function optionsObject(value: unknown, label = "options"): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}
export function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a nonempty string`);
  return value;
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
