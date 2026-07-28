import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

import {
  activatePlaywrightLocator,
  playwrightAdapter,
  type PlaywrightExecutionObserver,
  type PlaywrightOperationObservation,
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
import type {
  JourneyOperation as CoreJourneyOperation,
  JourneyPlan as CoreJourneyPlan
} from "@openuji/journey-core";
import type {
  JourneyPlan as EvidenceJourneyPlan,
  JourneyPlanOperation as EvidenceJourneyPlanOperation
} from "@openuji/journey-evidence";
import type {
  JourneyPlan as ExecutionJourneyPlan,
  JourneyPlanOperation as ExecutionJourneyPlanOperation
} from "@openuji/journey-execution-model";
import {
  compileUjgJourneyPlan,
  loadUjgDocument,
  parseUjgDocument,
  type UjgDocument,
  type UjgNode
} from "@openuji/journey-model-ujg";
import {
  axeObserver,
  buildAxeAccessibilitySummaryReport,
  buildAxePathAuditReport,
  wcag22Tags,
  type AxeAuditReport,
  type AxeAuditRunnerInput,
  type AxeResults
} from "@openuji/journey-observer-axe";
import { defaultProfile, keyboardOnlyProfile } from "@openuji/journey-profiles";
import {
  EvidenceRecorder,
  runJourney,
  scopeEvidenceToExecution,
  type ControlFlowPlanOperation,
  type EvidenceEvent,
  type ExecutionResult,
  type InputModalityDecision,
  type JourneyAdapter,
  type JourneyExecutionDescriptor,
  type JourneyExecutionContext,
  type JourneyObserver,
  type JourneyPlan,
  type JourneyPlanOperation,
  type RunResult,
  type StatePlanOperation,
  type TransitionPlanOperation
} from "@openuji/journey-runner";
import {
  nextcloudEnvironment,
  validateNextcloudEnvironmentForPlan
} from "../examples/nextcloud-filesharing/environment.js";

const fixtureUrl = new URL("../examples/nextcloud-filesharing/ujg/filesharing.ujg.jsonld", import.meta.url);

const forbiddenCoreTerms = [
  "Accessible",
  "Locator",
  "Observation",
  "Modality",
  "Effect",
  "Artifact",
  "StatePlan",
  "TransitionPlan",
  "ControlFlow",
  "Ujg",
  "documentId",
  "phaseId",
  "stepId",
  "userId",
  "actorId",
  "touchpointId",
  "entryId",
  "Evidence",
  "Playwright",
  "Nextcloud",
  "Axe"
];

const movedExecutionModelTypeNames = [
  "JourneyPlan",
  "JourneyPlanOperationKind",
  "JourneyPlanOperationBase",
  "StatePlanOperation",
  "TransitionPlanOperation",
  "ControlFlowPlanOperation",
  "ResolvedAccessibleLocator",
  "InputModalityDecision",
  "ResolvedEffect"
];

type TestCase = {
  name: string;
  run: () => Promise<void> | void;
};

const tests: TestCase[] = [
  {
    name: "journey model package boundaries and compatibility re-exports stay intact",
    async run() {
      const packageSource = await readFile(
        new URL("../packages/journey-core/package.json", import.meta.url),
        "utf8"
      );
      const packageJson = JSON.parse(packageSource) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
        optionalDependencies?: Record<string, string>;
      };
      const dependencyFields = [
        "dependencies",
        "devDependencies",
        "peerDependencies",
        "optionalDependencies"
      ] as const;

      for (const field of dependencyFields) {
        for (const [dependencyName, dependencyVersion] of Object.entries(packageJson[field] ?? {})) {
          assert.equal(
            dependencyVersion.startsWith("workspace:"),
            false,
            `journey-core must not declare workspace dependency ${dependencyName}`
          );
        }
      }

      const coreSources = await readTypeScriptSources(
        new URL("../packages/journey-core/src/", import.meta.url)
      );
      assert.ok(coreSources.length > 0, "journey-core must contain TypeScript source files");

      for (const sourceFile of coreSources) {
        for (const forbiddenTerm of forbiddenCoreTerms) {
          assert.equal(
            sourceFile.source.includes(forbiddenTerm),
            false,
            `journey-core must stay model-agnostic; found ${forbiddenTerm} in ${sourceFile.path}`
          );
        }
      }

      const executionModelPackageSource = await readFile(
        new URL("../packages/journey-execution-model/package.json", import.meta.url),
        "utf8"
      );
      const executionModelPackageJson = JSON.parse(executionModelPackageSource) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
        optionalDependencies?: Record<string, string>;
      };
      assert.deepEqual(
        executionModelPackageJson.dependencies,
        { "@openuji/journey-core": "workspace:*" },
        "journey-execution-model must depend only on journey-core"
      );

      for (const field of ["devDependencies", "peerDependencies", "optionalDependencies"] as const) {
        assert.deepEqual(
          executionModelPackageJson[field] ?? {},
          {},
          `journey-execution-model must not declare ${field}`
        );
      }

      const packageSources = await readTypeScriptSources(
        new URL("../packages/", import.meta.url)
      );
      const executionModelSourcePath = new URL(
        "../packages/journey-execution-model/src/index.ts",
        import.meta.url
      ).pathname;
      for (const typeName of movedExecutionModelTypeNames) {
        const definitions = packageSources.filter((sourceFile) =>
          sourceFile.source.includes(`export type ${typeName} =`) ||
          sourceFile.source.includes(`export type ${typeName}<`)
        );
        assert.deepEqual(
          definitions.map((definition) => definition.path),
          [executionModelSourcePath],
          `${typeName} must be defined only in journey-execution-model`
        );
      }

      const compilerPackageSource = await readFile(
        new URL("../packages/journey-model-ujg/package.json", import.meta.url),
        "utf8"
      );
      const compilerPackageJson = JSON.parse(compilerPackageSource) as {
        dependencies?: Record<string, string>;
      };
      assert.equal(
        compilerPackageJson.dependencies?.["@openuji/journey-execution-model"],
        "workspace:*",
        "journey-model-ujg must depend on journey-execution-model"
      );
      assert.equal(
        compilerPackageJson.dependencies?.["@openuji/journey-evidence"],
        undefined,
        "journey-model-ujg must not depend on journey-evidence"
      );

      const compilerSources = await readTypeScriptSources(
        new URL("../packages/journey-model-ujg/src/", import.meta.url)
      );
      for (const sourceFile of compilerSources) {
        assert.equal(
          sourceFile.source.includes('from "@openuji/journey-evidence"'),
          false,
          `journey-model-ujg must import execution-model instead of evidence: ${sourceFile.path}`
        );
      }

      const executionModelSource = await readFile(
        new URL("../packages/journey-execution-model/src/index.ts", import.meta.url),
        "utf8"
      );
      for (const forbiddenPattern of ["phaseId:", "stepId:", "userId:"]) {
        assert.equal(
          executionModelSource.includes(forbiddenPattern),
          false,
          `journey-execution-model must not expose UJG provenance field ${forbiddenPattern}`
        );
      }

      for (const sourceFile of packageSources) {
        assert.equal(
          sourceFile.source.includes("ujg:"),
          false,
          `evidence events must use references, not ujg: ${sourceFile.path}`
        );
      }

      const runtimeSourcePackages = [
        "/packages/journey-runner/src/",
        "/packages/journey-profiles/src/",
        "/packages/journey-adapter-playwright/src/",
        "/packages/journey-driver-nextcloud/src/",
        "/packages/journey-observer-axe/src/"
      ];
      const runtimeSources = packageSources.filter((sourceFile) =>
        runtimeSourcePackages.some((packagePath) => sourceFile.path.includes(packagePath))
      );
      const forbiddenRuntimeOperationFields = [
        "operation.documentId",
        "operation.phaseId",
        "operation.stepId",
        "operation.userId"
      ];
      const forbiddenSourceReferenceReads = [
        "source.references.phaseId",
        "source.references.stepId",
        '["phaseId"]',
        '["stepId"]'
      ];

      for (const sourceFile of runtimeSources) {
        for (const forbiddenPattern of [
          ...forbiddenRuntimeOperationFields,
          ...forbiddenSourceReferenceReads
        ]) {
          assert.equal(
            sourceFile.source.includes(forbiddenPattern),
            false,
            `runtime packages must not inspect UJG-specific source fields: ${forbiddenPattern} in ${sourceFile.path}`
          );
        }
      }

      const runnerAndPlaywrightAdapterSources = packageSources.filter(
        (sourceFile) =>
          sourceFile.path.includes("/packages/journey-runner/src/") ||
          sourceFile.path.includes("/packages/journey-adapter-playwright/src/")
      );
      for (const sourceFile of runnerAndPlaywrightAdapterSources) {
        assert.doesNotMatch(
          sourceFile.source,
          /\bsetupExecution\s*\(|\bteardownExecution\s*\(/,
          `runner and Playwright adapter must use execution sessions: ${sourceFile.path}`
        );
      }

      for (const sourceFile of packageSources) {
        const compactSource = sourceFile.source.replace(/\s+/g, " ");
        assert.equal(
          compactSource.includes("openEntry(operation, context)") ||
            compactSource.includes("assertState(operation, context)") ||
            compactSource.includes("recordControlFlow(operation, context)") ||
            compactSource.includes("performTransition(operation, decision, context)"),
          false,
          `adapter operations must not receive context per method: ${sourceFile.path}`
        );
      }

      const playwrightSources = packageSources.filter((sourceFile) =>
        sourceFile.path.includes("/packages/journey-adapter-playwright/src/")
      );
      for (const sourceFile of playwrightSources) {
        for (const forbiddenPattern of [
          "AdapterExecutionState",
          "requireExecutionState",
          "undefined as unknown as",
          "evidence.snapshot",
          "PlaywrightTransitionValueInput"
        ]) {
          assert.equal(
            sourceFile.source.includes(forbiddenPattern),
            false,
            `Playwright adapter must not retain old execution-state patterns: ${forbiddenPattern} in ${sourceFile.path}`
          );
        }
      }

      const nextcloudSources = packageSources.filter((sourceFile) =>
        sourceFile.path.includes("/packages/journey-driver-nextcloud/src/")
      );
      for (const sourceFile of nextcloudSources) {
        for (const forbiddenPattern of [
          "ExecutionState",
          "contextForExecution",
          "executions.get(context.executionId)"
        ]) {
          assert.equal(
            sourceFile.source.includes(forbiddenPattern),
            false,
            `Nextcloud driver must not retain old execution registry patterns: ${forbiddenPattern} in ${sourceFile.path}`
          );
        }
      }

      const recorderReferences = packageSources.filter((sourceFile) =>
        sourceFile.source.includes("EvidenceRecorder")
      );
      for (const sourceFile of recorderReferences) {
        assert.equal(
          sourceFile.path.includes("/packages/journey-evidence/src/") ||
            sourceFile.path.includes("/packages/journey-runner/src/"),
          true,
          `Only evidence and runner packages may reference EvidenceRecorder: ${sourceFile.path}`
        );
      }

      const snapshotReaders = packageSources.filter((sourceFile) =>
        sourceFile.source.includes(".snapshot()")
      );
      for (const sourceFile of snapshotReaders) {
        assert.equal(
          sourceFile.path.includes("/packages/journey-evidence/src/") ||
            sourceFile.path.endsWith("/packages/journey-runner/src/index.ts"),
          true,
          `Only evidence implementation and runner result construction may read evidence logs: ${sourceFile.path}`
        );
      }

      for (const sourceFile of packageSources) {
        assert.equal(
          sourceFile.source.includes("context.evidence"),
          false,
          `Execution contexts must not expose evidence: ${sourceFile.path}`
        );
      }

      const rawEmitSources = packageSources.filter((sourceFile) =>
        sourceFile.source.includes(".emit({")
      );
      for (const sourceFile of rawEmitSources) {
        assert.equal(
          sourceFile.path.includes("/packages/journey-evidence/src/") ||
            sourceFile.path.includes("/packages/journey-runner/src/evidence/") ||
            sourceFile.path.includes("/packages/journey-adapter-playwright/src/evidence/") ||
            sourceFile.path.includes("/packages/journey-driver-nextcloud/src/evidence/"),
          true,
          `Raw evidence emission must live in evidence projectors: ${sourceFile.path}`
        );
      }

      const evidenceFreeSources = packageSources.filter((sourceFile) =>
        sourceFile.path.includes("/packages/journey-observer-axe/src/") ||
        sourceFile.path.includes("/packages/journey-profiles/src/")
      );
      for (const sourceFile of evidenceFreeSources) {
        for (const forbiddenPattern of [
          "EvidenceRecorder",
          "EvidenceSink",
          "ExecutionEvidenceSink"
        ]) {
          assert.equal(
            sourceFile.source.includes(forbiddenPattern),
            false,
            `Observers and profiles must not receive evidence capabilities: ${forbiddenPattern} in ${sourceFile.path}`
          );
        }
      }

      const runnerSource = packageSources.find((sourceFile) =>
        sourceFile.path.endsWith("/packages/journey-runner/src/index.ts")
      );
      assert.ok(runnerSource);
      assert.doesNotMatch(
        runnerSource.source.replace(/\s+/g, " "),
        /JourneyObserverRunStartedInput = \{[^}]*evidence/
      );
      assert.doesNotMatch(
        runnerSource.source.replace(/\s+/g, " "),
        /JourneyObserverRunCompletedInput = \{[^}]*evidence/
      );

      for (const sourceFile of packageSources) {
        for (const forbiddenPattern of [
          "context.observers",
          "observers: readonly JourneyObserver"
        ]) {
          assert.equal(
            sourceFile.source.includes(forbiddenPattern),
            false,
            `execution contexts must not carry observer collections: ${forbiddenPattern} in ${sourceFile.path}`
          );
        }
      }

      for (const sourceFile of playwrightSources) {
        for (const forbiddenPattern of [
          "isPlaywrightJourneyObserver",
          "filter(isPlaywright"
        ]) {
          assert.equal(
            sourceFile.source.includes(forbiddenPattern),
            false,
            `Playwright observers must be explicitly configured: ${forbiddenPattern} in ${sourceFile.path}`
          );
        }
      }

      const playwrightAndAxeSources = packageSources.filter(
        (sourceFile) =>
          sourceFile.path.includes("/packages/journey-adapter-playwright/src/") ||
          sourceFile.path.includes("/packages/journey-observer-axe/src/")
      );
      for (const sourceFile of playwrightAndAxeSources) {
        assert.equal(
          sourceFile.source.includes("JourneyObserver &"),
          false,
          `Playwright-specific observers must not inherit JourneyObserver: ${sourceFile.path}`
        );
      }

      for (const sourceFile of nextcloudSources) {
        for (const forbiddenPattern of [
          "JourneyObserver",
          "PlaywrightExecutionObserver"
        ]) {
          assert.equal(
            sourceFile.source.includes(forbiddenPattern),
            false,
            `Nextcloud driver must not access observer roles: ${forbiddenPattern} in ${sourceFile.path}`
          );
        }
      }

      const observerInputSources = playwrightAndAxeSources.filter(
        (sourceFile) =>
          sourceFile.path.includes("/packages/journey-adapter-playwright/src/observers/") ||
          sourceFile.path.includes("/packages/journey-observer-axe/src/")
      );
      for (const sourceFile of observerInputSources) {
        assert.equal(
          sourceFile.source.includes("context: PlaywrightDriverExecutionContext"),
          false,
          `Playwright observer inputs must not expose driver execution contexts: ${sourceFile.path}`
        );
      }

      const testSources = await readTypeScriptSources(
        new URL("../tests/", import.meta.url)
      );
      const exampleSources = await readTypeScriptSources(
        new URL("../examples/", import.meta.url)
      );
      const forbiddenObserverCast = "as " + "JourneyObserver";
      for (const sourceFile of [...packageSources, ...testSources, ...exampleSources]) {
        assert.equal(
          sourceFile.source.includes(forbiddenObserverCast),
          false,
          `Playwright observers must not be registered through JourneyObserver casts: ${sourceFile.path}`
        );
      }

      const ujgRefSetDefinitions = packageSources.filter((sourceFile) =>
        sourceFile.source.includes("UjgRefSet")
      );
      assert.deepEqual(
        ujgRefSetDefinitions.map((definition) => definition.path),
        [new URL("../packages/journey-evidence/src/index.ts", import.meta.url).pathname],
        "UjgRefSet may exist only as the evidence compatibility alias"
      );

      const directPlan: ExecutionJourneyPlan = await compileUjgJourneyPlan(
        await loadUjgDocument(fixtureUrl)
      );
      const evidencePlanFromDirect: EvidenceJourneyPlan = directPlan;
      const runnerPlanFromEvidence: JourneyPlan = evidencePlanFromDirect;
      assertCoreCompatiblePlan(directPlan);
      assertCoreCompatibleOperation(directPlan.operations[0]);
      assertCoreCompatiblePlan(evidencePlanFromDirect);
      assertCoreCompatibleOperation(evidencePlanFromDirect.operations[0]);
      assertCoreCompatiblePlan(runnerPlanFromEvidence);
      assertCoreCompatibleOperation(runnerPlanFromEvidence.operations[0]);

      const evidencePlan: EvidenceJourneyPlan = await loadFixturePlan();
      assertCoreCompatiblePlan(evidencePlan);
      assertCoreCompatibleOperation(evidencePlan.operations[0]);
    }
  },
  {
    name: "compiler produces the expected v1 operation sequence",
    async run() {
      const plan = await loadFixturePlan();
      assert.equal(plan.source?.model, "ujg");
      assert.equal(plan.source?.documentId, "urn:ujg:document:nextcloud-federated-sharing");
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
      assert.equal(aliceReady.actorId, "urn:user:alice");
      assert.equal(aliceReady.touchpointId, "urn:touchpoint:nextcloud-a");
      assert.equal(aliceReady.source?.references?.phaseId, "urn:phase:remote-share-offered");
      assert.equal(aliceReady.source?.references?.stepId, "urn:step:alice-federated-sharing");
      assert.equal(aliceReady.source?.references?.graphNodeId, "urn:state:alice-files-ready");
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
      assert.equal(calls.filter((call) => call.includes(":create")).length, 2);
      assert.equal(calls.filter((call) => call.includes(":open:nextcloud.files")).length, 2);
      assert.equal(calls.filter((call) => call.includes(":open:nextcloud.pendingShares")).length, 2);
      assert.ok(result.evidence.events.some((event) => event.type === "profile.modality.selected"));
      assert.ok(
        result.evidence.events.some(
          (event) => event.references?.transitionId === "urn:transition:alice-opens-file-menu"
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
    name: "runner creates one isolated adapter execution per profile",
    async run() {
      const plan: JourneyPlan = { id: "session-isolation-plan", operations: [] };
      const calls: string[] = [];
      const adapter: JourneyAdapter = {
        name: "session-isolation-adapter",
        createExecution(input) {
          const { context } = input;
          let localCounter = 0;
          calls.push(`${context.executionId}:create`);

          return {
            start() {
              localCounter += 1;
              calls.push(`${context.executionId}:start:${localCounter}`);
            },
            openEntry() {
              localCounter += 1;
            },
            assertState() {
              localCounter += 1;
            },
            performTransition() {
              localCounter += 1;
            },
            recordControlFlow() {
              localCounter += 1;
            },
            close(input) {
              localCounter += 1;
              calls.push(`${context.executionId}:close:${localCounter}:${String(input.executionFailed)}`);
            }
          };
        }
      };

      const result = await runJourney({
        plan,
        adapter,
        profiles: [defaultProfile(), keyboardOnlyProfile()]
      });

      assert.equal(result.ok, true);
      assert.deepEqual(calls, [
        "default-01:create",
        "default-01:start:1",
        "default-01:close:2:false",
        "keyboard-only-02:create",
        "keyboard-only-02:start:1",
        "keyboard-only-02:close:2:false"
      ]);
    }
  },
  {
    name: "runner accepts source-neutral manually constructed plans",
    async run() {
      const minimalResult = await runJourney({
        plan: {
          id: "minimal-custom-plan",
          operations: []
        },
        adapter: fakeAdapter([]),
        profiles: [defaultProfile()]
      });

      assert.equal(minimalResult.ok, true);
      assert.deepEqual(minimalResult.plan, { id: "minimal-custom-plan" });
      assert.equal(
        minimalResult.evidence.events.some((event) => "ujg" in event),
        false
      );

      const plan: JourneyPlan = {
        id: "custom-plan",
        source: {
          model: "custom-workflow",
          documentId: "workflow-42",
          references: {
            workflowVersion: "3"
          }
        },
        operations: [
          {
            id: "operation-1",
            sequence: 0,
            kind: "state",
            actorId: "actor-a",
            touchpointId: "web",
            entry: {
              id: "entry-a",
              stateId: "state-a"
            },
            source: {
              references: {
                taskId: "task-7"
              }
            },
            state: {
              id: "state-a"
            },
            surface: {
              id: "surface-a"
            },
            target: {
              observation: {
                stateId: "state-a",
                surfaceId: "surface-a",
                expectedMatchCount: 1,
                bindings: []
              },
              expectedMatchCount: 1,
              bindings: []
            }
          }
        ]
      };

      const result = await runJourney({
        plan,
        adapter: fakeAdapter([]),
        profiles: [defaultProfile()]
      });
      const operationStarted = result.evidence.events.find(
        (event) => event.type === "operation.started"
      );

      assert.equal(result.ok, true);
      assert.equal(result.plan.source?.model, "custom-workflow");
      assert.equal(result.plan.source?.documentId, "workflow-42");
      assert.equal(operationStarted?.references?.actorId, "actor-a");
      assert.equal(operationStarted?.references?.source?.model, "custom-workflow");
      assert.equal(operationStarted?.references?.source?.documentId, "workflow-42");
      assert.equal(
        operationStarted?.references?.source?.planReferences?.workflowVersion,
        "3"
      );
      assert.equal(
        operationStarted?.references?.source?.operationReferences?.taskId,
        "task-7"
      );
      assert.equal(
        result.evidence.events.some((event) => "ujg" in event),
        false
      );
    }
  },
  {
    name: "runner records adapter failure and returns non-ok result",
    async run() {
      const plan = await loadFixturePlan();
      const closeInputs: boolean[] = [];
      const adapter = fakeAdapter([], {
        failStateId: "urn:state:alice-files-ready",
        onClose(input) {
          closeInputs.push(input.executionFailed);
        }
      });
      const result = await runJourney({
        plan,
        adapter,
        profiles: [defaultProfile()]
      });

      assert.equal(result.ok, false);
      assert.equal(result.executions[0].ok, false);
      assert.deepEqual(closeInputs, [true]);
      assert.match(result.errors[0].message, /Injected state failure/);
      assert.ok(
        result.evidence.events.some(
          (event) => event.type === "profile.execution.failed" && event.ok === false
        )
      );
      assert.ok(
        result.evidence.events.some(
          (event) => event.references?.stateId === "urn:state:alice-files-ready"
        )
      );
    }
  },
  {
    name: "runner closes startup failures but skips close when adapter creation fails",
    async run() {
      const plan: JourneyPlan = { id: "adapter-startup-failure-plan", operations: [] };
      const startupCalls: string[] = [];
      const startupCloseInputs: boolean[] = [];
      const startupResult = await runJourney({
        plan,
        adapter: fakeAdapter(startupCalls, {
          failStart: true,
          onClose(input) {
            startupCloseInputs.push(input.executionFailed);
          }
        }),
        profiles: [defaultProfile()]
      });

      assert.equal(startupResult.ok, false);
      assert.deepEqual(startupCloseInputs, [true]);
      assert.deepEqual(startupCalls, ["default:create", "default:setup", "default:teardown"]);

      const creationCalls: string[] = [];
      const creationCloseInputs: boolean[] = [];
      const creationResult = await runJourney({
        plan,
        adapter: fakeAdapter(creationCalls, {
          failCreate: true,
          onClose(input) {
            creationCloseInputs.push(input.executionFailed);
          }
        }),
        profiles: [defaultProfile()]
      });

      assert.equal(creationResult.ok, false);
      assert.deepEqual(creationCloseInputs, []);
      assert.deepEqual(creationCalls, ["default:create"]);
    }
  },
  {
    name: "runner closes exactly once before execution-completed observer failures",
    async run() {
      const plan: JourneyPlan = { id: "observer-completion-failure-plan", operations: [] };
      const closeInputs: boolean[] = [];
      const calls: string[] = [];
      const result = await runJourney({
        plan,
        adapter: fakeAdapter(calls, {
          onClose(input) {
            closeInputs.push(input.executionFailed);
          }
        }),
        profiles: [defaultProfile()],
        observers: [
          {
            name: "execution-completed-failure",
            onExecutionCompleted() {
              throw new Error("Injected execution completion observer failure");
            }
          }
        ]
      });

      assert.equal(result.ok, false);
      assert.deepEqual(closeInputs, [false]);
      assert.equal(calls.filter((call) => call === "default:teardown").length, 1);
      assert.match(result.errors[0].message, /Injected execution completion observer failure/);
    }
  },
  {
    name: "runner calls observer lifecycle hooks with descriptors and keeps adapter contexts isolated",
    async run() {
      const sourcePlan = await loadFixturePlan();
      const plan: JourneyPlan = {
        ...sourcePlan,
        operations: [stateOperation(sourcePlan, "urn:state:alice-files-ready")]
      };
      const calls: string[] = [];
      const capabilityChecks: boolean[] = [];
      const observer: JourneyObserver = {
        name: "test-observer",
        onRunStarted(input) {
          calls.push(
            `run-started:${input.runId}:${input.profiles[0]?.id ?? "none"}:${input.adapter.name}`
          );
          capabilityChecks.push(!("selectInputModality" in input.profiles[0]));
          capabilityChecks.push(!("createExecution" in input.adapter));
        },
        onExecutionStarted({ execution }) {
          calls.push(`execution-started:${execution.executionId}:${execution.profile.id}`);
          capabilityChecks.push(!("selectInputModality" in execution.profile));
          capabilityChecks.push(!("observers" in execution));
        },
        onExecutionCompleted({ execution, result }) {
          calls.push(`execution-completed:${execution.executionId}:${String(result.ok)}`);
          capabilityChecks.push(!("context" in result));
        },
        onRunCompleted({ result }) {
          calls.push(`run-completed:${result.executions.length}:${String(result.ok)}`);
        }
      };
      const adapterContextHasObservers: boolean[] = [];
      const adapter = fakeAdapter(calls, {
        onCreate(context) {
          adapterContextHasObservers.push("observers" in context);
        }
      });

      const result = await runJourney({
        plan,
        adapter,
        profiles: [defaultProfile()],
        observers: [observer],
        runId: "observer-run"
      });

      assert.equal(result.ok, true);
      assert.deepEqual(adapterContextHasObservers, [false]);
      assert.deepEqual(capabilityChecks, [true, true, true, true, true]);
      assert.deepEqual(calls.filter((call) => call.startsWith("run-")), [
        "run-started:observer-run:default:fake-adapter",
        "run-completed:1:true"
      ]);
      assert.ok(calls.includes("execution-started:default-01:default"));
      assert.ok(calls.includes("execution-completed:default-01:true"));
      assert.ok(result.evidence.events.some((event) => event.type === "observer.run-started.completed"));
      assert.ok(
        result.evidence.events.some((event) => event.type === "observer.execution-completed.completed")
      );
    }
  },
  {
    name: "runner records observer failures as evidence and non-ok results",
    async run() {
      const sourcePlan = await loadFixturePlan();
      const plan: JourneyPlan = {
        ...sourcePlan,
        operations: [stateOperation(sourcePlan, "urn:state:alice-files-ready")]
      };
      const observer: JourneyObserver = {
        name: "failing-observer",
        onExecutionStarted() {
          throw new Error("Injected observer failure");
        }
      };
      const result = await runJourney({
        plan,
        adapter: fakeAdapter([]),
        profiles: [defaultProfile()],
        observers: [observer]
      });

      assert.equal(result.ok, false);
      assert.match(result.errors[0].message, /Injected observer failure/);
      assert.ok(
        result.evidence.events.some(
          (event) => event.type === "observer.execution-started.failed" && event.ok === false
        )
      );
    }
  },
  {
    name: "evidence characterization covers scoped runner, playwright, and nextcloud events",
    async run() {
      const emptyPlan: JourneyPlan = { id: "characterization-empty-plan", operations: [] };
      const singleProfile = await runJourney({
        plan: emptyPlan,
        adapter: fakeAdapter([]),
        profiles: [defaultProfile()],
        runId: "characterization-single"
      });
      assertEventTypes(singleProfile, [
        "runner.run.started",
        "profile.execution.started",
        "adapter.setup.started",
        "adapter.setup.completed",
        "adapter.teardown.started",
        "adapter.teardown.completed",
        "profile.execution.completed",
        "runner.run.completed"
      ]);

      const twoProfiles = await runJourney({
        plan: emptyPlan,
        adapter: fakeAdapter([]),
        profiles: [defaultProfile(), keyboardOnlyProfile()],
        runId: "characterization-two-profile"
      });
      assertEventTypes(twoProfiles, [
        "runner.run.started",
        "profile.execution.started",
        "adapter.setup.started",
        "adapter.setup.completed",
        "adapter.teardown.started",
        "adapter.teardown.completed",
        "profile.execution.completed",
        "profile.execution.started",
        "adapter.setup.started",
        "adapter.setup.completed",
        "adapter.teardown.started",
        "adapter.teardown.completed",
        "profile.execution.completed",
        "runner.run.completed"
      ]);

      const sourcePlan = await loadFixturePlan();
      const state = stateOperation(sourcePlan, "urn:state:alice-files-ready");
      const failingState = await runJourney({
        plan: { ...sourcePlan, operations: [state] },
        adapter: fakeAdapter([], { failStateId: state.state.id }),
        profiles: [defaultProfile()],
        runId: "characterization-state-failure"
      });
      assertEventTypes(failingState, [
        "runner.run.started",
        "profile.execution.started",
        "adapter.setup.started",
        "adapter.setup.completed",
        "operation.started",
        "adapter.open-entry.started",
        "adapter.open-entry.completed",
        "adapter.assert-state.started",
        "profile.execution.failed",
        "adapter.teardown.started",
        "adapter.teardown.completed",
        "profile.execution.completed",
        "runner.run.completed"
      ]);
      assert.equal(failingState.evidence.events[4].operationId, state.id);
      assert.equal(failingState.evidence.events[4].references?.stateId, state.state.id);

      const startupFailure = await runJourney({
        plan: emptyPlan,
        adapter: fakeAdapter([], { failStart: true }),
        profiles: [defaultProfile()],
        runId: "characterization-startup-failure"
      });
      assertEventTypes(startupFailure, [
        "runner.run.started",
        "profile.execution.started",
        "adapter.setup.started",
        "profile.execution.failed",
        "adapter.teardown.started",
        "adapter.teardown.completed",
        "profile.execution.completed",
        "runner.run.completed"
      ]);

      const closeFailure = await runJourney({
        plan: emptyPlan,
        adapter: fakeAdapter([], { failClose: true }),
        profiles: [defaultProfile()],
        runId: "characterization-close-failure"
      });
      assertEventTypes(closeFailure, [
        "runner.run.started",
        "profile.execution.started",
        "adapter.setup.started",
        "adapter.setup.completed",
        "adapter.teardown.started",
        "adapter.teardown.failed",
        "profile.execution.completed",
        "runner.run.completed"
      ]);

      const observerFailure = await runJourney({
        plan: emptyPlan,
        adapter: fakeAdapter([]),
        profiles: [defaultProfile()],
        observers: [
          {
            name: "characterization-observer",
            onExecutionStarted() {
              throw new Error("Injected characterization observer failure");
            }
          }
        ],
        runId: "characterization-observer-failure"
      });
      assertEventTypes(observerFailure, [
        "runner.run.started",
        "profile.execution.started",
        "observer.execution-started.started",
        "observer.execution-started.failed",
        "profile.execution.failed",
        "profile.execution.completed",
        "runner.run.completed"
      ]);

      const reporterFailure = await runJourney({
        plan: emptyPlan,
        adapter: fakeAdapter([]),
        profiles: [defaultProfile()],
        reporters: [
          {
            name: "characterization-reporter",
            report() {
              throw new Error("Injected characterization reporter failure");
            }
          }
        ],
        runId: "characterization-reporter-failure"
      });
      assertIncludesEventTypes(reporterFailure, [
        "reporter.started",
        "reporter.failed",
        "runner.run.completed"
      ]);

      const nextcloudEvents = await runCharacterizationNextcloudExecution(state);
      assert.deepEqual(eventTypes(nextcloudEvents), [
        "nextcloud.execution.setup.started",
        "nextcloud.execution.setup.completed",
        "nextcloud.actor.session.created",
        "nextcloud.entry.opened",
        "nextcloud.execution.teardown.completed"
      ]);

      const observations: string[] = [];
      const playwrightObserver: PlaywrightExecutionObserver = {
        name: "characterization-playwright-observer",
        onExecutionStarted({ execution }) {
          observations.push(`started:${execution.executionId}`);
        },
        observeOperation(observation) {
          observations.push(observation.stage);
        }
      };
      const playwrightObserverResult = await runJourney({
        plan: { ...sourcePlan, operations: [state] },
        adapter: playwrightAdapter({
          driver: contextTestDriver([]),
          browser: new FakeBrowser(1) as never,
          assertionTimeoutMs: 1,
          executionObservers: [playwrightObserver]
        }),
        profiles: [defaultProfile()],
        runId: "characterization-playwright-observer"
      });
      assert.deepEqual(observations, ["started:default-01", "state-asserted"]);
      assertIncludesEventTypes(playwrightObserverResult, [
        "playwright.observer.execution-started.started",
        "playwright.observer.execution-started.completed",
        "playwright.observer.operation.started",
        "playwright.observer.operation.completed"
      ]);
      assert.equal(
        playwrightObserverResult.evidence.events.some((event) => event.type.startsWith("observer.")),
        false
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
      assert.match(locator.toString(), /expanded=true/);

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

      assert.equal("evidence" in context, false);

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
      assert.equal("evidence" in context, false);
    }
  },
  {
    name: "playwright adapter enforces execution lifecycle and idempotent owned-browser close",
    async run() {
      const sourcePlan = await loadFixturePlan();
      const operation = stateOperation(sourcePlan, "urn:state:alice-files-ready");
      const browser = new FakeBrowser(1);
      let launchCalls = 0;
      const adapter = playwrightAdapter({
        driver: testPlaywrightDriver(),
        browserType: {
          async launch() {
            launchCalls += 1;
            return browser as never;
          }
        },
        assertionTimeoutMs: 1
      });
      const context = {
        ...fakeDriverContext(),
        plan: {
          ...sourcePlan,
          operations: [operation]
        }
      };
      const execution = adapter.createExecution(fakeAdapterExecutionInput(context).input);

      await assert.rejects(async () => {
        await execution.assertState(operation);
      }, /not started/);
      await execution.start();
      await execution.close({ executionFailed: false });
      await execution.close({ executionFailed: false });
      await assert.rejects(async () => {
        await execution.assertState(operation);
      }, /not started/);

      assert.equal(launchCalls, 1);
      assert.equal(browser.closeCalls, 1);
    }
  },
  {
    name: "playwright adapter releases attached browsers without closing them",
    async run() {
      const browser = new FakeBrowser(1);
      const context = fakeDriverContext();
      const evidenceInput = fakeAdapterExecutionInput(context);
      const adapter = playwrightAdapter({
        driver: testPlaywrightDriver(),
        browser: browser as never,
        assertionTimeoutMs: 1
      });
      const execution = adapter.createExecution(evidenceInput.input);

      await execution.start();
      await execution.close({ executionFailed: false });

      assert.equal(browser.closeCalls, 0);
      assert.ok(
        evidenceInput.recorder.snapshot().some((event) => event.type === "playwright.browser.released")
      );
    }
  },
  {
    name: "playwright adapter cleans up browser after partial driver startup failure",
    async run() {
      const browser = new FakeBrowser(1);
      const driverCloseInputs: boolean[] = [];
      const driver: PlaywrightJourneyDriver = {
        name: "failing-start-driver",
        createExecution() {
          return {
            start() {
              throw new Error("Injected Playwright driver startup failure");
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
            close(input) {
              driverCloseInputs.push(input.executionFailed);
            }
          };
        }
      };
      const adapter = playwrightAdapter({
        driver,
        browserType: {
          async launch() {
            return browser as never;
          }
        },
        assertionTimeoutMs: 1
      });
      const execution = adapter.createExecution(fakeAdapterExecutionInput(fakeDriverContext()).input);

      await assert.rejects(async () => {
        await execution.start();
      }, /Injected Playwright driver startup failure/);
      await execution.close({ executionFailed: true });

      assert.equal(browser.closeCalls, 1);
      assert.deepEqual(driverCloseInputs, [true]);
    }
  },
  {
    name: "playwright adapter notifies observers for state, transition, and control-flow operations",
    async run() {
      const sourcePlan = await loadFixturePlan();
      const state = stateOperation(sourcePlan, "urn:state:alice-files-ready");
      const transition = transitionOperation(sourcePlan, "urn:transition:alice-opens-file-menu");
      const controlFlow = sourcePlan.operations.find(
        (operation): operation is ControlFlowPlanOperation => operation.kind === "control-flow"
      );
      assert.ok(controlFlow);

      const plan: JourneyPlan = {
        ...sourcePlan,
        operations: [state, transition, controlFlow]
      };
      const browser = new FakeBrowser(1);
      const observations: string[] = [];
      const observer: PlaywrightExecutionObserver = {
        name: "playwright-test-observer",
        onExecutionStarted({ execution }) {
          observations.push(`execution-started:${execution.executionId}`);
        },
        observeOperation(observation: PlaywrightOperationObservation) {
          observations.push(
            `${observation.stage}:${observation.operation.kind}:${observation.operation.id}`
          );
          if (observation.stage === "transition-ready") {
            assert.equal((observation.locator as unknown as FakeLocator).actions.length, 0);
          }
        }
      };

      const result = await runJourney({
        plan,
        adapter: playwrightAdapter({
          driver: contextTestDriver([]),
          browser: browser as never,
          assertionTimeoutMs: 1,
          executionObservers: [observer]
        }),
        profiles: [defaultProfile()]
      });

      assert.equal(result.ok, true);
      assert.deepEqual(observations.map((entry) => entry.split(":").slice(0, 2).join(":")), [
        "execution-started:default-01",
        "state-asserted:state",
        "transition-ready:transition",
        "control-flow-recorded:control-flow"
      ]);
      assert.ok(
        result.evidence.events.some(
          (event) => event.type === "playwright.observer.execution-started.completed"
        )
      );
      assert.ok(
        result.evidence.events.some((event) => event.type === "playwright.observer.operation.completed")
      );
    }
  },
  {
    name: "nextcloud driver owns actor sessions per driver execution",
    async run() {
      const plan = await loadFixturePlan();
      const operation = stateOperation(plan, "urn:state:alice-files-ready");
      const createdInputs: PlaywrightCreateBrowserContextInput[] = [];
      const browserContext = new FakeBrowserContext(1);
      const entryContexts: unknown[] = [];
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
          "nextcloud.files": ({ context }) => {
            entryContexts.push(context);
          }
        },
        login: () => undefined,
        awaitApplicationSettled: () => undefined
      });

      const execution = driver.createExecution(fakeDriverExecutionInput(context).input);
      await execution.start();
      await execution.openEntry(operation);
      await execution.openEntry(operation);
      await execution.close({ executionFailed: false });

      assert.equal(createdInputs.length, 1);
      assert.equal(createdInputs[0].operation?.id, operation.id);
      assert.equal(createdInputs[0].label, "urn:user:alice-urn:touchpoint:nextcloud-a");
      assert.equal(entryContexts.length, 2);
      assert.equal(entryContexts[0], entryContexts[1]);
      assert.equal(browserContext.closed, true);

      const secondCreatedInputs: PlaywrightCreateBrowserContextInput[] = [];
      const secondBrowserContext = new FakeBrowserContext(1);
      const secondContext: PlaywrightDriverExecutionContext = {
        ...fakeDriverContext(),
        executionId: "second-execution",
        createBrowserContext(input) {
          secondCreatedInputs.push(input ?? {});
          return Promise.resolve(secondBrowserContext as never);
        }
      };
      const secondExecution = driver.createExecution(fakeDriverExecutionInput(secondContext).input);
      await secondExecution.start();
      await secondExecution.openEntry(operation);
      await secondExecution.close({ executionFailed: false });

      assert.equal(secondCreatedInputs.length, 1);
      assert.notEqual(secondBrowserContext, browserContext);
      assert.equal(secondBrowserContext.closed, true);
      assert.equal(browserContext.closeCalls, 1);
      assert.equal(secondBrowserContext.closeCalls, 1);
    }
  },
  {
    name: "axe observer audits page and matched-surface scans and aggregates path items",
    async run() {
      const sourcePlan = await loadFixturePlan();
      const state = stateOperation(sourcePlan, "urn:state:alice-files-ready");
      const transition = transitionOperation(sourcePlan, "urn:transition:alice-opens-file-menu");
      const controlFlow = sourcePlan.operations.find(
        (operation): operation is ControlFlowPlanOperation => operation.kind === "control-flow"
      );
      assert.ok(controlFlow);
      const plan: JourneyPlan = {
        ...sourcePlan,
        operations: [state, transition, controlFlow]
      };
      const testInfo = new FakeAxeTestInfo("axe-observer-aggregate");
      const auditCalls: AxeAuditRunnerInput[] = [];
      const axe = axeObserver({
        testInfo: testInfo as never,
        reportId: "test-path",
        auditRunner(input) {
          auditCalls.push(input);
          return Promise.resolve(fakeAxeReport(input));
        }
      });
      const execution = fakeAxeExecution(plan);

      axe.onExecutionStarted?.({ execution });
      await axe.observeOperation?.({
        execution,
        expectedMatchCount: 1,
        locator: new FakeAxeLocator() as never,
        operation: state,
        page: new FakeAxePage() as never,
        stage: "state-asserted"
      });
      await axe.observeOperation?.({
        execution,
        decision: select(defaultProfile(), transition),
        expectedMatchCount: 1,
        locator: new FakeAxeLocator() as never,
        operation: transition,
        page: new FakeAxePage() as never,
        stage: "transition-ready"
      });
      await axe.observeOperation?.({
        execution,
        operation: controlFlow,
        stage: "control-flow-recorded"
      });
      await axe.report(fakeRunResult(plan, [executionResult(execution, true)]));

      assert.equal(auditCalls.length, 2);
      assert.deepEqual([...wcag22Tags], [
        "wcag2a",
        "wcag2aa",
        "wcag21a",
        "wcag21aa",
        "wcag22aa"
      ]);
      assert.equal(axe.latestPathReport?.summary.audited, 2);
      assert.equal(axe.latestPathReport?.summary.notApplicable, 1);
      assert.equal(axe.latestPathReport?.items[0].scanSummaries?.["page-state"].passes, 1);
      assert.equal(axe.latestPathReport?.items[0].scanSummaries?.["matched-surface"].passes, 1);
      assert.equal(axe.latestPathReport?.items[0].metadata.stateId, state.state.id);
      assert.equal(axe.latestPathReport?.items[1].metadata.transitionId, transition.transition.id);
      assert.ok(testInfo.attachments.some((attachment) => attachment.name === "axe-path-test-path.json"));
      assert.ok(testInfo.attachments.some((attachment) => attachment.name === "axe-path-test-path.html"));
      assert.ok(
        testInfo.attachments.some((attachment) => attachment.name === "axe-accessibility-test-path.json")
      );
      assert.equal(axe.latestAccessibilitySummaryReport?.source.reportId, "test-path");
      assert.equal(
        axe.latestAccessibilitySummaryReport?.states?.[state.state.id]?.metrics.matchedSurface.passes,
        1
      );
      assert.ok(axe.latestAccessibilitySummaryReportPath?.endsWith("axe-accessibility-test-path.json"));

      const pathHtmlAttachment = testInfo.attachments.find(
        (attachment) => attachment.name === "axe-path-test-path.html"
      );
      assert.ok(pathHtmlAttachment?.path);
      const pathHtml = await readFile(pathHtmlAttachment.path, "utf8");
      assert.match(pathHtml, /id="profile-default"/);
      assert.match(pathHtml, new RegExp(`id="${axe.latestPathReport?.items[0].itemId}"`));
    }
  },
  {
    name: "axe observer skips non-singleton matched locators without running axe",
    async run() {
      const sourcePlan = await loadFixturePlan();
      const state = stateOperation(sourcePlan, "urn:state:bob-pending-share-offer-cleared");
      assert.equal(state.target.expectedMatchCount, 0);
      const plan: JourneyPlan = {
        ...sourcePlan,
        operations: [state]
      };
      const testInfo = new FakeAxeTestInfo("axe-observer-skipped");
      let auditCalls = 0;
      const axe = axeObserver({
        testInfo: testInfo as never,
        reportId: "skipped-path",
        auditRunner(input) {
          auditCalls += 1;
          return Promise.resolve(fakeAxeReport(input));
        }
      });
      const execution = fakeAxeExecution(plan);

      axe.onExecutionStarted?.({ execution });
      await axe.observeOperation?.({
        execution,
        expectedMatchCount: 0,
        locator: new FakeAxeLocator() as never,
        operation: state,
        page: new FakeAxePage() as never,
        stage: "state-asserted"
      });
      await axe.report(fakeRunResult(plan, [executionResult(execution, true)]));

      assert.equal(auditCalls, 0);
      assert.equal(axe.latestPathReport?.summary.skipped, 1);
      assert.match(
        axe.latestPathReport?.items[0].reason ?? "",
        /Expected match count 0 cannot be scoped/
      );
    }
  },
  {
    name: "axe observer strict mode fails only when strict violations exist",
    async run() {
      await runStrictAxeObserver(false);
      await assert.rejects(() => runStrictAxeObserver(true), /Axe found 1 WCAG violation/);
    }
  },
  {
    name: "axe path report builder preserves UJG metadata and summaries",
    async run() {
      const report = buildAxePathAuditReport({
        reportId: "builder-test",
        createdAt: "2026-01-01T00:00:00.000Z",
        metadata: { documentId: "urn:test" },
        items: [
          {
            itemId: "default-000-start",
            groupId: "default:step",
            metadata: { profileId: "default", stateId: "urn:state:start" },
            report: fakeAxeReport({
              auditId: "default-000-start",
              metadata: { stateId: "urn:state:start" },
              page: new FakeAxePage() as never
            })
          }
        ]
      });

      assert.equal(report.schemaVersion, "ujg-fed-a11y.axe-path.v1");
      assert.equal(report.summary.audited, 1);
      assert.equal(report.items[0].metadata.stateId, "urn:state:start");
      assert.equal(report.items[0].sourceJsonHref, "default-000-start.axe.json");
      assert.equal(report.items[0].scanSummaries?.["page-state"].passes, 1);
      assert.equal(report.items[0].scanSummaries?.["matched-surface"].passes, 1);
    }
  },
  {
    name: "axe accessibility summary builder indexes single-profile states and transitions by graph id",
    async run() {
      const sourcePlan = await loadFixturePlan();
      const state = stateOperation(sourcePlan, "urn:state:alice-files-ready");
      const transition = transitionOperation(sourcePlan, "urn:transition:alice-opens-file-menu");
      const pathReport = buildAxePathAuditReport({
        reportId: "summary-test",
        createdAt: "2026-01-01T00:00:00.000Z",
        items: [
          {
            itemId: "default-000-alice-files-ready",
            metadata: {
              profileId: "default",
              kind: "state",
              stateId: state.state.id
            },
            report: fakeAxeReport({
              auditId: "default-000-alice-files-ready",
              metadata: {
                profileId: "default",
                kind: "state",
                stateId: state.state.id
              },
              page: new FakeAxePage() as never
            }),
            sourceScreenshotHref: "default-000-alice-files-ready.source.playwright-screenshot.png"
          },
          {
            itemId: "default-001-alice-opens-file-menu",
            metadata: {
              profileId: "default",
              kind: "transition",
              transitionId: transition.transition.id
            },
            report: fakeAxeReport({
              auditId: "default-001-alice-opens-file-menu",
              metadata: {
                profileId: "default",
                kind: "transition",
                transitionId: transition.transition.id
              },
              page: new FakeAxePage() as never
            })
          }
        ]
      });

      const summary = buildAxeAccessibilitySummaryReport({
        pathReport,
        generatedAt: "2026-01-01T00:00:00.000Z",
        delivery: "astro-hydration-prop",
        artifactBaseHref: "/accessibility/filesharing/artifacts",
        testResultDirectoryName: "accessible-filesharing"
      });

      assert.equal(summary.schemaVersion, "ujg-fed-a11y.accessibility-summary-by-graph-id.v1");
      assert.equal(summary.source.reportMode, "default");
      assert.equal(summary.source.delivery, "astro-hydration-prop");
      assert.equal(
        summary.source.aggregateHtmlHref,
        "/accessibility/filesharing/artifacts/summary-test.html"
      );
      assert.equal(summary.states?.[state.state.id]?.auditId, "default-000-alice-files-ready");
      assert.equal(summary.states?.[state.state.id]?.metrics.pageState.passes, 1);
      assert.equal(
        summary.states?.[state.state.id]?.sourceHtmlHref,
        "/accessibility/filesharing/artifacts/summary-test.html#default-000-alice-files-ready"
      );
      assert.equal(
        summary.states?.[state.state.id]?.sourceScreenshotHref,
        "/accessibility/filesharing/artifacts/default-000-alice-files-ready.source.playwright-screenshot.png"
      );
      assert.equal(
        summary.transitions?.[transition.transition.id]?.sourceHtmlHref,
        "/accessibility/filesharing/artifacts/summary-test.html#default-001-alice-opens-file-menu"
      );
      assert.equal(summary.profiles, undefined);
    }
  },
  {
    name: "axe accessibility summary preserves skipped state reason and zero metrics",
    async run() {
      const sourcePlan = await loadFixturePlan();
      const state = stateOperation(sourcePlan, "urn:state:bob-pending-share-offer-cleared");
      const pathReport = buildAxePathAuditReport({
        reportId: "skipped-summary",
        createdAt: "2026-01-01T00:00:00.000Z",
        items: [
          {
            itemId: "default-012-bob-pending-share-offer-cleared",
            metadata: {
              profileId: "default",
              kind: "state",
              stateId: state.state.id
            },
            status: "skipped",
            reason: "Expected match count 0 cannot be scoped to one matched locator.",
            sourceScreenshotHref: "default-012-bob-pending-share-offer-cleared.source.playwright-screenshot.png"
          }
        ]
      });

      const summary = buildAxeAccessibilitySummaryReport({ pathReport });
      const entry = summary.states?.[state.state.id];

      assert.equal(entry?.auditId, null);
      assert.equal(entry?.status, "skipped");
      assert.equal(entry?.summary.violations, 0);
      assert.equal(entry?.metrics.pageState.passes, 0);
      assert.match(entry?.reason ?? "", /Expected match count 0/);
      assert.equal(
        entry?.sourceScreenshotHref,
        "default-012-bob-pending-share-offer-cleared.source.playwright-screenshot.png"
      );
    }
  },
  {
    name: "axe accessibility summary groups duplicate graph ids by profile",
    async run() {
      const sourcePlan = await loadFixturePlan();
      const state = stateOperation(sourcePlan, "urn:state:alice-files-ready");
      const pathReport = buildAxePathAuditReport({
        reportId: "multi-profile-summary",
        createdAt: "2026-01-01T00:00:00.000Z",
        items: [
          {
            itemId: "default-000-alice-files-ready",
            metadata: {
              profileId: "default",
              kind: "state",
              stateId: state.state.id
            },
            report: fakeAxeReport({
              auditId: "default-000-alice-files-ready",
              metadata: {
                profileId: "default",
                kind: "state",
                stateId: state.state.id
              },
              page: new FakeAxePage() as never
            })
          },
          {
            itemId: "keyboard-only-000-alice-files-ready",
            metadata: {
              profileId: "keyboard-only",
              kind: "state",
              stateId: state.state.id
            },
            report: fakeAxeReport({
              auditId: "keyboard-only-000-alice-files-ready",
              metadata: {
                profileId: "keyboard-only",
                kind: "state",
                stateId: state.state.id
              },
              page: new FakeAxePage() as never
            })
          }
        ]
      });

      const summary = buildAxeAccessibilitySummaryReport({ pathReport });

      assert.equal(summary.source.reportMode, "multi-profile");
      assert.equal(summary.states, undefined);
      assert.equal(summary.transitions, undefined);
      assert.equal(
        summary.profiles?.default.states[state.state.id]?.itemId,
        "default-000-alice-files-ready"
      );
      assert.equal(
        summary.profiles?.["keyboard-only"].states[state.state.id]?.itemId,
        "keyboard-only-000-alice-files-ready"
      );
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
        readFile(new URL("../packages/journey-driver-nextcloud/src/index.ts", import.meta.url), "utf8"),
        readFile(new URL("../packages/journey-observer-axe/src/index.ts", import.meta.url), "utf8")
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
      assert.doesNotMatch(configSource, /trace:\s*"retain-on-failure"/);
      assert.doesNotMatch(configSource, /screenshot:\s*"only-on-failure"/);
      assert.doesNotMatch(configSource, /video:\s*"retain-on-failure"/);
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
      assert.match(runSource, /axeObserver/);
      assert.match(runSource, /sourceScreenshots:\s*\{/);
      assert.match(runSource, /states:\s*true/);
      assert.match(runSource, /executionObservers:\s*\[axe\]/);
      assert.doesNotMatch(runSource, /artifacts:\s*\{/);
      assert.doesNotMatch(runSource, /observers:\s*\[axe\]/);
      assert.match(runSource, /reporters:\s*\[axe\]/);
      assert.match(runSource, /nextcloud-filesharing\.axe-path/);
      assert.match(runSource, /latestAccessibilitySummaryReportPath/);
      assert.match(runSource, /accessibility:/);
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

function eventTypes(input: RunResult | readonly EvidenceEvent[]): string[] {
  const events = isEvidenceEventArray(input) ? input : input.evidence.events;
  return events.map((event) => event.type);
}

function isEvidenceEventArray(
  input: RunResult | readonly EvidenceEvent[]
): input is readonly EvidenceEvent[] {
  return Array.isArray(input);
}

function assertEventTypes(result: RunResult, expectedTypes: string[]): void {
  assert.deepEqual(eventTypes(result), expectedTypes);
}

function assertIncludesEventTypes(
  input: RunResult | readonly EvidenceEvent[],
  expectedTypes: string[]
): void {
  const remaining = [...expectedTypes];
  for (const type of eventTypes(input)) {
    if (type === remaining[0]) {
      remaining.shift();
    }
  }

  assert.deepEqual(remaining, []);
}

async function readTypeScriptSources(
  directory: URL
): Promise<Array<{ path: string; source: string }>> {
  const entries = await readdir(directory, { withFileTypes: true });
  const sources: Array<{ path: string; source: string }> = [];

  for (const entry of entries) {
    if (entry.isDirectory() && entry.name === "dist") {
      continue;
    }

    const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);

    if (entry.isDirectory()) {
      sources.push(...await readTypeScriptSources(child));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".ts")) {
      sources.push({
        path: child.pathname,
        source: await readFile(child, "utf8")
      });
    }
  }

  return sources;
}

function assertCoreCompatiblePlan(
  plan: ExecutionJourneyPlan
): CoreJourneyPlan<ExecutionJourneyPlanOperation> {
  return plan;
}

function assertCoreCompatibleOperation(
  operation: ExecutionJourneyPlanOperation
): CoreJourneyOperation<ExecutionJourneyPlanOperation["kind"]> {
  return operation;
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
  return profile.selectInputModality(operation, {} as JourneyExecutionContext) as InputModalityDecision;
}

function cloneOperation(operation: TransitionPlanOperation): TransitionPlanOperation {
  return structuredClone(operation) as TransitionPlanOperation;
}

function fakeAdapter(
  calls: string[],
  options: {
    failCreate?: boolean;
    failStart?: boolean;
    failStateId?: string;
    failClose?: boolean;
    onCreate?: (context: JourneyExecutionContext) => void;
    onClose?: (
      input: { readonly executionFailed: boolean },
      context: JourneyExecutionContext
    ) => void;
  } = {}
): JourneyAdapter {
  return {
    name: "fake-adapter",

    createExecution(input) {
      const { context } = input;
      calls.push(`${context.profile.id}:create`);
      if (options.failCreate) {
        throw new Error("Injected adapter creation failure");
      }
      options.onCreate?.(context);

      return {
        start() {
          calls.push(`${context.profile.id}:setup`);
          if (options.failStart) {
            throw new Error("Injected adapter startup failure");
          }
        },

        openEntry(operation) {
          calls.push(`${context.profile.id}:open:${operation.entryBinding?.value ?? "none"}`);
        },

        assertState(operation) {
          calls.push(`${context.profile.id}:state:${operation.state.id}`);
          if (operation.state.id === options.failStateId) {
            throw new Error(`Injected state failure for ${operation.state.id}`);
          }
        },

        performTransition(operation, decision) {
          calls.push(`${context.profile.id}:transition:${operation.transition.id}:${decision.command}`);
        },

        recordControlFlow(operation) {
          calls.push(`${context.profile.id}:control-flow:${operation.transition.id}`);
        },

        close(input) {
          options.onClose?.(input, context);
          calls.push(`${context.profile.id}:teardown`);
          if (options.failClose) {
            throw new Error("Injected adapter close failure");
          }
        }
      };
    }
  };
}

function contextTestDriver(
  contextInputs: PlaywrightCreateBrowserContextInput[]
): PlaywrightJourneyDriver {
  return {
    name: "context-test-driver",
    createExecution(input) {
      const { context } = input;
      let page: FakePage | undefined;

      return {
        start() {
          return undefined;
        },
        async openEntry(operation) {
          const input = {
            operation,
            label: "context-actor"
          };
          contextInputs.push(input);
          const browserContext = await context.createBrowserContext(input);
          page = await browserContext.newPage() as unknown as FakePage;
        },
        pageForOperation() {
          if (!page) throw new Error("Context test page was not created");
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
        close() {
          return undefined;
        }
      };
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
  closeCalls = 0;

  constructor(private readonly locatorCount: number) {}

  async newContext(options?: unknown): Promise<FakeBrowserContext> {
    const browserContext = new FakeBrowserContext(this.locatorCount, options);
    this.contexts.push(browserContext);
    return browserContext;
  }

  async close(): Promise<void> {
    this.closeCalls += 1;
    this.closed = true;
  }
}

class FakeBrowserContext {
  readonly pagesList: FakePage[] = [];
  closed = false;
  closeCalls = 0;
  private readonly pageListeners: Array<(page: FakePage) => void> = [];

  constructor(
    private readonly locatorCount: number,
    readonly options?: unknown
  ) {}

  on(event: string, listener: (page: FakePage) => void): FakeBrowserContext {
    if (event === "page") {
      this.pageListeners.push(listener);
    }
    return this;
  }

  pages(): FakePage[] {
    return [...this.pagesList];
  }

  async newPage(): Promise<FakePage> {
    const page = new FakePage("context-page", this.locatorCount);
    this.pagesList.push(page);
    for (const listener of this.pageListeners) {
      listener(page);
    }
    return page;
  }

  async close(): Promise<void> {
    this.closeCalls += 1;
    this.closed = true;
  }
}

class FakePage extends FakeLocator {
  readonly screenshotPaths: string[] = [];

  async screenshot(options: { path: string }): Promise<Buffer> {
    this.screenshotPaths.push(options.path);
    return Buffer.from("");
  }
}

function testPlaywrightDriver(): PlaywrightJourneyDriver {
  return {
    name: "feature-resolving-driver",
    createExecution() {
      return {
        start() {
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
        close() {
          return undefined;
        }
      };
    }
  };
}

async function runCharacterizationNextcloudExecution(
  operation: JourneyPlanOperation
): Promise<readonly EvidenceEvent[]> {
  const browserContext = new FakeBrowserContext(1);
  const context: PlaywrightDriverExecutionContext = {
    ...fakeDriverContext(),
    plan: { id: "characterization-nextcloud-plan", operations: [operation] },
    createBrowserContext() {
      return Promise.resolve(browserContext as never);
    }
  };
  const input = fakeDriverExecutionInput(context);
  const driver = nextcloudDriver({
    touchpoints: {
      [operation.touchpointId]: { baseURL: "http://example.test" }
    },
    users: {
      [operation.actorId]: { username: "alice", password: "secret" }
    },
    entries: {
      [operation.entryBinding?.value ?? "nextcloud.files"]: () => undefined
    },
    login: () => undefined,
    awaitApplicationSettled: () => undefined
  });
  const execution = driver.createExecution(input.input);

  await execution.start();
  await execution.openEntry(operation);
  await execution.close({ executionFailed: false });

  return input.recorder.snapshot();
}

function fakeDriverContext(): PlaywrightDriverExecutionContext {
  return {
    runId: "test-run",
    executionId: "test-execution",
    profile: defaultProfile(),
    plan: { id: "test-plan", operations: [] },
    browser: undefined as never,
    createBrowserContext() {
      throw new Error("Unexpected test browser context creation");
    }
  };
}

function fakeAdapterExecutionInput(context: JourneyExecutionContext): {
  input: Parameters<JourneyAdapter["createExecution"]>[0];
  recorder: EvidenceRecorder;
} {
  const recorder = new EvidenceRecorder(context.runId);
  return {
    input: {
      context,
      evidence: scopeEvidenceToExecution(recorder, {
        executionId: context.executionId,
        profileId: context.profile.id
      })
    },
    recorder
  };
}

function fakeDriverExecutionInput(context: PlaywrightDriverExecutionContext): {
  input: Parameters<PlaywrightJourneyDriver["createExecution"]>[0];
  recorder: EvidenceRecorder;
} {
  const recorder = new EvidenceRecorder(context.runId);
  return {
    input: {
      context,
      evidence: scopeEvidenceToExecution(recorder, {
        executionId: context.executionId,
        profileId: context.profile.id
      })
    },
    recorder
  };
}

function fakeAxeExecution(plan: JourneyPlan): JourneyExecutionDescriptor {
  const profile = defaultProfile();
  return {
    runId: "axe-run",
    executionId: "default-01",
    profile: {
      id: profile.id,
      ...(profile.label ? { label: profile.label } : {})
    },
    plan
  };
}

function fakeRunResult(
  plan: JourneyPlan,
  executions: ExecutionResult[]
): RunResult {
  return {
    ok: executions.every((execution) => execution.ok),
    runId: "axe-run",
    plan: {
      id: plan.id,
      ...(plan.source ? { source: plan.source } : {})
    },
    executions,
    evidence: {
      events: []
    },
    errors: executions.flatMap((execution) => execution.error ? [execution.error] : [])
  };
}

function executionResult(
  execution: Pick<JourneyExecutionDescriptor, "executionId" | "profile">,
  ok: boolean
): ExecutionResult {
  return {
    executionId: execution.executionId,
    profileId: execution.profile.id,
    ok
  };
}

async function runStrictAxeObserver(strict: boolean): Promise<void> {
  const sourcePlan = await loadFixturePlan();
  const state = stateOperation(sourcePlan, "urn:state:alice-files-ready");
  const plan: JourneyPlan = {
    ...sourcePlan,
    operations: [state]
  };
  const testInfo = new FakeAxeTestInfo(`axe-strict-${String(strict)}`);
  const axe = axeObserver({
    testInfo: testInfo as never,
    reportId: `strict-${String(strict)}`,
    strict,
    auditRunner(input) {
      return Promise.resolve(fakeAxeReport(input, { violations: 1 }));
    }
  });
  const execution = fakeAxeExecution(plan);

  axe.onExecutionStarted?.({ execution });
  await axe.observeOperation?.({
    execution,
    expectedMatchCount: 1,
    locator: new FakeAxeLocator() as never,
    operation: state,
    page: new FakeAxePage() as never,
    stage: "state-asserted"
  });
  await axe.report(fakeRunResult(plan, [executionResult(execution, true)]));
}

function fakeAxeReport(
  input: Pick<AxeAuditRunnerInput, "auditId" | "metadata" | "page" | "strict">,
  options: { violations?: number } = {}
): AxeAuditReport {
  const pageState = fakeAxeResults({ passes: 1, violations: options.violations ?? 0 });
  const matchedSurface = fakeAxeResults({ passes: 1 });
  const pageSummary = summarizeFakeResults(pageState);
  const surfaceSummary = summarizeFakeResults(matchedSurface);

  return {
    auditId: input.auditId,
    createdAt: "2026-01-01T00:00:00.000Z",
    url: input.page.url(),
    strict: input.strict ?? false,
    wcagTags: [...wcag22Tags],
    metadata: input.metadata ?? {},
    summary: {
      violations: pageSummary.violations + surfaceSummary.violations,
      incomplete: pageSummary.incomplete + surfaceSummary.incomplete,
      passes: pageSummary.passes + surfaceSummary.passes,
      inapplicable: pageSummary.inapplicable + surfaceSummary.inapplicable
    },
    scans: {
      pageState,
      matchedSurface
    },
    evidence: {
      pageState: { nodes: [] },
      matchedSurface: { nodes: [] }
    }
  };
}

function fakeAxeResults(input: {
  passes?: number;
  violations?: number;
  incomplete?: number;
  inapplicable?: number;
}): AxeResults {
  return {
    violations: Array.from({ length: input.violations ?? 0 }, (_, index) =>
      fakeAxeRuleResult(`violation-${index + 1}`)
    ),
    incomplete: Array.from({ length: input.incomplete ?? 0 }, (_, index) =>
      fakeAxeRuleResult(`incomplete-${index + 1}`)
    ),
    passes: Array.from({ length: input.passes ?? 0 }, (_, index) =>
      fakeAxeRuleResult(`pass-${index + 1}`)
    ),
    inapplicable: Array.from({ length: input.inapplicable ?? 0 }, (_, index) =>
      fakeAxeRuleResult(`inapplicable-${index + 1}`)
    )
  } as AxeResults;
}

function fakeAxeRuleResult(id: string): AxeResults["violations"][number] {
  return {
    id,
    impact: "serious",
    tags: ["wcag2a"],
    description: `${id} description`,
    help: `${id} help`,
    helpUrl: `https://example.test/${id}`,
    nodes: [
      {
        any: [],
        all: [],
        none: [],
        impact: "serious",
        html: "<button>Example</button>",
        target: ["button"],
        failureSummary: `${id} failure`
      }
    ]
  } as AxeResults["violations"][number];
}

function summarizeFakeResults(results: AxeResults): {
  violations: number;
  incomplete: number;
  passes: number;
  inapplicable: number;
} {
  return {
    violations: results.violations.length,
    incomplete: results.incomplete.length,
    passes: results.passes.length,
    inapplicable: results.inapplicable.length
  };
}

class FakeAxePage {
  url(): string {
    return "https://example.test/apps/files/";
  }

  async screenshot(): Promise<Buffer> {
    return Buffer.from("");
  }
}

class FakeAxeLocator {
  async evaluate(): Promise<void> {
    return undefined;
  }
}

class FakeAxeTestInfo {
  readonly attachments: Array<{
    name: string;
    path?: string;
    body?: string | Buffer;
    contentType?: string;
  }> = [];

  constructor(private readonly id: string) {}

  outputPath(...pathSegments: string[]): string {
    return `/private/tmp/openuji-${this.id}-${pathSegments.join("-")}`;
  }

  attach(
    name: string,
    attachment: { path?: string; body?: string | Buffer; contentType?: string }
  ): void {
    this.attachments.push({ name, ...attachment });
  }
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
