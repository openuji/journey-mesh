import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { nextcloudAndroidClient } from "../src/android/client.js";
import { createNextcloudFederatedSharingEnvironment } from "../src/environments/federated-sharing/environment.js";
import { nextcloudWebClient } from "../src/web/client.js";
import type { JourneyPlanOperation, TransitionPlanOperation } from "@openuji/journey-execution-model";

const base = {
  id: "operation",
  sequence: 0,
  actorId: "actor",
  touchpointId: "touchpoint",
  entry: { id: "entry", stateId: "state" },
  entryBinding: { id: "binding", value: "files" }
};
const operation = { ...base, kind: "control-flow", transition: { id: "flow", from: "state", to: "state" } } satisfies JourneyPlanOperation;
const transition = {
  ...base,
  kind: "transition",
  transition: { id: "username", from: "state", to: "state" },
  from: { id: "state", type: "State" },
  to: { id: "state", type: "State" },
  surface: { id: "surface" },
  activation: {
    transitionId: "username", eventId: "event", from: { id: "state", type: "State" },
    to: { id: "state", type: "State" }, surfaceId: "surface", requiredInputModalityProfiles: [], bindings: []
  },
  effects: []
} satisfies TransitionPlanOperation;

test("web and Android Nextcloud clients are deterministic pure resolvers", () => {
  const options = {
    touchpoints: { touchpoint: { baseURL: "https://cloud.example.test/base/" } },
    users: { actor: { username: "alice", password: "secret" } },
    entries: { files: "/apps/files/" },
    transitionValues: { username: { source: "user.username" as const } }
  };
  const before = structuredClone(options);
  const web = nextcloudWebClient(options);
  const first = web.resolveEntry(operation);
  const second = web.resolveEntry(operation);
  assert.deepEqual(first, second);
  assert.ok(Object.isFrozen(first));
  assert.equal(web.resolveTransitionValue(transition), "alice");
  assert.deepEqual(options, before);

  const android = nextcloudAndroidClient({ ...options, entries: { files: "application" as const } });
  assert.deepEqual(android.resolveEntry(operation), { kind: "application" });
  assert.ok(Object.isFrozen(android.resolveEntry(operation)));
  assert.equal(android.resolveTransitionValue(transition), "alice");
});

test("client configuration is copied and deeply frozen from caller mutation", () => {
  const options = {
    touchpoints: { touchpoint: { baseURL: "https://cloud.example.test" } },
    users: { actor: { username: "alice", password: "secret" } },
    entries: { files: "/apps/files/" },
    transitionValues: { username: { source: "user.username" as const } }
  };
  const client = nextcloudWebClient(options);
  options.touchpoints.touchpoint.baseURL = "https://changed.example.test";
  options.users.actor.username = "changed";
  assert.equal(client.resolveEntry(operation).url, "https://cloud.example.test/apps/files/");
  assert.equal(client.resolveTransitionValue(transition), "alice");
});

test("federated-sharing environment rejects effects it does not own", async () => {
  const environment = createNextcloudFederatedSharingEnvironment({
    sharerTouchpoint: { baseURL: "https://alice.example.test" },
    recipientTouchpoint: { baseURL: "https://bob.example.test" },
    sharerUser: { username: "alice", password: "secret" },
    recipientUser: { username: "bob", password: "secret" },
    fixturePath: "/fixture.pdf",
    fixtureFileName: "fixture.pdf",
    effectIds: { shareCreated: "created", shareAccepted: "accepted" }
  });
  await assert.rejects(
    async () => environment.verifyEffect!({ effect: { id: "foreign" }, context: { signal: AbortSignal.timeout(1_000) } } as never),
    /No Nextcloud effect verifier for foreign/
  );
});

test("recipient view preconditions are detached and repeated for each profile setup", async (t) => {
  const requests: unknown[] = [];
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = (async (url, init) => {
    if (String(url).includes("/apps/files/api/v1/views")) {
      requests.push(JSON.parse(String(init?.body)));
      return new Response("{}", { status: 503 });
    }
    throw new Error("Fixture work should not start after a failed precondition");
  }) as typeof fetch;
  const recipientViewConfig = { shareoverview: { expanded: false } };
  const environment = createNextcloudFederatedSharingEnvironment({
    sharerTouchpoint: { baseURL: "https://alice.example.test" }, recipientTouchpoint: { baseURL: "https://bob.example.test" },
    sharerUser: { username: "alice", password: "secret" }, recipientUser: { username: "bob", password: "secret" },
    fixturePath: "/fixture.pdf", fixtureFileName: "fixture.pdf", effectIds: { shareCreated: "created", shareAccepted: "accepted" }, recipientViewConfig
  });
  recipientViewConfig.shareoverview.expanded = true;
  for (let i = 0; i < 2; i++) await assert.rejects(async () => environment.setup!({} as never), /Could not prepare recipient view/);
  assert.deepEqual(requests, [{ view: "shareoverview", key: "expanded", value: false }, { view: "shareoverview", key: "expanded", value: false }]);
});

test("Nextcloud package has no automation runtime dependency or mutable client session state", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as { dependencies?: Record<string, string> };
  const dependencyNames = Object.keys(packageJson.dependencies ?? {});
  assert.ok(!dependencyNames.some((name) => /playwright|appium|webdriverio/.test(name)));
  // Client code: the platform clients and the binding resolution they share. Services and environments own resources.
  const sources: string[] = [];
  for (const directory of ["shared", "web", "android"]) {
    const sourceDirectory = new URL(`../src/${directory}/`, import.meta.url);
    const names = (await readdir(sourceDirectory)).filter((name) => name.endsWith(".ts"));
    assert.ok(names.length, `src/${directory} has client sources`);
    sources.push(...await Promise.all(names.map((name) => readFile(new URL(name, sourceDirectory), "utf8"))));
  }
  const clientSources = sources.join("\n");
  assert.doesNotMatch(clientSources, /PlaywrightJourneyExecutor|AppiumJourneyExecutor|createSession\s*\(|new Map\s*\(|new Set\s*\(|\.push\s*\(|\.splice\s*\(/);
  await assert.rejects(readFile(new URL("../../journey-vendor-nextcloud-android/package.json", import.meta.url), "utf8"));
});

test("a freshly provisioned server creates its fixture before querying path-specific outgoing shares", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let uploaded = false;
  globalThis.fetch = (async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.includes("/remote.php/dav/")) {
      if (init?.method === "PUT") { uploaded = true; return new Response(null, { status: 201 }); }
      if (init?.method === "HEAD") return new Response(null, { status: url.hostname === "alice.example.test" && uploaded ? 200 : 404 });
      return new Response(null, { status: 404 });
    }
    if (url.searchParams.has("path")) assert.equal(uploaded, true, "The OCS path endpoint requires the fixture to exist");
    return Response.json({ ocs: { data: [] } });
  }) as typeof fetch;
  const environment = createNextcloudFederatedSharingEnvironment({
    sharerTouchpoint: { baseURL: "https://alice.example.test" }, recipientTouchpoint: { baseURL: "https://bob.example.test" },
    sharerUser: { username: "alice", password: "secret" }, recipientUser: { username: "bob", password: "secret" },
    fixturePath: new URL("../../../examples/nextcloud-filesharing/deployment/fixtures/report.pdf", import.meta.url).pathname,
    fixtureFileName: "report.pdf", effectIds: { shareCreated: "created", shareAccepted: "accepted" }
  });
  await environment.setup!({} as never);
  assert.equal(uploaded, true);
});
