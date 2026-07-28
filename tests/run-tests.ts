import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  activatePlaywrightLocator,
  playwrightAdapter,
  toPlaywrightObservationLocator,
  type PlaywrightCreateBrowserContextInput,
  type PlaywrightDriverExecutionContext,
  type PlaywrightJourneyDriver
} from "@openuji/journey-adapter-playwright";
import {
  davFileUrl,
  nextcloudDriver,
  ocsUrl,
  openNextcloudRoute,
  requiredEnv
} from "@openuji/journey-driver-nextcloud";
import {
  compileUjgJourneyPlan,
  loadUjgDocument,
  parseUjgDocument,
  type UjgDocument,
  type UjgNode
} from "@openuji/journey-model-ujg";
import { defaultProfile, keyboardOnlyProfile } from "@openuji/journey-profiles";
import {
  EvidenceRecorder,
  runJourney,
  type AdapterExecutionContext,
  type ControlFlowPlanOperation,
  type InputModalityDecision,
  type JourneyAdapter,
  type JourneyPlan,
  type JourneyPlanOperation,
  type StatePlanOperation,
  type TransitionPlanOperation
} from "@openuji/journey-runner";
import {
  nextcloudEnvironment,
  validateNextcloudEnvironmentForPlan
} from "../examples/nextcloud-filesharing/environment.js";

const fixtureUrl = new URL("../examples/nextcloud-filesharing/ujg/filesharing.ujg.jsonld", import.meta.url);

type TestCase = {
  name: string;
  run: () => Promise<void> | void;
};

const tests: TestCase[] = [
  {
    name: "compiler produces the expected v1 operation sequence",
    async run() {
      const plan = await loadFixturePlan();
      assert.equal(plan.documentId, "urn:ujg:document:nextcloud-federated-sharing");
      assert.equal(plan.operations.length, 15);
      assert.deepEqual(
        plan.operations.map((operation) => operation.kind),
        [
          "state",
          "transition",
          "state",
          "transition",
          "state",
          "transition",
          "state",
          "transition",
          "state",
          "state",
          "transition",
          "control-flow",
          "state",
          "transition",
          "state"
        ]
      );
      assert.deepEqual(
        plan.operations.map(graphNodeId),
        [
          "urn:state:alice-files-ready",
          "urn:transition:alice-opens-file-menu",
          "urn:state:alice-share-panel-open",
          "urn:transition:alice-enters-remote-bob",
          "urn:state:alice-remote-recipient-entered",
          "urn:transition:alice-selects-remote-recipient",
          "urn:state:alice-share-permissions-open",
          "urn:transition:alice-confirms-share",
          "urn:state:alice-share-confirmed",
          "urn:state:bob-incoming-share-visible",
          "urn:transition:bob-accepts-share",
          "urn:transition:bob-continues-after-share-offer-cleared",
          "urn:state:bob-pending-share-offer-cleared",
          "urn:transition:bob-opens-shares-overview",
          "urn:state:bob-shared-report-visible"
        ]
      );
    }
  },
  {
    name: "compiler preserves ids, locators, messages, effects, and artifacts",
    async run() {
      const plan = await loadFixturePlan();
      const aliceReady = stateOperation(plan, "urn:state:alice-files-ready");
      assert.equal(aliceReady.userId, "urn:user:alice");
      assert.equal(aliceReady.touchpointId, "urn:touchpoint:nextcloud-a");
      assert.equal(aliceReady.entry.id, "urn:entry:alice-federated-sharing");
      assert.equal(aliceReady.entryBinding?.value, "nextcloud.files");
      assert.equal(aliceReady.target.bindings[0].id, "urn:obs:alice-files-ready-presence");
      assert.equal(aliceReady.target.bindings[0].locators[0].id, "urn:locator:alice-file-row");
      assert.equal(aliceReady.target.bindings[0].locators[0].accessibleName, "report.pdf");

      const aliceOpenMenu = transitionOperation(plan, "urn:transition:alice-opens-file-menu");
      assert.equal(aliceOpenMenu.activation.eventId, "urn:observation-event:button-activation");
      assert.equal(aliceOpenMenu.activation.bindings[0].id, "urn:obs:alice-opens-file-menu-activation");
      assert.equal(aliceOpenMenu.activation.bindings[0].locators[0].contexts[0].id, "urn:locator:alice-file-row");

      const confirmShare = transitionOperation(plan, "urn:transition:alice-confirms-share");
      assert.equal(confirmShare.effects[0].id, "urn:effect:alice-confirm-share");
      assert.equal(confirmShare.effects[0].produced[0].id, "urn:artifact:federated-share");
      assert.equal(confirmShare.effects[0].produced[0].name, "report.pdf");

      const controlFlow = plan.operations.find(
        (operation): operation is ControlFlowPlanOperation =>
          operation.kind === "control-flow" &&
          operation.transition.id === "urn:transition:bob-continues-after-share-offer-cleared"
      );
      assert.ok(controlFlow);
      assert.equal(controlFlow.fromExit?.id, "urn:exit:bob-share-offer-accepted");
      assert.equal(controlFlow.toEntry?.id, "urn:entry:bob-pending-share-offer-cleared");

      const bobShares = transitionOperation(plan, "urn:transition:bob-opens-shares-overview");
      assert.equal(bobShares.activation.bindings[0].locators[0].features[0].name, "expanded");
      assert.equal(bobShares.activation.bindings[0].locators[0].features[0].value, "false");
    }
  },
  {
    name: "compiler validates malformed documents",
    async run() {
      assert.throws(
        () => parseUjgDocument('{"@id":"urn:test","@type":"UJGDocument"}'),
        /nodes array/
      );

      await assertRejectsFixtureMutation(
        (document) => {
          document.nodes.push({ ...document.nodes[0] });
        },
        /Duplicate UJG node id/
      );

      await assertRejectsFixtureMutation(
        (document) => {
          const transition = requireFixtureNode(document, "urn:transition:alice-opens-file-menu");
          transition.to = "urn:state:missing";
        },
        /Expected urn:state:missing to be State, CompositeState, or JourneyExit/
      );

      await assertRejectsFixtureMutation(
        (document) => {
          document.nodes = document.nodes.filter((node) => node["@id"] !== "urn:surface:alice-files-ready");
        },
        /Expected one Surface for urn:state:alice-files-ready, found 0/
      );

      await assertRejectsFixtureMutation(
        (document) => {
          document.nodes = document.nodes.filter(
            (node) => node["@id"] !== "urn:obs:alice-files-ready-presence"
          );
        },
        /No state ObservationBinding found/
      );

      await assertRejectsFixtureMutation(
        (document) => {
          document.nodes = document.nodes.filter(
            (node) => node["@id"] !== "urn:message-value:report-pdf-file-name:en"
          );
        },
        /Expected one Message/
      );

      await assertRejectsFixtureMutation(
        (document) => {
          document.nodes = document.nodes.filter(
            (node) => node["@id"] !== "urn:input-modality-profile:pointer"
          );
        },
        /Missing UJG node urn:input-modality-profile:pointer/
      );

      await assertRejectsFixtureMutation(
        (document) => {
          document.nodes.push({
            "@type": "Transition",
            "@id": "urn:transition:alice-ambiguous-branch",
            "label": "Ambiguous branch",
            "from": "urn:state:alice-files-ready",
            "to": "urn:state:alice-share-panel-open"
          });
          const journey = requireFixtureNode(document, "urn:journey:alice-federated-sharing");
          journey.transitionRefs = [
            ...(journey.transitionRefs as string[]),
            "urn:transition:alice-ambiguous-branch"
          ];
        },
        /Ambiguous transition branch/
      );
    }
  },
  {
    name: "profiles select expected modalities",
    async run() {
      const plan = await loadFixturePlan();
      const button = transitionOperation(plan, "urn:transition:alice-opens-file-menu");
      const textEntry = transitionOperation(plan, "urn:transition:alice-enters-remote-bob");
      const option = transitionOperation(plan, "urn:transition:alice-selects-remote-recipient");

      assert.equal(select(defaultProfile(), button).command, "pointer-click");
      assert.equal(select(defaultProfile(), textEntry).command, "keyboard-text-entry");
      assert.equal(select(keyboardOnlyProfile(), button).command, "keyboard-space");
      assert.equal(select(keyboardOnlyProfile(), option).command, "keyboard-enter");

      const pointerOnly = cloneOperation(button);
      pointerOnly.activation.requiredInputModalityProfiles =
        pointerOnly.activation.requiredInputModalityProfiles.filter((profile) =>
          profile.modalities.some((modality) => modality.id === "urn:input-modality:pointer")
        );

      assert.throws(
        () => select(keyboardOnlyProfile(), pointerOnly),
        /No supported input modality/
      );
    }
  },
  {
    name: "runner executes each profile with isolated fake adapter sessions",
    async run() {
      const plan = await loadFixturePlan();
      const calls: string[] = [];
      const adapter = fakeAdapter(calls);
      const result = await runJourney({
        plan,
        adapter,
        profiles: [defaultProfile(), keyboardOnlyProfile()]
      });

      assert.equal(result.ok, true);
      assert.deepEqual(
        result.executions.map((execution) => execution.profileId),
        ["default", "keyboard-only"]
      );
      assert.equal(calls.filter((call) => call.includes(":setup")).length, 2);
      assert.equal(calls.filter((call) => call.includes(":teardown")).length, 2);
      assert.equal(calls.filter((call) => call.includes(":open:nextcloud.files")).length, 2);
      assert.equal(calls.filter((call) => call.includes(":open:nextcloud.pendingShares")).length, 2);
      assert.ok(result.evidence.events.some((event) => event.type === "profile.modality.selected"));
      assert.ok(
        result.evidence.events.some(
          (event) => event.ujg?.transitionId === "urn:transition:alice-opens-file-menu"
        )
      );
      assert.ok(
        result.evidence.events.some(
          (event) => event.profileId === "keyboard-only" && event.type === "adapter.perform-transition.completed"
        )
      );
    }
  },
  {
    name: "runner records adapter failure and returns non-ok result",
    async run() {
      const plan = await loadFixturePlan();
      const adapter = fakeAdapter([], {
        failStateId: "urn:state:alice-files-ready"
      });
      const result = await runJourney({
        plan,
        adapter,
        profiles: [defaultProfile()]
      });

      assert.equal(result.ok, false);
      assert.equal(result.executions[0].ok, false);
      assert.match(result.errors[0].message, /Injected state failure/);
      assert.ok(
        result.evidence.events.some(
          (event) => event.type === "profile.execution.failed" && event.ok === false
        )
      );
      assert.ok(
        result.evidence.events.some(
          (event) => event.ujg?.stateId === "urn:state:alice-files-ready"
        )
      );
    }
  },
  {
    name: "playwright adapter converts role, name, context, expanded, and binding composition",
    async run() {
      const root = new FakeLocator("page");
      const driver = testPlaywrightDriver();
      const plan = await loadFixturePlan();
      const operation = transitionOperation(plan, "urn:transition:bob-opens-shares-overview");
      const locator = await toPlaywrightObservationLocator(
        root as never,
        operation.activation.bindings,
        {
          driver,
          operation,
          context: fakeDriverContext()
        }
      );

      assert.match(locator.toString(), /role=link/);
      assert.match(locator.toString(), /Shares/);
      assert.match(locator.toString(), /expanded=false/);

      const aliceOperation = transitionOperation(plan, "urn:transition:alice-opens-file-menu");
      const aliceLocator = await toPlaywrightObservationLocator(
        root as never,
        aliceOperation.activation.bindings,
        {
          driver,
          operation: aliceOperation,
          context: fakeDriverContext()
        }
      );
      assert.match(aliceLocator.toString(), /role=row/);
      assert.match(aliceLocator.toString(), /report\\.pdf/);
      assert.match(aliceLocator.toString(), /role=button/);

      const bobState = stateOperation(plan, "urn:state:bob-shared-report-visible");
      const andLocator = await toPlaywrightObservationLocator(
        root as never,
        bobState.target.bindings,
        {
          driver,
          operation: bobState,
          context: fakeDriverContext()
        }
      );
      assert.match(andLocator.toString(), /AND/);

      const orLocator = await toPlaywrightObservationLocator(
        root as never,
        [aliceOperation.activation.bindings[0], operation.activation.bindings[0]],
        {
          driver,
          operation: aliceOperation,
          context: fakeDriverContext()
        }
      );
      assert.match(orLocator.toString(), /OR/);
    }
  },
  {
    name: "playwright adapter ignores wildcard features and dispatches interactions",
    async run() {
      const plan = await loadFixturePlan();
      const operation = transitionOperation(plan, "urn:transition:alice-selects-remote-recipient");
      const context = fakeDriverContext();
      const root = new FakeLocator("page");

      await toPlaywrightObservationLocator(root as never, operation.activation.bindings, {
        driver: testPlaywrightDriver(),
        operation,
        context
      });

      assert.equal(
        context.evidence.snapshot().some((event) => event.type === "playwright.feature.resolved"),
        false
      );

      const locator = new FakeLocator("target");
      await activatePlaywrightLocator(locator as never, "pointer-click");
      await activatePlaywrightLocator(locator as never, "keyboard-enter");
      await activatePlaywrightLocator(locator as never, "keyboard-space");
      await activatePlaywrightLocator(locator as never, "keyboard-text-entry", "hello");
      assert.deepEqual(locator.actions, [
        "click",
        "press:Enter",
        "press:Space",
        "type:hello"
      ]);
    }
  },
  {
    name: "playwright adapter ignores wildcard surface instance resolvers",
    async run() {
      const plan = await loadFixturePlan();
      const operation = transitionOperation(plan, "urn:transition:alice-opens-file-menu");
      const root = new FakeLocator("page");
      const context = fakeDriverContext();
      const locator = await toPlaywrightObservationLocator(
        root as never,
        operation.activation.bindings,
        {
          driver: testPlaywrightDriver(),
          operation,
          context
        }
      );

      assert.doesNotMatch(locator.toString(), /file-id/);
      assert.equal(context.evidence.snapshot().length, 0);
    }
  },
  {
    name: "playwright adapter retains artifacts only for failed executions by default",
    async run() {
      const success = await runArtifactJourney({ locatorCount: 1 });
      assert.equal(success.result.ok, true);
      assert.equal(success.sink.attachments.length, 0);
      assert.deepEqual(success.browser.contexts[0].tracing.stopPaths, [undefined]);
      assert.equal(success.browser.contexts[0].pagesList[0].videoFile.deleted, true);

      const failure = await runArtifactJourney({ locatorCount: 0 });
      assert.equal(failure.result.ok, false);
      assert.ok(
        failure.sink.attachments.some((attachment) => attachment.name.endsWith("-trace.zip"))
      );
      assert.ok(
        failure.sink.attachments.some((attachment) => attachment.name.endsWith(".png"))
      );
      assert.ok(
        failure.sink.attachments.some((attachment) => attachment.name.endsWith(".webm"))
      );
      assert.match(String(failure.browser.contexts[0].tracing.stopPaths[0]), /traces/);
      assert.equal(failure.browser.closed, false);
    }
  },
  {
    name: "nextcloud driver creates actor sessions through adapter context hook",
    async run() {
      const plan = await loadFixturePlan();
      const operation = stateOperation(plan, "urn:state:alice-files-ready");
      const createdInputs: PlaywrightCreateBrowserContextInput[] = [];
      const browserContext = new FakeBrowserContext(1);
      const context: PlaywrightDriverExecutionContext = {
        ...fakeDriverContext(),
        createBrowserContext(input) {
          createdInputs.push(input ?? {});
          return Promise.resolve(browserContext as never);
        }
      };
      const driver = nextcloudDriver({
        touchpoints: {
          "urn:touchpoint:nextcloud-a": { baseURL: "http://example.test" }
        },
        users: {
          "urn:user:alice": { username: "alice", password: "secret" }
        },
        entries: {
          "nextcloud.files": () => undefined
        },
        login: () => undefined,
        awaitApplicationSettled: () => undefined
      });

      await driver.setupExecution(context);
      await driver.openEntry(operation, context);
      await driver.teardownExecution(context);

      assert.equal(createdInputs.length, 1);
      assert.equal(createdInputs[0].operation?.id, operation.id);
      assert.equal(createdInputs[0].label, "urn:user:alice-urn:touchpoint:nextcloud-a");
      assert.equal(browserContext.closed, true);
    }
  },
  {
    name: "nextcloud example config supplies fixture semantics outside reusable packages",
    async run() {
      const plan = await loadFixturePlan();
      assert.deepEqual(validateNextcloudEnvironmentForPlan(plan), []);
      assert.equal(typeof nextcloudEnvironment.entries["nextcloud.files"], "function");
      assert.equal(typeof nextcloudEnvironment.entries["nextcloud.pendingShares"], "function");
      assert.equal(
        typeof nextcloudEnvironment.effectHandlers?.["urn:effect:alice-confirm-share"],
        "function"
      );
      assert.equal(
        typeof nextcloudEnvironment.effectHandlers?.["urn:effect:bob-accept-share"],
        "function"
      );

      const exampleSource = await readFile(
        new URL("../examples/nextcloud-filesharing/environment.ts", import.meta.url),
        "utf8"
      );
      assert.doesNotMatch(exampleSource, /featureResolvers/);
      assert.doesNotMatch(exampleSource, /locatorFilters/);

      const reusablePackageSources = await Promise.all([
        readFile(new URL("../packages/journey-adapter-playwright/src/index.ts", import.meta.url), "utf8"),
        readFile(new URL("../packages/journey-driver-nextcloud/src/index.ts", import.meta.url), "utf8")
      ]);
      const reusableSource = reusablePackageSources.join("\n");
      assert.doesNotMatch(reusableSource, /nextcloud\.files/);
      assert.doesNotMatch(reusableSource, /nextcloud\.pendingShares/);
      assert.doesNotMatch(reusableSource, /federated-cloud-id/);
      assert.doesNotMatch(reusableSource, /urn:effect:bob-accept-share/);
      assert.doesNotMatch(reusableSource, /locatorFilters/);
    }
  },
  {
    name: "nextcloud example exposes e2e scripts without pnpm run collision",
    async run() {
      const source = await readFile(
        new URL("../examples/nextcloud-filesharing/package.json", import.meta.url),
        "utf8"
      );
      const packageJson = JSON.parse(source) as { scripts?: Record<string, string> };
      assert.equal(packageJson.scripts?.e2e, "playwright test --config playwright.config.ts");
      assert.equal(
        packageJson.scripts?.["e2e:headed"],
        "playwright test --config playwright.config.ts --headed"
      );
      assert.equal(
        packageJson.scripts?.["e2e:report"],
        "playwright show-report playwright-report"
      );
      assert.equal(packageJson.scripts?.run, undefined);
      assert.equal(packageJson.scripts?.["run:headed"], undefined);
    }
  },
  {
    name: "nextcloud example defines local Playwright Test config and evidence attachment",
    async run() {
      const configSource = await readFile(
        new URL("../examples/nextcloud-filesharing/playwright.config.ts", import.meta.url),
        "utf8"
      );
      assert.match(configSource, /testMatch:\s*"run\.ts"/);
      assert.match(configSource, /workers:\s*1/);
      assert.match(configSource, /trace:\s*"retain-on-failure"/);
      assert.match(configSource, /screenshot:\s*"only-on-failure"/);
      assert.match(configSource, /video:\s*"retain-on-failure"/);
      assert.match(configSource, /outputDir:\s*"test-results"/);
      assert.match(configSource, /outputFolder:\s*"playwright-report"/);

      const runSource = await readFile(
        new URL("../examples/nextcloud-filesharing/run.ts", import.meta.url),
        "utf8"
      );
      assert.match(runSource, /from "@playwright\/test"/);
      assert.match(runSource, /test\("executes the federated file-sharing UJG journey"/);
      assert.match(runSource, /testInfo\.attach\("ujg-evidence\.json"/);
      assert.match(runSource, /UJG_EVIDENCE_STDOUT/);
      assert.match(runSource, /browser:\s*browser as Browser/);
    }
  },
  {
    name: "nextcloud driver validates generic config and exposes URL/env helpers",
    async run() {
      assert.throws(
        () => nextcloudDriver({ touchpoints: {}, users: {}, entries: {} }),
        /at least one touchpoint/
      );
      assert.throws(
        () =>
          nextcloudDriver({
            touchpoints: { "urn:touchpoint:test": { baseURL: "http://example.test" } },
            users: {},
            entries: {}
          }),
        /at least one user/
      );
      assert.throws(
        () =>
          nextcloudDriver({
            touchpoints: { "urn:touchpoint:test": { baseURL: "http://example.test" } },
            users: { "urn:user:test": { username: "user", password: "pass" } },
            entries: {}
          }),
        /at least one entry handler/
      );

      const touchpoint = { baseURL: "http://host.docker.internal:18081" };
      const user = { username: "alice", password: "secret" };
      assert.equal(
        ocsUrl(touchpoint, "/apps/files_sharing/api/v1/shares", { path: "/report.pdf" }).href,
        "http://host.docker.internal:18081/ocs/v2.php/apps/files_sharing/api/v1/shares?format=json&path=%2Freport.pdf"
      );
      assert.equal(
        davFileUrl(touchpoint, user, "report.pdf").href,
        "http://host.docker.internal:18081/remote.php/dav/files/alice/report.pdf"
      );
      assert.equal(requiredEnv({ VALUE: "ok" }, "VALUE"), "ok");
      assert.throws(() => requiredEnv({}, "MISSING"), /Missing required environment variable/);

      const handler = openNextcloudRoute("/apps/files/");
      assert.equal(typeof handler, "function");
    }
  }
];

async function loadFixturePlan(): Promise<JourneyPlan> {
  return compileUjgJourneyPlan(await loadUjgDocument(fixtureUrl));
}

async function loadFixtureDocument(): Promise<UjgDocument> {
  return loadUjgDocument(fixtureUrl);
}

async function assertRejectsFixtureMutation(
  mutate: (document: UjgDocument) => void,
  expected: RegExp
): Promise<void> {
  const document = await loadFixtureDocument();
  mutate(document);
  await assert.rejects(() => compileUjgJourneyPlan(document), expected);
}

function requireFixtureNode(document: UjgDocument, id: string): UjgNode {
  const node = document.nodes.find((candidate) => candidate["@id"] === id);
  if (!node) throw new Error(`Missing fixture node ${id}`);
  return node;
}

function graphNodeId(operation: JourneyPlanOperation): string {
  if (operation.kind === "state") return operation.state.id;
  return operation.transition.id;
}

function stateOperation(plan: JourneyPlan, stateId: string): StatePlanOperation {
  const operation = plan.operations.find(
    (candidate): candidate is StatePlanOperation =>
      candidate.kind === "state" && candidate.state.id === stateId
  );
  assert.ok(operation, `Expected state operation ${stateId}`);
  return operation;
}

function transitionOperation(plan: JourneyPlan, transitionId: string): TransitionPlanOperation {
  const operation = plan.operations.find(
    (candidate): candidate is TransitionPlanOperation =>
      candidate.kind === "transition" && candidate.transition.id === transitionId
  );
  assert.ok(operation, `Expected transition operation ${transitionId}`);
  return operation;
}

function select(
  profile: ReturnType<typeof defaultProfile>,
  operation: TransitionPlanOperation
): InputModalityDecision {
  return profile.selectInputModality(operation, {} as AdapterExecutionContext) as InputModalityDecision;
}

function cloneOperation(operation: TransitionPlanOperation): TransitionPlanOperation {
  return structuredClone(operation) as TransitionPlanOperation;
}

function fakeAdapter(
  calls: string[],
  options: { failStateId?: string } = {}
): JourneyAdapter {
  return {
    name: "fake-adapter",

    setupExecution(context) {
      calls.push(`${context.profile.id}:setup`);
    },

    openEntry(operation, context) {
      calls.push(`${context.profile.id}:open:${operation.entryBinding?.value ?? "none"}`);
    },

    assertState(operation, context) {
      calls.push(`${context.profile.id}:state:${operation.state.id}`);
      if (operation.state.id === options.failStateId) {
        throw new Error(`Injected state failure for ${operation.state.id}`);
      }
    },

    performTransition(operation, decision, context) {
      calls.push(`${context.profile.id}:transition:${operation.transition.id}:${decision.command}`);
    },

    recordControlFlow(operation, context) {
      calls.push(`${context.profile.id}:control-flow:${operation.transition.id}`);
    },

    teardownExecution(context) {
      calls.push(`${context.profile.id}:teardown`);
    }
  };
}

async function runArtifactJourney(input: {
  locatorCount: number;
}): Promise<{
  browser: FakeBrowser;
  result: Awaited<ReturnType<typeof runJourney>>;
  sink: FakeArtifactSink;
}> {
  const sourcePlan = await loadFixturePlan();
  const operation = stateOperation(sourcePlan, "urn:state:alice-files-ready");
  const plan: JourneyPlan = {
    ...sourcePlan,
    operations: [operation]
  };
  const browser = new FakeBrowser(input.locatorCount);
  const sink = new FakeArtifactSink();
  const contextInputs: PlaywrightCreateBrowserContextInput[] = [];

  const result = await runJourney({
    plan,
    adapter: playwrightAdapter({
      driver: artifactTestDriver(contextInputs),
      browser: browser as never,
      assertionTimeoutMs: 1,
      artifacts: {
        mode: "retain-on-failure",
        sink,
        traces: true,
        screenshots: true,
        videos: true
      }
    }),
    profiles: [defaultProfile()]
  });

  assert.equal(contextInputs.length, 1);
  assert.equal(contextInputs[0].operation?.id, operation.id);
  return { browser, result, sink };
}

function artifactTestDriver(
  contextInputs: PlaywrightCreateBrowserContextInput[]
): PlaywrightJourneyDriver {
  let page: FakeArtifactPage | undefined;

  return {
    name: "artifact-test-driver",
    setupExecution() {
      return undefined;
    },
    async openEntry(operation, context) {
      const input = {
        operation,
        label: "artifact-actor"
      };
      contextInputs.push(input);
      const browserContext = await context.createBrowserContext(input);
      page = await browserContext.newPage() as unknown as FakeArtifactPage;
    },
    pageForOperation() {
      if (!page) throw new Error("Artifact test page was not created");
      return page as never;
    },
    transitionValue() {
      return undefined;
    },
    afterTransition() {
      return undefined;
    },
    recordControlFlow() {
      return undefined;
    },
    teardownExecution() {
      return undefined;
    }
  };
}

class FakeLocator {
  readonly actions: string[] = [];

  constructor(
    private readonly expression: string,
    private readonly matchCount = 1
  ) {}

  getByRole(role: string, options: { name?: RegExp; expanded?: boolean } = {}): FakeLocator {
    const parts = [`role=${role}`];
    if (options.name) parts.push(`name=${options.name.source}`);
    if (options.expanded !== undefined) parts.push(`expanded=${String(options.expanded)}`);
    return new FakeLocator(`${this.expression} >> ${parts.join(" ")}`, this.matchCount);
  }

  and(other: FakeLocator): FakeLocator {
    return new FakeLocator(
      `(${this.expression} AND ${other.expression})`,
      Math.min(this.matchCount, other.matchCount)
    );
  }

  or(other: FakeLocator): FakeLocator {
    return new FakeLocator(
      `(${this.expression} OR ${other.expression})`,
      Math.max(this.matchCount, other.matchCount)
    );
  }

  first(): FakeLocator {
    return new FakeLocator(`${this.expression}.first()`, this.matchCount);
  }

  async count(): Promise<number> {
    return this.matchCount;
  }

  async waitFor(): Promise<void> {
    return undefined;
  }

  async click(): Promise<void> {
    this.actions.push("click");
  }

  async press(key: string): Promise<void> {
    this.actions.push(`press:${key}`);
  }

  async pressSequentially(text: string): Promise<void> {
    this.actions.push(`type:${text}`);
  }

  toString(): string {
    return this.expression;
  }
}

class FakeBrowser {
  readonly contexts: FakeBrowserContext[] = [];
  closed = false;

  constructor(private readonly locatorCount: number) {}

  async newContext(options?: unknown): Promise<FakeBrowserContext> {
    const browserContext = new FakeBrowserContext(this.locatorCount, options);
    this.contexts.push(browserContext);
    return browserContext;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

class FakeBrowserContext {
  readonly pagesList: FakeArtifactPage[] = [];
  readonly tracing = new FakeTracing();
  closed = false;
  private readonly pageListeners: Array<(page: FakeArtifactPage) => void> = [];

  constructor(
    private readonly locatorCount: number,
    readonly options?: unknown
  ) {}

  on(event: string, listener: (page: FakeArtifactPage) => void): FakeBrowserContext {
    if (event === "page") {
      this.pageListeners.push(listener);
    }
    return this;
  }

  pages(): FakeArtifactPage[] {
    return [...this.pagesList];
  }

  async newPage(): Promise<FakeArtifactPage> {
    const page = new FakeArtifactPage("artifact-page", this.locatorCount);
    this.pagesList.push(page);
    for (const listener of this.pageListeners) {
      listener(page);
    }
    return page;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

class FakeTracing {
  startCalls = 0;
  readonly stopPaths: Array<string | undefined> = [];

  async start(): Promise<void> {
    this.startCalls += 1;
  }

  async stop(options?: { path?: string }): Promise<void> {
    this.stopPaths.push(options?.path);
  }
}

class FakeArtifactPage extends FakeLocator {
  readonly screenshotPaths: string[] = [];
  readonly videoFile = new FakeVideo("/private/tmp/openuji-artifact-test/video.webm");

  async screenshot(options: { path: string }): Promise<Buffer> {
    this.screenshotPaths.push(options.path);
    return Buffer.from("");
  }

  video(): FakeVideo {
    return this.videoFile;
  }
}

class FakeVideo {
  deleted = false;

  constructor(private readonly filePath: string) {}

  async path(): Promise<string> {
    return this.filePath;
  }

  async delete(): Promise<void> {
    this.deleted = true;
  }
}

class FakeArtifactSink {
  readonly attachments: Array<{
    name: string;
    path?: string;
    body?: string | Buffer;
    contentType?: string;
  }> = [];

  outputPath(...pathSegments: string[]): string {
    return `/private/tmp/openuji-artifact-test/${pathSegments.join("/")}`;
  }

  attach(
    name: string,
    attachment: { path?: string; body?: string | Buffer; contentType?: string }
  ): void {
    this.attachments.push({ name, ...attachment });
  }
}

function testPlaywrightDriver(): PlaywrightJourneyDriver {
  return {
    name: "feature-resolving-driver",
    setupExecution() {
      return undefined;
    },
    openEntry() {
      return undefined;
    },
    pageForOperation() {
      return new FakeLocator("page") as never;
    },
    transitionValue() {
      return undefined;
    },
    afterTransition() {
      return undefined;
    },
    recordControlFlow() {
      return undefined;
    },
    teardownExecution() {
      return undefined;
    }
  };
}

function fakeDriverContext(): PlaywrightDriverExecutionContext {
  return {
    runId: "test-run",
    executionId: "test-execution",
    profile: defaultProfile(),
    plan: { id: "test-plan", documentId: "urn:test", operations: [] },
    evidence: new EvidenceRecorder("test-run"),
    browser: undefined as never,
    createBrowserContext() {
      throw new Error("Unexpected test browser context creation");
    }
  };
}

let failures = 0;

for (const testCase of tests) {
  try {
    await testCase.run();
    console.log(`ok - ${testCase.name}`);
  } catch (error) {
    failures += 1;
    console.error(`not ok - ${testCase.name}`);
    console.error(error);
  }
}

if (failures > 0) {
  process.exitCode = 1;
}
