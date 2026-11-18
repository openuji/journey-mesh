import { defineEnvironmentPlugin, knownOptions, optionsObject, positiveNumber, requiredString } from "@openuji/journey-plugin";
import { httpEnvironment, type HttpOptions, type RequestStep, type Assertion } from "./index.js";

const jsonPointer = (value: unknown): string => {
  if (typeof value !== "string" || value !== "" && (!value.startsWith("/") || /~(?![01])/.test(value))) throw new Error("Invalid JSON Pointer");
  return value;
};
const strings = (raw: unknown) => Object.fromEntries(Object.entries(optionsObject(raw ?? {}, "headers")).map(([key, value]) => [key, requiredString(value, key)]));

export const journeyMeshPlugin = defineEnvironmentPlugin({
  kind: "environment",
  parse(options, context): HttpOptions {
    knownOptions(options, ["clients", "setup", "effects", "timeoutMs", "cleanupTimeoutMs"]);
    const clients = Object.fromEntries(Object.entries(optionsObject(options.clients, "clients")).map(([name, raw]) => {
      const item = optionsObject(raw, `client ${name}`); knownOptions(item, ["baseURL", "headers", "auth"]);
      const baseURL = requiredString(item.baseURL, "baseURL"); const url = new URL(baseURL);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Invalid HTTP client URL");
      const auth = item.auth === undefined ? undefined : optionsObject(item.auth, "auth");
      if (auth) knownOptions(auth, ["username", "password"]);
      return [name, { baseURL, headers: strings(item.headers), ...(auth ? { auth: { username: requiredString(auth.username, "username"), password: requiredString(auth.password, "password") } } : {}) }];
    }));
    const parseSteps = (raw: unknown, clean = false): RequestStep[] => {
      if (!Array.isArray(raw)) throw new Error("HTTP steps must be an array");
      const ids = new Set<string>();
      return raw.map((entry) => {
        const item = optionsObject(entry, "HTTP step"); knownOptions(item, ["id", "client", "method", "path", "query", "headers", "json", "status", "capture", "assertions", "cleanup", "poll"]);
        const id = requiredString(item.id, "step.id");
        if (ids.has(id)) throw new Error(`Duplicate HTTP step ${id}`); ids.add(id);
        const client = requiredString(item.client, "step.client"); if (!Object.hasOwn(clients, client)) throw new Error(`Unknown HTTP client ${client}`);
        const method = requiredString(item.method ?? "GET", "method").toUpperCase();
        if (!["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"].includes(method)) throw new Error("Unsupported HTTP method");
        const path = requiredString(item.path, "path"); if (!path.startsWith("/") || path.startsWith("//")) throw new Error("HTTP step path must be origin-relative");
        const status = Array.isArray(item.status) ? item.status : [item.status ?? 200];
        if (!status.length || status.some((value) => !Number.isInteger(value) || value < 100 || value > 599)) throw new Error("Invalid HTTP expected status");
        const capture = Object.fromEntries(Object.entries(optionsObject(item.capture ?? {}, "capture")).map(([name, path]) => {
          if (!/^[\w.-]+$/.test(name)) throw new Error("Invalid capture name"); return [name, jsonPointer(path)];
        }));
        if (item.assertions !== undefined && !Array.isArray(item.assertions)) throw new Error("assertions must be an array");
        const assertions = ((item.assertions ?? []) as unknown[]).map((raw): Assertion => {
          const a = optionsObject(raw, "assertion"); knownOptions(a, ["pointer", "equals", "length", "includes", "excludes"]);
          if (["equals", "length", "includes", "excludes"].filter((key) => Object.hasOwn(a, key)).length !== 1) throw new Error("An assertion needs exactly one comparison");
          if (a.length !== undefined && (!Number.isInteger(a.length) || Number(a.length) < 0)) throw new Error("Invalid array length");
          return { ...a, pointer: jsonPointer(a.pointer) } as Assertion;
        });
        if (clean && (item.cleanup !== undefined || item.poll !== undefined)) throw new Error("Cleanup cannot register cleanup or poll");
        if (item.poll !== undefined && !["GET", "HEAD"].includes(method)) throw new Error("Only reads can poll");
        const poll = item.poll === undefined ? undefined : optionsObject(item.poll, "poll");
        if (poll) knownOptions(poll, ["timeoutMs", "intervalMs"]);
        return { id, client, method, path, status, capture, assertions, headers: strings(item.headers),
          ...(item.query === undefined ? {} : { query: optionsObject(item.query, "query") }),
          ...(item.json === undefined ? {} : { json: item.json }),
          ...(item.cleanup === undefined ? {} : { cleanup: parseSteps(item.cleanup, true) }),
          ...(poll ? { poll: { timeoutMs: positiveNumber(poll.timeoutMs, 30_000), intervalMs: positiveNumber(poll.intervalMs, 250) } } : {}) };
      });
    };
    const effects = Object.fromEntries(Object.entries(optionsObject(options.effects ?? {}, "effects")).map(([id, steps]) => {
      const checks = parseSteps(steps);
      if (checks.some((step) => !["GET", "HEAD"].includes(step.method) || step.cleanup?.length)) throw new Error("Effect verification must be read-only; model test actions as UJG transitions");
      return [id, checks];
    }));
    const required = new Set(context.operations.flatMap((op) => op.kind === "transition" ? op.effects.map((effect) => effect.id) : []));
    for (const id of new Set([...required, ...Object.keys(effects)])) if (!required.has(id) || !Object.hasOwn(effects, id)) throw new Error(`Missing or unknown HTTP effect ${id}`);
    return { clients, setup: parseSteps(options.setup ?? []), effects,
      timeoutMs: positiveNumber(options.timeoutMs, 30_000), cleanupTimeoutMs: positiveNumber(options.cleanupTimeoutMs, 30_000) };
  },
  create(settings, context) { return httpEnvironment(settings, context.artifacts); }
});
