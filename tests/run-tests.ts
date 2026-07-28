import assert from "node:assert/strict";

import {
  compileUjgJourneyPlan,
  loadUjgDocument,
  parseUjgDocument,
  type UjgDocument,
  type UjgNode
} from "@openuji/journey-model-ujg";
import { defaultProfile, keyboardOnlyProfile } from "@openuji/journey-profiles";
import {
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
      assert.equal(bobShares.activation.bindings[0].locators[0].features[0].value, "true");
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
  }
];

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
