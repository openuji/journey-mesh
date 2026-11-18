import { isDeepStrictEqual } from "node:util";
import type { JourneyArtifactStore } from "@openuji/journey-plugin";
import type { JourneyEnvironment } from "@openuji/journey-runner";

export type Assertion = Readonly<{ pointer: string; equals?: unknown; length?: number; includes?: unknown; excludes?: unknown }>;
export type RequestStep = Readonly<{
  id: string; client: string; method: string; path: string;
  query?: Readonly<Record<string, unknown>>; headers?: Readonly<Record<string, string>>; json?: unknown;
  status: readonly number[]; capture?: Readonly<Record<string, string>>; assertions?: readonly Assertion[];
  cleanup?: readonly RequestStep[]; poll?: Readonly<{ timeoutMs: number; intervalMs: number }>;
}>;
export type HttpOptions = Readonly<{
  clients: Readonly<Record<string, { baseURL: string; headers?: Readonly<Record<string, string>>; auth?: { username: string; password: string } }>>;
  setup: readonly RequestStep[]; effects: Readonly<Record<string, readonly RequestStep[]>>;
  timeoutMs: number; cleanupTimeoutMs: number;
}>;

export function validateEffectChecks(effects: HttpOptions["effects"]): void {
  for (const [id, checks] of Object.entries(effects)) {
    if (!checks.length) throw new Error(`HTTP effect ${id} requires at least one verification request`);
    if (checks.some((step) => !["GET", "HEAD"].includes(step.method) || step.cleanup?.length)) {
      throw new Error("Effect verification must be read-only; model test actions as UJG transitions");
    }
  }
}

export function pointer(value: unknown, path: string): unknown {
  if (path === "") return value;
  if (!path.startsWith("/") || /~(?![01])/.test(path)) throw new Error("Invalid JSON Pointer");
  for (const part of path.slice(1).split("/")) {
    const key = part.replaceAll("~1", "/").replaceAll("~0", "~");
    if (!value || typeof value !== "object" || !Object.hasOwn(value, key)) throw new Error(`Missing JSON Pointer ${path}`);
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}
function subset(value: unknown, expected: unknown): boolean {
  if (expected && typeof expected === "object" && !Array.isArray(expected)) return !!value && typeof value === "object"
    && Object.entries(expected).every(([key, entry]) => Object.hasOwn(value, key) && subset((value as Record<string, unknown>)[key], entry));
  return isDeepStrictEqual(value, expected);
}

export function httpEnvironment(options: HttpOptions, artifacts?: JourneyArtifactStore, request: typeof fetch = fetch): JourneyEnvironment {
  options = structuredClone(options);
  validateEffectChecks(options.effects);
  let captures = new Map<string, unknown>();
  let cleanup: { steps: readonly RequestStep[]; captures: Map<string, unknown> }[] = [];
  let context: Parameters<NonNullable<JourneyEnvironment["setup"]>>[0];
  let facts: object[] = [];
  const value = (name: string, scope: ReadonlyMap<string, unknown>): unknown => {
    if (!scope.has(name)) throw new Error(`Unknown HTTP capture ${name}`);
    return scope.get(name);
  };
  function expand(item: unknown, scope: ReadonlyMap<string, unknown>, urlPart = false): unknown {
    if (typeof item === "string") {
      const whole = /^\{\{([\w.-]+)\}\}$/.exec(item);
      if (whole && !urlPart) return value(whole[1]!, scope);
      return item.replace(/\{\{([\w.-]+)\}\}/g, (_match, name: string) => {
        const entry = value(name, scope);
        if (typeof entry === "object") throw new Error("URL and text captures must be scalar");
        return urlPart ? encodeURIComponent(String(entry)) : String(entry);
      });
    }
    if (Array.isArray(item)) return item.map((entry) => expand(entry, scope));
    if (item && typeof item === "object") return Object.fromEntries(Object.entries(item).map(([key, entry]) => [key, expand(entry, scope)]));
    return item;
  }
  let registeredCleanup = new Set<RequestStep>();
  async function evidence() {
    if (artifacts) await artifacts.write({ name: `http/${encodeURIComponent(context.executionId)}.json`,
      contentType: "application/json", scope: { runId: context.runId, executionId: context.executionId, profileId: context.profile.id },
      data: JSON.stringify(facts, null, 2) });
  }
  async function step(item: RequestStep, stage: string, signal?: AbortSignal, scope = captures): Promise<void> {
    const client = options.clients[item.client]!;
    const deadline = Date.now() + (item.poll?.timeoutMs ?? options.timeoutMs);
    let lastStatus: number | undefined;
    for (;;) {
      signal?.throwIfAborted();
      try {
        const path = String(expand(item.path, scope, true));
        if (!path.startsWith("/") || path.startsWith("//")) throw new Error("HTTP path must be relative to the configured origin");
        const url = new URL(path, client.baseURL);
        if (url.origin !== new URL(client.baseURL).origin) throw new Error("HTTP path changed the configured origin");
        for (const [key, entry] of Object.entries(item.query ?? {})) url.searchParams.set(key, String(expand(entry, scope)));
        const headers: Record<string, string> = { ...client.headers, ...expand(item.headers ?? {}, scope) as Record<string, string> };
        if (client.auth) headers.Authorization = `Basic ${Buffer.from(`${client.auth.username}:${client.auth.password}`).toString("base64")}`;
        if (item.json !== undefined) headers["Content-Type"] = "application/json";
        const timeout = AbortSignal.timeout(Math.max(1, Math.min(options.timeoutMs, deadline - Date.now())));
        const response = await request(url, { method: item.method, headers, redirect: "manual",
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
          ...(item.json === undefined ? {} : { body: JSON.stringify(expand(item.json, scope)) }) });
        lastStatus = response.status;
        if (!item.status.includes(response.status)) {
          await response.body?.cancel();
          throw new Error(`Expected status ${item.status.join("/")}, got ${response.status}`);
        }
        const needsJson = Object.keys(item.capture ?? {}).length || item.assertions?.length;
        const body: unknown = needsJson ? await response.json() : (await response.body?.cancel(), undefined);
        // Resolve all captures before publishing any of them.
        const captured = Object.entries(item.capture ?? {}).map(([name, path]) => [name, pointer(body, path)] as const);
        for (const [name, entry] of captured) scope.set(name, entry);
        if (item.cleanup?.length && !registeredCleanup.has(item)) {
          cleanup.push({ steps: item.cleanup, captures: new Map(scope) });
          registeredCleanup.add(item);
        }
        for (const assertion of item.assertions ?? []) {
          const actual = pointer(body, assertion.pointer);
          const expected = expand(Object.hasOwn(assertion, "equals") ? assertion.equals
            : Object.hasOwn(assertion, "includes") ? assertion.includes : assertion.excludes, scope);
          const ok = Object.hasOwn(assertion, "equals") ? isDeepStrictEqual(actual, expected)
            : assertion.length !== undefined ? Array.isArray(actual) && actual.length === assertion.length
              : Array.isArray(actual) && (Object.hasOwn(assertion, "includes")
                ? actual.some((entry) => subset(entry, expected)) : !actual.some((entry) => subset(entry, expected)));
          if (!ok) throw new Error(`JSON assertion failed at ${assertion.pointer}`);
        }
        facts.push({ id: item.id, stage, status: response.status, ok: true });
        await evidence(); return;
      } catch (error) {
        if (item.poll && !signal?.aborted && Date.now() < deadline) {
          await new Promise<void>((accept) => setTimeout(accept, Math.min(item.poll!.intervalMs, Math.max(1, deadline - Date.now()))));
          continue;
        }
        facts.push({ id: item.id, stage, status: lastStatus, ok: false });
        await evidence();
        // Network errors and response bodies may contain secrets. Keep failure messages detached.
        throw new Error(`HTTP ${stage} step ${item.id} failed${lastStatus === undefined ? "" : ` (status ${lastStatus})`}`);
      }
    }
  }
  return {
    async setup(input) {
      context = input; captures = new Map(); cleanup = []; facts = []; registeredCleanup = new Set();
      for (const item of options.setup) await step(item, "setup", input.signal);
    },
    async verifyEffect({ effect, context }) {
      const checks = options.effects[effect.id];
      if (!checks) throw new Error(`No HTTP checks for effect ${effect.id}`);
      for (const item of checks) await step(item, `effect:${effect.id}`, context.signal);
    },
    async teardown() {
      const signal = AbortSignal.timeout(options.cleanupTimeoutMs);
      const failures: unknown[] = [];
      for (const group of [...cleanup].reverse()) for (const item of group.steps) try { await step(item, "cleanup", signal, group.captures); } catch (error) { failures.push(error); }
      cleanup = [];
      if (failures.length) throw new AggregateError(failures, "HTTP fixture cleanup failed");
    }
  };
}
