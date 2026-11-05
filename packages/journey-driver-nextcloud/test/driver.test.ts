import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { nextcloudAndroidDriver } from "../src/android.js";
import { createNextcloudFederatedSharingEnvironment } from "../src/federated-sharing.js";
import { nextcloudWebDriver } from "../src/web.js";
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

test("web and Android Nextcloud drivers are deterministic pure resolvers", () => {
  const options = {
    touchpoints: { touchpoint: { baseURL: "https://cloud.example.test/base/" } },
    users: { actor: { username: "alice", password: "secret" } },
    entries: { files: "/apps/files/" },
    transitionValues: { username: { source: "user.username" as const } }
  };
  const before = structuredClone(options);
  const web = nextcloudWebDriver(options);
  const first = web.resolveEntry(operation);
  const second = web.resolveEntry(operation);
  assert.deepEqual(first, second);
  assert.ok(Object.isFrozen(first));
  assert.equal(web.resolveTransitionValue(transition), "alice");
  assert.deepEqual(options, before);

  const android = nextcloudAndroidDriver({ ...options, entries: { files: "application" as const } });
  assert.deepEqual(android.resolveEntry(operation), { kind: "application" });
  assert.ok(Object.isFrozen(android.resolveEntry(operation)));
  assert.equal(android.resolveTransitionValue(transition), "alice");
});

test("driver configuration is copied and deeply frozen from caller mutation", () => {
  const options = {
    touchpoints: { touchpoint: { baseURL: "https://cloud.example.test" } },
    users: { actor: { username: "alice", password: "secret" } },
    entries: { files: "/apps/files/" },
    transitionValues: { username: { source: "user.username" as const } }
  };
  const driver = nextcloudWebDriver(options);
  options.touchpoints.touchpoint.baseURL = "https://changed.example.test";
  options.users.actor.username = "changed";
  assert.equal(driver.resolveEntry(operation).url, "https://cloud.example.test/apps/files/");
  assert.equal(driver.resolveTransitionValue(transition), "alice");
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

test("Nextcloud package has no automation runtime dependency or mutable driver session state", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as { dependencies?: Record<string, string> };
  const dependencyNames = Object.keys(packageJson.dependencies ?? {});
  assert.ok(!dependencyNames.some((name) => /playwright|appium|webdriverio/.test(name)));
  const sourceDirectory = new URL("../src/", import.meta.url);
  const sources = await Promise.all((await readdir(sourceDirectory)).filter((name) => name.endsWith(".ts")).map((name) => readFile(new URL(name, sourceDirectory), "utf8")));
  const driverSources = sources.join("\n");
  assert.doesNotMatch(driverSources, /PlaywrightJourneyDriver|AppiumJourneyDriver|createExecution\s*\(|new Map\s*\(|new Set\s*\(|\.push\s*\(|\.splice\s*\(/);
  await assert.rejects(readFile(new URL("../../journey-driver-nextcloud-android/package.json", import.meta.url), "utf8"));
});
