import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { JourneyExecutionContext } from "@openuji/journey-runner";
import { httpEnvironment, pointer, type HttpOptions, type RequestStep } from "../src/index.js";
import { journeyMeshPlugin } from "../src/plugin.js";

const context = (id: string): JourneyExecutionContext => ({ runId: "run", executionId: id, profile: { id }, plan: { id: "plan", operations: [] } });
test("HTTP fixtures capture native values, encode paths, assert subsets, isolate profiles and clean up", async () => {
  const events: string[] = []; let current = 0;
  const server = createServer(async (req, res) => {
    events.push(`${req.method} ${req.url}`);
    res.setHeader("Content-Type", "application/json");
    if (req.method === "POST") { current++; res.end(JSON.stringify({ id: current, token: "a/b?", secret: "do-not-publish" })); }
    else if (req.method === "GET") res.end(JSON.stringify([{ id: current, canDelete: false }]));
    else { res.statusCode = 204; res.end(); }
  });
  await new Promise<void>((accept) => server.listen(0, "127.0.0.1", accept));
  try {
    const options: HttpOptions = {
      clients: { api: { baseURL: `http://127.0.0.1:${(server.address() as AddressInfo).port}` } }, timeoutMs: 1000, cleanupTimeoutMs: 1000,
      setup: [{ id: "create", client: "api", method: "POST", path: "/objects", status: [200], capture: { id: "/id", token: "/token" },
        cleanup: [{ id: "delete", client: "api", method: "DELETE", path: "/objects/{{token}}", status: [204] }] }],
      effects: { check: [{ id: "check", client: "api", method: "GET", path: "/objects", status: [200], assertions: [
        { pointer: "", length: 1 }, { pointer: "", includes: { id: "{{id}}", canDelete: false } }, { pointer: "", excludes: { id: 99 } }
      ] }] }
    };
    const reports: string[] = [];
    const env = httpEnvironment(options, { files: [], read: async () => new Uint8Array(), write: async (item) => {
      reports.push(String(item.data)); return { name: item.name, href: item.name, contentType: item.contentType };
    } });
    for (const id of ["first", "second"]) {
      const execution = context(id); await env.setup!(execution);
      await env.verifyEffect!({ context: execution, effect: { id: "check" } } as Parameters<NonNullable<typeof env.verifyEffect>>[0]);
      await env.teardown!({ context: execution, executionFailed: false });
    }
    assert.deepEqual(events, ["POST /objects", "GET /objects", "DELETE /objects/a%2Fb%3F", "POST /objects", "GET /objects", "DELETE /objects/a%2Fb%3F"]);
    assert.ok(reports.every((report) => !report.includes("do-not-publish") && !report.includes("a/b?")));
  } finally { await new Promise<void>((accept, reject) => server.close((error) => error ? reject(error) : accept())); }
});
test("partial setup registers cleanup before assertions fail and cleanup ignores execution cancellation", async () => {
  const requests: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) => { requests.push(init?.method ?? "GET"); return new Response(JSON.stringify({ id: 4 }), { status: 200 }); };
  try {
    const abort = new AbortController();
    const create: RequestStep = { id: "create", client: "api", method: "POST", path: "/", status: [200], capture: { id: "/id" },
      assertions: [{ pointer: "/id", equals: 5 }], cleanup: [{ id: "cleanup", client: "api", method: "DELETE", path: "/{{id}}", status: [200] }] };
    const env = httpEnvironment({ clients: { api: { baseURL: "http://example.test" } }, setup: [create], effects: {}, timeoutMs: 100, cleanupTimeoutMs: 100 });
    const execution = { ...context("failed"), signal: abort.signal };
    await assert.rejects(async () => env.setup!(execution), /setup step create failed/); abort.abort();
    await env.teardown!({ context: execution, executionFailed: true });
    assert.deepEqual(requests, ["POST", "DELETE"]);
  } finally { globalThis.fetch = original; }
});
test("configuration rejects write polling and malformed pointers without issuing requests", () => {
  const parseContext = { operations: [] } as unknown as Parameters<typeof journeyMeshPlugin.parse>[1];
  const base = { clients: { api: { baseURL: "http://example.test" } }, setup: [{ id: "write", client: "api", method: "POST", path: "/", status: [200], poll: {} }] };
  assert.throws(() => journeyMeshPlugin.parse(base, parseContext), /Only reads can poll/);
  assert.throws(() => pointer({}, "/missing"), /Missing JSON Pointer/);
  assert.throws(() => pointer({}, "/~2"), /Invalid JSON Pointer/);
  assert.throws(() => journeyMeshPlugin.parse({ clients: base.clients,
    effects: { change: [{ id: "hidden-action", client: "api", method: "DELETE", path: "/object", status: [200] }] }
  }, parseContext), /Effect verification must be read-only/);
});

test("effect recipes are detached so callers cannot turn verification into hidden actions", async () => {
  const check: RequestStep = { id: "check", client: "api", method: "GET", path: "/", status: [204] };
  const methods: string[] = [];
  const env = httpEnvironment({ clients: { api: { baseURL: "http://example.test" } }, setup: [],
    effects: { check: [check] }, timeoutMs: 100, cleanupTimeoutMs: 100 }, undefined,
    async (_url, init) => { methods.push(init?.method ?? "GET"); return new Response(null, { status: 204 }); });
  Object.assign(check, { method: "DELETE" });
  const execution = context("detached"); await env.setup!(execution);
  await env.verifyEffect!({ context: execution, effect: { id: "check" } } as Parameters<NonNullable<typeof env.verifyEffect>>[0]);
  assert.deepEqual(methods, ["GET"]);
});

test("fixture cleanup retains its captures across later fixtures and effects and shares captures within its group", async () => {
  const calls: string[] = [];
  let nextId = 0;
  const setup: RequestStep[] = ["first", "second"].map((id) => ({
    id, client: "api", method: "POST", path: "/objects", status: [200], capture: { id: "/id" },
    cleanup: [
      { id: `trash-${id}`, client: "api", method: "POST", path: "/trash/{{id}}", status: [200], capture: { id: "/trashId" } },
      { id: `purge-${id}`, client: "api", method: "DELETE", path: "/trash/{{id}}", status: [204] }
    ]
  }));
  const env = httpEnvironment({ clients: { api: { baseURL: "http://example.test" } }, setup,
    effects: { changed: [{ id: "check", client: "api", method: "GET", path: "/state", status: [200], capture: { id: "/id" } }] },
    timeoutMs: 100, cleanupTimeoutMs: 100 }, undefined, async (url, init) => {
    const path = new URL(String(url)).pathname;
    calls.push(`${init?.method} ${path}`);
    if (path === "/objects") return Response.json({ id: ++nextId });
    if (path === "/state") return Response.json({ id: 999 });
    if (init?.method === "POST") return Response.json({ trashId: Number(path.split("/").pop()) * 10 });
    return new Response(null, { status: 204 });
  });
  const execution = context("cleanup-scopes");
  await env.setup!(execution);
  await env.verifyEffect!({ context: execution, effect: { id: "changed" } } as Parameters<NonNullable<typeof env.verifyEffect>>[0]);
  await env.teardown!({ context: execution, executionFailed: false });
  assert.deepEqual(calls, ["POST /objects", "POST /objects", "GET /state", "POST /trash/2", "DELETE /trash/20", "POST /trash/1", "DELETE /trash/10"]);
});

test("empty effect checks fail preflight through both the plugin and direct API", () => {
  const options: HttpOptions = { clients: { api: { baseURL: "http://example.test" } }, setup: [],
    effects: { changed: [] }, timeoutMs: 100, cleanupTimeoutMs: 100 };
  const parseContext = { operations: [{ kind: "transition", effects: [{ id: "changed" }] }] } as unknown as Parameters<typeof journeyMeshPlugin.parse>[1];
  assert.throws(() => journeyMeshPlugin.parse(options, parseContext), /changed.*at least one/);
  assert.throws(() => httpEnvironment(options), /changed.*at least one/);
});
