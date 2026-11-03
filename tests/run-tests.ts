import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  activatePlaywrightLocator,
  playwrightAdapter,
  playwrightCommandForModality,
  playwrightJsonEvidenceReporter,
  playwrightJourneyRunSummaryReporter,
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
import {
  journeyInputModalityIds,
  keyboardEnterInputModalityId,
  keyboardSpaceInputModalityId,
  keyboardTextEntryInputModalityId,
  pointerInputModalityId,
  type JourneyInputModalityId,
  type JourneyPlan as ExecutionJourneyPlan,
  type JourneyPlanOperation as ExecutionJourneyPlanOperation
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
  buildAxeAuditReport,
  buildAxeAccessibilitySummaryReport,
  buildAxeObservedPathReport,
  buildAxePathItems,
  buildAxePathAuditReport,
  wcag22Tags,
  type AxeAuditReport,
  type AxeAuditRunnerInput,
  type AxeObserver,
  type AxeResults
} from "@openuji/journey-observer-axe";
import { defaultProfile, inputModalityProfile, keyboardOnlyProfile, touchpointProfile } from "@openuji/journey-profiles";
import {
  executionPassed,
  reportJourneyResult,
  runJourney,
  touchpointAdapter,
  type ControlFlowPlanOperation,
  type ExecutionResult,
  type InputModalityDecision,
  type JourneyAdapter,
  type JourneyExecutionDescriptor,
  type JourneyExecutionContext,
  type JourneyObserver,
  type JourneyOutcome,
  type JourneyPlan,
  type JourneyPlanOperation,
  type JourneyProgressEvent,
  type JourneyProgressSink,
  type JourneyReporter,
  type JourneyRunError,
  type RunResult,
  type StatePlanOperation,
  type TransitionPlanOperation
} from "@openuji/journey-runner";
import { consoleJourneyProgress, renderJourneyRunSummary } from "@openuji/journey-runner/console";
import { nextcloudDriverOptions, nextcloudEnvironment } from "../examples/nextcloud-filesharing/environment.js";

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
  "JourneyInputModalityId",
  "InputModalityDecision",
  "ResolvedJourneyInputModality",
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
      const modalityContractDefinitions = packageSources.filter((sourceFile) =>
        sourceFile.source.includes("export const journeyInputModalityIds")
      );
      assert.deepEqual(
        modalityContractDefinitions.map((definition) => definition.path),
        [executionModelSourcePath],
        "Executable input modality IDs must be defined only in journey-execution-model"
      );

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

      const profilesPackageSource = await readFile(
        new URL("../packages/journey-profiles/package.json", import.meta.url),
        "utf8"
      );
      const profilesPackageJson = JSON.parse(profilesPackageSource) as {
        dependencies?: Record<string, string>;
      };
      assert.equal(
        profilesPackageJson.dependencies?.["@openuji/journey-execution-model"],
        "workspace:*",
        "journey-profiles must depend directly on journey-execution-model for modality contracts"
      );

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
      assert.deepEqual([...journeyInputModalityIds], [
        keyboardTextEntryInputModalityId,
        keyboardSpaceInputModalityId,
        keyboardEnterInputModalityId,
        pointerInputModalityId
      ]);

      const profilesSource = packageSources.find((sourceFile) =>
        sourceFile.path.endsWith("/packages/journey-profiles/src/index.ts")
      );
      assert.ok(profilesSource);
      for (const forbiddenPattern of [
        "activation.eventId",
        ".endsWith(",
        ":text-entry-activation"
      ]) {
        assert.equal(
          profilesSource.source.includes(forbiddenPattern),
          false,
          `journey-profiles must not infer modality behavior from event IDs: ${forbiddenPattern}`
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
      assert.deepEqual(
        recorderReferences.map((sourceFile) => sourceFile.path),
        [],
        "EvidenceRecorder must not be referenced after removing the evidence package"
      );

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
      assert.deepEqual(
        rawEmitSources.map((sourceFile) => sourceFile.path),
        [],
        "Packages must not emit removed evidence events"
      );

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

      const runnerIndexSource = packageSources.find((sourceFile) =>
        sourceFile.path.endsWith("/packages/journey-runner/src/index.ts")
      );
      assert.ok(runnerIndexSource);
      const runnerSource = packageSources.find((sourceFile) =>
        sourceFile.path.endsWith("/packages/journey-runner/src/run-journey.ts")
      );
      assert.ok(runnerSource);
      const observerContractsSource = packageSources.find((sourceFile) =>
        sourceFile.path.endsWith("/packages/journey-runner/src/observers/contracts.ts")
      );
      assert.ok(observerContractsSource);
      const runJourneySource = sourceBetween(
        runnerSource.source,
        "export async function runJourney",
        "async function runProfileExecution"
      );
      assert.match(runnerIndexSource.source, /from "\.\/run-journey\.js"/);
      assert.doesNotMatch(runnerIndexSource.source, /console-progress|console-summary/);
      assert.doesNotMatch(runnerIndexSource.source, /export async function runJourney/);
      assert.doesNotMatch(runnerIndexSource.source, /function consoleJourneyProgress/);
      assert.doesNotMatch(runnerIndexSource.source, /sink\.publish/);
      assert.doesNotMatch(
        runnerSource.source,
        /from "\.\/reporting\/|from "\.\.\/reporting\//
      );
      assert.doesNotMatch(runJourneySource, /ReporterPipeline/);
      assert.doesNotMatch(runJourneySource, /reporter/i);
      assert.doesNotMatch(runJourneySource, /JSON\.stringify/);
      assert.doesNotMatch(runnerSource.source, /ReporterPipeline/);
      assert.doesNotMatch(runnerSource.source, /async function publishProgress/);
      assert.doesNotMatch(runnerSource.source, /sink\.publish/);
      assert.doesNotMatch(runnerSource.source, /function buildResult/);
      assert.doesNotMatch(runnerSource.source, /function resultOk/);
      assert.doesNotMatch(runnerSource.source, /reporters\?:\s*JourneyReporter/);
      assert.doesNotMatch(
        observerContractsSource.source.replace(/\s+/g, " "),
        /JourneyObserverRunStartedInput = \{[^}]*evidence/
      );
      assert.doesNotMatch(
        observerContractsSource.source.replace(/\s+/g, " "),
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
        [],
        "UjgRefSet compatibility alias must be removed with the evidence package"
      );

      const directPlan: ExecutionJourneyPlan = await compileUjgJourneyPlan(
        await loadUjgDocument(fixtureUrl)
      );
      const runnerPlanFromExecution: JourneyPlan = directPlan;
      assertCoreCompatiblePlan(directPlan);
      assertCoreCompatibleOperation(directPlan.operations[0]);
      assertCoreCompatiblePlan(runnerPlanFromExecution);
      assertCoreCompatibleOperation(runnerPlanFromExecution.operations[0]);

      const runnerPlan: JourneyPlan = await loadFixturePlan();
      assertCoreCompatiblePlan(runnerPlan);
      assertCoreCompatibleOperation(runnerPlan.operations[0]);
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
      assert.equal(bobShares.activation.bindings[0].locators[0].id, "urn:locator:shares-overview-link");
      assert.equal(bobShares.activation.bindings[0].locators[0].role, "link");
      assert.equal(bobShares.activation.bindings[0].locators[0].accessibleName, "Shares");
      assert.deepEqual(bobShares.activation.bindings[0].locators[0].features, []);
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

      const defaultButton = select(defaultProfile(), button);
      const defaultTextEntry = select(defaultProfile(), textEntry);
      const keyboardButton = select(keyboardOnlyProfile(), button);
      const keyboardOption = select(keyboardOnlyProfile(), option);

      assert.equal(playwrightCommandForModality(defaultButton.modality.id), "pointer-click");
      assert.equal(defaultButton.modality.id, pointerInputModalityId);
      assert.equal(playwrightCommandForModality(defaultTextEntry.modality.id), "keyboard-text-entry");
      assert.equal(defaultTextEntry.modality.id, keyboardTextEntryInputModalityId);
      assert.equal(playwrightCommandForModality(keyboardButton.modality.id), "keyboard-space");
      assert.equal(keyboardButton.modality.id, keyboardSpaceInputModalityId);
      assert.equal(playwrightCommandForModality(keyboardOption.modality.id), "keyboard-enter");
      assert.equal(keyboardOption.modality.id, keyboardEnterInputModalityId);
      for (const decision of [
        defaultButton,
        defaultTextEntry,
        keyboardButton,
        keyboardOption
      ]) {
        assertJourneyInputModalityId(decision.modality.id);
      }

      const multiProfileTextEntry = cloneOperation(textEntry);
      multiProfileTextEntry.activation.requiredInputModalityProfiles = [
        ...multiProfileTextEntry.activation.requiredInputModalityProfiles,
        ...button.activation.requiredInputModalityProfiles.filter((profile) =>
          profile.modalities.some((modality) => modality.id === pointerInputModalityId)
        )
      ];
      const suffixedEventDecision = select(defaultProfile(), multiProfileTextEntry);
      const opaqueEvent = cloneOperation(multiProfileTextEntry);
      opaqueEvent.activation.eventId = "urn:observation-event:opaque-activation";
      const opaqueEventDecision = select(defaultProfile(), opaqueEvent);
      assert.equal(suffixedEventDecision.modality.id, pointerInputModalityId);
      assert.equal(opaqueEventDecision.modality.id, suffixedEventDecision.modality.id);

      const pointerOnly = cloneOperation(button);
      pointerOnly.activation.requiredInputModalityProfiles =
        pointerOnly.activation.requiredInputModalityProfiles.filter((profile) =>
          profile.modalities.some((modality) => modality.id === pointerInputModalityId)
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
      const fileMenuTransition = transitionOperation(plan, "urn:transition:alice-opens-file-menu");
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
      assert.deepEqual(
        result.evidence.executions.map((execution) => execution.profileId),
        ["default", "keyboard-only"]
      );
      assert.deepEqual(
        result.evidence.executions.map((execution) => execution.operations.length),
        [plan.operations.length, plan.operations.length]
      );
      assert.ok(
        result.evidence.executions.some(
          (execution) =>
            execution.profileId === "keyboard-only" &&
            execution.operations.some(
              (operation) =>
                operation.operationKind === "transition" &&
                operation.operationId === fileMenuTransition.id &&
                operation.outcome.kind === "passed"
            )
        )
      );
    }
  },
  {
    name: "runner console summary renders colored pass/fail blocks and relative artifacts",
    async run() {
      const plan: JourneyPlan = { id: "summary-plan", operations: [] };
      const passing = fakeRunResult(plan, [
        {
          executionId: "default-01",
          profileId: "default",
          outcome: { kind: "passed" }
        },
        {
          executionId: "keyboard-only-02",
          profileId: "keyboard-only",
          outcome: { kind: "passed" }
        }
      ]);

      const colored = renderJourneyRunSummary(
        {
          result: passing,
          artifacts: [
            {
              label: "evidence",
              path: "/tmp/ujg-output/ujg-evidence.json"
            }
          ],
          commands: [
            {
              label: "report",
              command: "pnpm --filter @openuji/example-nextcloud-filesharing e2e:report"
            }
          ]
        },
        {
          color: "always",
          cwd: "/tmp/ujg-output"
        }
      );

      assert.match(colored, /\u001b\[/);
      assert.match(colored, /UJG Journey/);
      assert.match(colored, /PASS/);
      assert.match(colored, /2\/2 passed/);
      assert.match(colored, /ujg-evidence\.json/);
      assert.doesNotMatch(colored, /\/tmp\/ujg-output\/ujg-evidence\.json/);
      assert.match(colored, /e2e:report/);
      assert.ok(
        colored.indexOf("Commands") < colored.indexOf("UJG Journey"),
        "commands must render before the journey summary block"
      );

      const failing = fakeRunResult(plan, [
        {
          executionId: "default-01",
          profileId: "default",
          outcome: {
            kind: "failed",
            error: {
              name: "LocatorError",
              message: "Expected one locator"
            }
          }
        }
      ]);
      const plain = renderJourneyRunSummary({ result: failing }, { color: "never" });

      assert.doesNotMatch(plain, /\u001b\[/);
      assert.match(plain, /FAIL/);
      assert.match(plain, /Failures/);
      assert.match(plain, /LocatorError Expected one locator/);
    }
  },
  {
    name: "playwright reporters attach evidence and summary through JourneyReporter",
    async run() {
      const testInfo = new FakeAxeTestInfo("playwright-summary-reporters");
      const plan: JourneyPlan = { id: "summary-plan", operations: [] };
      const result = fakeRunResult(plan, [
        {
          executionId: "default-01",
          profileId: "default",
          outcome: { kind: "passed" }
        }
      ]);
      const evidence = playwrightJsonEvidenceReporter({ testInfo });
      const summary = playwrightJourneyRunSummaryReporter({
        testInfo,
        artifacts: () => [
          evidence.latestPath ? { label: "evidence", path: evidence.latestPath } : undefined
        ],
        commands: [
          {
            label: "report",
            command: "pnpm --filter @openuji/example-nextcloud-filesharing e2e:report"
          }
        ]
      });
      const json = JSON.stringify(result, null, 2);

      await evidence.report({ result, json });
      await summary.report({ result, json });

      assert.ok(evidence.latestPath?.endsWith("ujg-evidence.json"));
      assert.ok(summary.latestPath?.endsWith("ujg-summary.json"));
      assert.ok(testInfo.attachments.some((attachment) => attachment.name === "ujg-evidence.json"));
      assert.ok(testInfo.attachments.some((attachment) => attachment.name === "ujg-summary.json"));

      const summaryJson = JSON.parse(
        await readFile(summary.latestPath ?? "", "utf8")
      ) as {
        artifacts?: Array<{ label: string; path: string }>;
        commands?: Array<{ label: string; command: string }>;
      };
      assert.equal(summaryJson.artifacts?.[0].label, "evidence");
      assert.match(summaryJson.commands?.[0].command ?? "", /e2e:report/);
    }
  },
  {
    name: "runJourney never invokes obsolete runtime reporters",
    async run() {
      const plan: JourneyPlan = { id: "no-inline-reporters-plan", operations: [] };
      const calls: string[] = [];
      const reporter: JourneyReporter = {
        name: "obsolete-inline-reporter",
        report() {
          calls.push("reporter");
        }
      };
      const result = await runJourney({
        plan,
        adapter: fakeAdapter(calls),
        profiles: [defaultProfile()],
        reporters: [reporter]
      } as Parameters<typeof runJourney>[0] & { reporters: readonly JourneyReporter[] });

      assert.equal(result.ok, true);
      assert.deepEqual(calls, ["default:create", "default:setup", "default:teardown"]);
    }
  },
  {
    name: "runJourney waits for run-completed observers and returns their failures",
    async run() {
      const plan: JourneyPlan = { id: "run-completed-lifecycle-plan", operations: [] };
      const calls: string[] = [];
      const result = await runJourney({
        plan,
        adapter: fakeAdapter(calls),
        profiles: [defaultProfile()],
        observers: [
          {
            name: "run-completed-recorder",
            async onRunCompleted({ result }) {
              calls.push(`run-completed:${String(result.ok)}:${result.errors.length}`);
              await Promise.resolve();
              calls.push("run-completed-awaited");
            }
          },
          {
            name: "run-completed-failure",
            onRunCompleted({ result }) {
              calls.push(`run-completed-before-failure:${String(result.ok)}`);
              throw new Error("Injected run completion observer failure");
            }
          }
        ]
      });

      assert.equal(result.ok, false);
      assert.match(result.errors[0].message, /Injected run completion observer failure/);
      assert.deepEqual(calls.slice(-3), [
        "run-completed:true:0",
        "run-completed-awaited",
        "run-completed-before-failure:true"
      ]);
    }
  },
  {
    name: "runJourney completes failed run-start observer results before returning",
    async run() {
      const plan: JourneyPlan = { id: "run-start-failure-completion-plan", operations: [] };
      const calls: string[] = [];
      const result = await runJourney({
        plan,
        adapter: fakeAdapter(calls),
        profiles: [defaultProfile()],
        observers: [
          {
            name: "run-start-failure",
            onRunStarted() {
              calls.push("run-started");
              throw new Error("Injected run start observer failure");
            },
            onRunCompleted({ result }) {
              calls.push(`run-completed:${String(result.ok)}:${result.errors[0]?.message ?? "none"}`);
            }
          }
        ]
      });

      assert.equal(result.ok, false);
      assert.match(result.errors[0]?.message ?? "", /Injected run start observer failure/);
      assert.deepEqual(result.evidence.executions, []);
      assert.deepEqual(calls, [
        "run-started",
        "run-completed:false:Injected run start observer failure"
      ]);
    }
  },
  {
    name: "reportJourneyResult isolates reporter failures from the supplied result",
    async run() {
      const plan: JourneyPlan = { id: "reporting-boundary-plan", operations: [] };
      const result = await runJourney({
        plan,
        adapter: fakeAdapter([]),
        profiles: [defaultProfile()],
        observers: [
          {
            name: "final-result-marker",
            onRunCompleted({ result }) {
              assert.equal(result.ok, true);
            }
          }
        ]
      });
      const originalOk = result.ok;
      const originalErrors = structuredClone(result.errors);
      const originalEvidence = structuredClone(result.evidence);
      const reporterInputs: RunResult[] = [];
      const reporterJson: string[] = [];
      const reporterCalls: string[] = [];
      const reporters: JourneyReporter[] = [
        {
          name: "first-reporter",
          report(input) {
            reporterCalls.push("first");
            reporterInputs.push(input.result);
            reporterJson.push(input.json);
          }
        },
        {
          name: "failing-reporter",
          report(input) {
            reporterCalls.push("failing");
            reporterInputs.push(input.result);
            reporterJson.push(input.json);
            throw new Error("Injected reporter failure");
          }
        },
        {
          name: "later-reporter",
          report(input) {
            reporterCalls.push("later");
            reporterInputs.push(input.result);
            reporterJson.push(input.json);
          }
        }
      ];

      const reporting = await reportJourneyResult({
        result,
        reporters
      });

      assert.strictEqual(reporting.result, result);
      assert.deepEqual(reporterCalls, ["first", "failing", "later"]);
      assert.deepEqual(reporterInputs, [result, result, result]);
      assert.deepEqual(
        reporterJson,
        [
          JSON.stringify(result, null, 2),
          JSON.stringify(result, null, 2),
          JSON.stringify(result, null, 2)
        ]
      );
      assert.equal(reporting.errors.length, 1);
      assert.match(reporting.errors[0]?.message ?? "", /Injected reporter failure/);
      assert.equal(result.ok, originalOk);
      assert.deepEqual(result.errors, originalErrors);
      assert.deepEqual(result.evidence, originalEvidence);
    }
  },
  {
    name: "runJourney emits progress in lifecycle order with operation terminals",
    async run() {
      const sourcePlan = await loadFixturePlan();
      const state = stateOperation(sourcePlan, "urn:state:alice-files-ready");
      const plan: JourneyPlan = { ...sourcePlan, operations: [state] };
      const events: JourneyProgressEvent[] = [];
      const result = await runJourney({
        plan,
        adapter: fakeAdapter([]),
        profiles: [defaultProfile()],
        progress: [{ publish: (event) => { events.push(event); } }]
      });

      assert.equal(result.ok, true);
      assert.deepEqual(events.map((event) => event.type), [
        "run-started",
        "profiles-assessed",
        "execution-started",
        "operation-started",
        "operation-completed",
        "execution-completed",
        "run-completed"
      ]);
      assert.equal(events.filter(isOperationStarted).length, 1);
      assert.equal(events.filter(isOperationTerminal).length, 1);

      const runStarted = events.find((event) => event.type === "run-started");
      assert.equal(runStarted?.planId, plan.id);
      assert.equal(runStarted?.profileCount, 1);
      assert.equal(runStarted?.operationsPerProfile, 1);

      const operationStarted = events.find(isOperationStarted);
      assert.equal(operationStarted?.position, 1);
      assert.equal(operationStarted?.total, 1);
      assert.strictEqual(operationStarted?.operation, state);

      const operationCompleted = events.find((event) => event.type === "operation-completed");
      assert.ok((operationCompleted?.durationMs ?? -1) >= 0);

      const executionCompleted = events.find((event) => event.type === "execution-completed");
      assert.equal(executionCompleted?.result.outcome.kind, "passed");
      assert.ok((executionCompleted?.durationMs ?? -1) >= 0);

      const runCompleted = events.find((event) => event.type === "run-completed");
      assert.equal(runCompleted?.ok, true);
      assert.ok((runCompleted?.durationMs ?? -1) >= 0);
    }
  },
  {
    name: "progress sink failures are ignored and operation failures are serialized",
    async run() {
      const sourcePlan = await loadFixturePlan();
      const state = stateOperation(sourcePlan, "urn:state:alice-files-ready");
      const plan: JourneyPlan = { ...sourcePlan, operations: [state] };
      const events: JourneyProgressEvent[] = [];
      const failingSink: JourneyProgressSink = {
        publish() {
          throw new Error("Injected progress failure");
        }
      };
      const result = await runJourney({
        plan,
        adapter: fakeAdapter([], { failStateId: state.state.id }),
        profiles: [defaultProfile()],
        progress: [failingSink, { publish: (event) => { events.push(event); } }]
      });

      assert.equal(result.ok, false);
      assert.equal(result.errors.some((error) => error.message.includes("progress")), false);
      assert.deepEqual(events.map((event) => event.type), [
        "run-started",
        "profiles-assessed",
        "execution-started",
        "operation-started",
        "operation-failed",
        "execution-completed",
        "run-completed"
      ]);
      assert.equal(events.filter(isOperationStarted).length, 1);
      assert.equal(events.filter(isOperationTerminal).length, 1);

      const failed = events.find((event) => event.type === "operation-failed");
      assert.equal(failed?.position, 1);
      assert.equal(failed?.total, 1);
      assert.ok((failed?.durationMs ?? -1) >= 0);
      assert.match(failed?.error.message ?? "", /Injected state failure/);

      const executionCompleted = events.find((event) => event.type === "execution-completed");
      assert.equal(executionCompleted?.result.outcome.kind, "failed");
      const runCompleted = events.find((event) => event.type === "run-completed");
      assert.equal(runCompleted?.ok, false);
    }
  },
  {
    name: "operation durations exclude progress rendering time",
    async run() {
      const originalPerformance = globalThis.performance;
      let now = 0;
      Object.defineProperty(globalThis, "performance", {
        configurable: true,
        value: { now: () => now }
      });

      try {
        const sourcePlan = await loadFixturePlan();
        const state = stateOperation(sourcePlan, "urn:state:alice-files-ready");
        const plan: JourneyPlan = { ...sourcePlan, operations: [state] };
        const events: JourneyProgressEvent[] = [];
        const adapter: JourneyAdapter = {
          name: "timed-adapter",
          createExecution() {
            return {
              start() {
                return undefined;
              },
              openEntry() {
                return undefined;
              },
              assertState() {
                now += 7;
              },
              performTransition() {
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

        const result = await runJourney({
          plan,
          adapter,
          profiles: [defaultProfile()],
          progress: [
            {
              publish(event) {
                if (event.type === "operation-started") now += 1000;
                events.push(event);
              }
            }
          ]
        });

        assert.equal(result.ok, true);
        const completed = events.find((event) => event.type === "operation-completed");
        assert.equal(completed?.durationMs, 7);
      } finally {
        Object.defineProperty(globalThis, "performance", {
          configurable: true,
          value: originalPerformance
        });
      }
    }
  },
  {
    name: "progress run-completed is emitted before reporting begins",
    async run() {
      const calls: string[] = [];
      const result = await runJourney({
        plan: { id: "progress-before-reporting-plan", operations: [] },
        adapter: fakeAdapter([]),
        profiles: [defaultProfile()],
        progress: [
          {
            publish(event) {
              if (event.type === "run-completed") calls.push("progress:run-completed");
            }
          }
        ]
      });
      const reporting = await reportJourneyResult({
        result,
        reporters: [
          {
            name: "ordering-reporter",
            report() {
              calls.push("report");
            }
          }
        ]
      });

      assert.deepEqual(reporting.errors, []);
      assert.deepEqual(calls, ["progress:run-completed", "report"]);
    }
  },
  {
    name: "consoleJourneyProgress renders success and failure events",
    async run() {
      const sourcePlan = await loadFixturePlan();
      const state = stateOperation(sourcePlan, "urn:state:alice-files-ready");
      const transition = transitionOperation(sourcePlan, "urn:transition:alice-opens-file-menu");
      const chunks: string[] = [];
      const sink = consoleJourneyProgress({
        stream: {
          write(chunk: string | Uint8Array) {
            chunks.push(String(chunk));
            return true;
          }
        } as Pick<NodeJS.WriteStream, "write">
      });

      await sink.publish({
        type: "execution-started",
        runId: "run-1",
        executionId: "default-01",
        profileId: "default"
      });
      await sink.publish({
        type: "operation-started",
        executionId: "default-01",
        profileId: "default",
        operation: state,
        position: 1,
        total: 2
      });
      await sink.publish({
        type: "operation-completed",
        executionId: "default-01",
        profileId: "default",
        operation: state,
        position: 1,
        total: 2,
        durationMs: 420.4
      });
      await sink.publish({
        type: "operation-started",
        executionId: "default-01",
        profileId: "default",
        operation: transition,
        position: 2,
        total: 2
      });
      await sink.publish({
        type: "operation-failed",
        executionId: "default-01",
        profileId: "default",
        operation: transition,
        position: 2,
        total: 2,
        durationMs: 30_000,
        error: { name: "Error", message: "Expected one matching element" }
      });

      const output = chunks.join("");
      assert.match(output, /Profile: default/);
      assert.match(output, /1\/2 Checking "Alice files app is ready"\.\.\./);
      assert.match(output, /✓ completed in 420ms/);
      assert.match(output, /2\/2 Performing "Alice opens the sharing panel"\.\.\./);
      assert.match(output, /✗ failed after 30\.0s/);
      assert.match(output, /Expected one matching element/);
      assert.doesNotMatch(output, /transition-ready/);
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
      assert.deepEqual(minimalResult.evidence.executions, [
        { executionId: "default-01", profileId: "default", operations: [] }
      ]);

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
      const [executionEvidence] = result.evidence.executions;
      const [operationEvidence] = executionEvidence?.operations ?? [];

      assert.equal(result.ok, true);
      assert.equal(result.plan.source?.model, "custom-workflow");
      assert.equal(result.plan.source?.documentId, "workflow-42");
      assert.equal(operationEvidence?.operationId, "operation-1");
      assert.equal(operationEvidence?.graphNodeId, undefined);
      assert.equal(operationEvidence?.operationKind, "state");
      assert.equal(operationEvidence?.outcome.kind, "passed");
    }
  },
  {
    name: "touchpoint adapter runs web and native modalities with shared fixtures and child provenance",
    async run() {
      const source = await loadFixturePlan();
      const tap = { id: "urn:test:input:tap" };
      const touch = { id: "urn:test:profile:touch", modalities: [tap] };
      const plan: JourneyPlan = {
        ...source,
        operations: source.operations.map((operation) =>
          operation.kind === "transition" && operation.touchpointId === "urn:touchpoint:nextcloud-b"
            ? { ...operation, activation: { ...operation.activation, requiredInputModalityProfiles: [touch] } }
            : operation
        )
      };
      const browser = new FakeBrowser(1);
      const webOperations: JourneyPlanOperation[] = [];
      const nativeCalls: string[] = [];
      const events: JourneyProgressEvent[] = [];
      const driver = testPlaywrightDriver();
      const nativeProfile = inputModalityProfile({ id: "touch", modalityPreference: [tap.id] });
      const profiles = [defaultProfile(), keyboardOnlyProfile()].map((webProfile) => touchpointProfile({
        id: `${webProfile.id}-web-touch-mobile`,
        profiles: {
          "urn:touchpoint:nextcloud-a": webProfile,
          "urn:touchpoint:nextcloud-b": nativeProfile
        }
      }));
      const environmentCalls: string[] = [];
      const web = playwrightAdapter({
        browser: browser as never,
        driver: {
          ...driver,
          createExecution(input) {
            return {
              ...driver.createExecution(input),
              transitionValue: () => "bob@example.test"
            };
          }
        },
        assertionTimeoutMs: 1,
        executionObservers: [{
          name: "web-observer",
          observeOperation: ({ operation }) => { webOperations.push(operation); }
        }]
      });
      const result = await runJourney({
        plan,
        adapter: touchpointAdapter({
          "urn:touchpoint:nextcloud-a": web,
          "urn:touchpoint:nextcloud-b": {
            ...fakeAdapter(nativeCalls),
            name: "native-test-adapter"
          }
        }),
        profiles,
        environment: {
          setup(context) { environmentCalls.push(`${context.profile.id}:setup`); },
          verifyEffect({ context, effect }) { environmentCalls.push(`${context.profile.id}:effect:${effect.id}`); },
          teardown({ context, executionFailed }) {
            assert.equal(executionFailed, false);
            environmentCalls.push(`${context.profile.id}:teardown`);
          }
        },
        progress: [{ publish: (event) => { events.push(event); } }]
      });

      assert.equal(result.ok, true, JSON.stringify(result.errors));
      const aliceOperations = plan.operations.filter((operation) =>
        operation.touchpointId === "urn:touchpoint:nextcloud-a"
      );
      const bobOperations = plan.operations.filter((operation) =>
        operation.touchpointId === "urn:touchpoint:nextcloud-b"
      );
      assert.deepEqual(webOperations, [...aliceOperations, ...aliceOperations]);
      for (const profile of profiles) {
        const expected = await Promise.all(bobOperations.map(async (operation) => {
          if (operation.kind === "state") return `${profile.id}:state:${operation.state.id}`;
          if (operation.kind === "control-flow") {
            return `${profile.id}:control-flow:${operation.transition.id}`;
          }
          assert.ok(profile.selectInputModality);
          const decision = await profile.selectInputModality(operation, {} as JourneyExecutionContext);
          assert.equal(decision.profileId, profile.id);
          assert.equal("command" in decision, false);
          return `${profile.id}:transition:${operation.transition.id}:${decision.modality.id}`;
        }));
        assert.deepEqual(nativeCalls.filter((call) =>
          call.startsWith(`${profile.id}:state:`) ||
          call.startsWith(`${profile.id}:transition:`) ||
          call.startsWith(`${profile.id}:control-flow:`)
        ), expected);
      }
      assert.deepEqual(events.filter(isOperationStarted).map((event) => event.operation), [
        ...plan.operations, ...plan.operations
      ]);
      const terminals = events.filter(isOperationTerminal);
      assert.deepEqual(terminals.map((event) => event.operation), [...plan.operations, ...plan.operations]);
      assert.ok(terminals.every((event) => event.type === "operation-completed"));
      for (const execution of result.evidence.executions) {
        assert.deepEqual(execution.operations.map((operation) => operation.operationId),
          plan.operations.map((operation) => operation.id)
        );
        assert.deepEqual(execution.operations.map((operation) => operation.adapter),
          plan.operations.map((operation) => operation.touchpointId === "urn:touchpoint:nextcloud-a"
            ? { name: "@openuji/journey-adapter-playwright", version: "0.1.0" }
            : { name: "native-test-adapter" })
        );
      }
      assert.deepEqual(environmentCalls, profiles.flatMap((profile) => [
        `${profile.id}:setup`,
        ...plan.operations.flatMap((operation) => operation.kind === "transition"
          ? operation.effects.map((effect) => `${profile.id}:effect:${effect.id}`)
          : []),
        `${profile.id}:teardown`
      ]));
      assert.equal(browser.closeCalls, 0);
    }
  },
  {
    name: "Playwright rejects a model-defined native modality without resolving a web target",
    async run() {
      const source = await loadFixturePlan();
      const operation = cloneOperation(transitionOperation(source, "urn:transition:alice-opens-file-menu"));
      operation.activation.requiredInputModalityProfiles = [{
        id: "urn:test:native-input",
        modalities: [{ id: "urn:test:native-swipe" }]
      }];
      const driver = testPlaywrightDriver();
      let pageRequested = false;
      const result = await runJourney({
        plan: { ...source, operations: [operation] },
        profiles: [inputModalityProfile({ id: "swipe", modalityPreference: ["urn:test:native-swipe"] })],
        adapter: playwrightAdapter({
          browser: new FakeBrowser(1) as never,
          driver: {
            ...driver,
            createExecution(input) {
              return {
                ...driver.createExecution(input),
                pageForOperation() { pageRequested = true; throw new Error("Unexpected target lookup"); }
              };
            }
          }
        })
      });
      assert.equal(result.ok, false);
      assert.match(result.errors[0]?.message ?? "", /does not support input modality urn:test:native-swipe/);
      assert.equal(pageRequested, false);
    }
  },
  {
    name: "no-input transitions need no selector and report unaudited completion with applicable execution counts",
    async run() {
      const source = await loadFixturePlan();
      const operation = cloneOperation(transitionOperation(source, "urn:transition:bob-accepts-share"));
      operation.activation.requiredInputModalityProfiles = [];
      operation.activation.bindings = [];
      delete operation.entryBinding;
      const calls: string[] = [];
      const driver = testPlaywrightDriver();
      const axe = axeObserver({
        testInfo: new FakeAxeTestInfo("no-input-completed") as never,
        reportId: "no-input-completed",
        auditRunner() { throw new Error("Unexpected audit without a locator"); }
      });
      const result = await runJourney({
        plan: { ...source, operations: [operation] },
        profiles: [
          { id: "automatic" },
          { id: "excluded", appliesTo: () => false }
        ],
        adapter: playwrightAdapter({
          browser: new FakeBrowser(1) as never,
          executionObservers: [axe, {
            name: "completion-observer",
            observeOperation(observation) {
              assert.equal("locator" in observation, false);
              assert.equal("page" in observation, false);
              calls.push(observation.stage);
            }
          }],
          driver: {
            ...driver,
            createExecution(input) {
              return {
                ...driver.createExecution(input),
                pageForOperation() { throw new Error("Unexpected UI target"); },
                afterTransition(received, decision) {
                  assert.strictEqual(received, operation);
                  assert.equal(decision, undefined);
                  calls.push("automatic-transition");
                }
              };
            }
          }
        }),
        environment: {
          verifyEffect({ decision, effect }) {
            assert.equal(decision, undefined);
            calls.push(effect.id);
          }
        }
      });
      assert.equal(result.ok, true, JSON.stringify(result.errors));
      assert.deepEqual(calls, ["automatic-transition", "transition-completed", ...operation.effects.map((effect) => effect.id)]);
      await reportAxe(axe, result);
      assert.equal(axe.latestPathReport?.items.length, 1);
      const item = axe.latestPathReport?.items[0];
      assert.equal(item?.status, "not-applicable");
      assert.equal(item?.metadata.transitionId, operation.transition.id);
      assert.match(item?.reason ?? "", /No-input transition completed without a locator/);
      assert.equal(axe.latestPathReport?.summary.audited, 0);
      assert.equal(axe.latestPathReport?.metadata.executionCount, 1);
      assert.equal(axe.latestPathReport?.metadata.notApplicableProfileCount, 1);
    }
  },
  {
    name: "profiles without selectors fail input transitions with an actionable error",
    async run() {
      const source = await loadFixturePlan();
      const operation = transitionOperation(source, "urn:transition:alice-opens-file-menu");
      const automatic = { id: "automatic-only" };
      for (const profile of [automatic, touchpointProfile({
        id: "composed-automatic-only", profiles: { [operation.touchpointId]: automatic }
      })]) {
        const calls: string[] = [];
        const result = await runJourney({
          plan: { ...source, operations: [operation] },
          profiles: [profile],
          adapter: fakeAdapter(calls)
        });
        assert.equal(result.ok, false);
        assert.match(result.errors[0]?.message ?? "", /Profile automatic-only has no input modality selector for transition/);
        assert.equal(calls.some((call) => call.includes(":transition:")), false);
        assert.equal(result.evidence.executions[0]?.operations[0]?.outcome.kind, "failed");
      }
    }
  },
  {
    name: "preflight excludes inapplicable profiles without creating executions or lifecycle events",
    async run() {
      const plan = await loadFixturePlan();
      const setupProfiles: string[] = [];
      const calls: string[] = [];
      const events: JourneyProgressEvent[] = [];
      const excluded = keyboardOnlyProfile({
        appliesTo: (operation) => operation.touchpointId === "urn:touchpoint:nextcloud-a"
      });
      const result = await runJourney({
        plan,
        adapter: fakeAdapter(calls),
        profiles: [defaultProfile(), excluded],
        environment: { setup: (context) => { setupProfiles.push(context.profile.id); } },
        progress: [{ publish: (event) => { events.push(event); } }]
      });
      assert.equal(result.ok, true);
      assert.deepEqual(setupProfiles, ["default"]);
      assert.equal(result.executions.length, 1);
      assert.equal(result.evidence.executions.length, 1);
      const excludedAssessment = result.assessments[1];
      assert.equal(excludedAssessment?.kind, "not-applicable");
      assert.ok(excludedAssessment?.kind === "not-applicable");
      assert.match(excludedAssessment.reason, /urn:touchpoint:nextcloud-b/);
      assert.ok(calls.every((call) => !call.startsWith("keyboard-only:")));
      assert.deepEqual(events.filter((event) => event.type === "execution-started").map((event) => event.profileId), ["default"]);
      assert.deepEqual(events.filter((event) => event.type === "execution-completed").map((event) => event.result.profileId), ["default"]);
      assert.ok(events.some((event) => event.type === "profiles-assessed"));
      assert.match(renderJourneyRunSummary({ result }, { color: "never" }), /1\/1 passed; 1 not applicable/);
      const completedRuns: RunResult[] = [];
      const allExcluded = await runJourney({
        plan, adapter: fakeAdapter([]), profiles: [excluded],
        observers: [{ name: "all-excluded-observer", onRunCompleted: ({ result }) => { completedRuns.push(result); } }]
      });
      assert.equal(allExcluded.ok, false);
      assert.deepEqual(allExcluded.executions, []);
      assert.deepEqual(allExcluded.evidence.executions, []);
      assert.deepEqual(allExcluded.errors, [{
        name: "NoApplicableProfileExecutionsError", message: "No applicable profile executions"
      }]);
      assert.deepEqual(completedRuns[0]?.errors, allExcluded.errors);
      assert.match(renderJourneyRunSummary({ result: allExcluded }, { color: "never" }), /No applicable profile executions/);

      const operation = cloneOperation(transitionOperation(plan, "urn:transition:alice-opens-file-menu"));
      operation.activation.requiredInputModalityProfiles = [{ id: "touch", modalities: [{ id: "urn:test:tap" }] }];
      const unsupported = await runJourney({
        plan: { ...plan, operations: [operation] }, adapter: fakeAdapter([]), profiles: [keyboardOnlyProfile()]
      });
      assert.equal(unsupported.ok, false);
      assert.equal(unsupported.assessments[0]?.kind, "applicable");
      assert.equal(unsupported.executions[0]?.outcome.kind, "failed");
      assert.match(unsupported.errors[0]?.message ?? "", /No supported input modality/);
    }
  },
  {
    name: "all profile assessments finish before execution and assessment failures create no execution",
    async run() {
      const source = await loadFixturePlan();
      const plan = { ...source, operations: [stateOperation(source, "urn:state:alice-files-ready")] };
      const order: string[] = [];
      const observedProfiles: string[] = [];
      const profiles = ["first", "excluded", "assessment-error", "last"].map((id) => ({
        id,
        appliesTo() {
          order.push(`assess:${id}`);
          if (id === "assessment-error") throw new Error("Injected applicability failure");
          return id !== "excluded";
        }
      }));
      const result = await runJourney({
        plan,
        profiles,
        adapter: fakeAdapter([], { onCreate: ({ profile }) => { order.push(`create:${profile.id}`); } }),
        environment: { setup: ({ profile }) => { order.push(`setup:${profile.id}`); } },
        observers: [{
          name: "assessment-observer",
          onRunStarted({ assessments }) {
            assert.deepEqual(assessments.map((assessment) => assessment.kind), [
              "applicable", "not-applicable", "failed", "applicable"
            ]);
            order.push("run-started");
          },
          onExecutionStarted({ execution }) { observedProfiles.push(execution.profile.id); }
        }]
      });
      assert.deepEqual(order.slice(0, 5), [
        "assess:first", "assess:excluded", "assess:assessment-error", "assess:last", "run-started"
      ]);
      assert.deepEqual(observedProfiles, ["first", "last"]);
      assert.deepEqual(result.executions.map((execution) => execution.executionId), ["first-01", "last-04"]);
      assert.deepEqual(result.evidence.executions.map((execution) => execution.profileId), ["first", "last"]);
      assert.ok(result.executions.every(executionPassed));
      assert.equal(result.ok, false);
      assert.equal(result.errors.length, 1);
      assert.equal(result.errors[0]?.message, "Injected applicability failure");
      assert.match(renderJourneyRunSummary({ result }, { color: "never" }), /assessment-error\s+assessment failed/);
      assert.ok(order.every((call) => !["setup:excluded", "setup:assessment-error", "create:excluded", "create:assessment-error"].includes(call)));
    }
  },
  {
    name: "completed outcomes and report values cannot be mutated by observers",
    async run() {
      const source = await loadFixturePlan();
      const state = stateOperation(source, "urn:state:alice-files-ready");
      const seen: RunResult[] = [];
      const versions = ["original"];
      const result = await runJourney({
        plan: { ...source, source: { model: "immutable-test", references: { versions } }, operations: [state] },
        profiles: [{ id: "passing" }, { id: "failing" }],
        adapter: {
          name: "immutable-results-test",
          createExecution(input) {
            return fakeAdapter([], {
              failStateId: input.context.profile.id === "failing" ? state.state.id : undefined
            }).createExecution(input);
          }
        },
        observers: [{
          name: "mutation-attempt-observer",
          onRunCompleted({ result: snapshot }) {
            seen.push(snapshot);
            assert.ok(Object.isFrozen(snapshot));
            assert.ok(Object.isFrozen(snapshot.executions));
            assert.ok(Object.isFrozen(snapshot.assessments));
            assert.ok(Object.isFrozen(snapshot.evidence.executions));
            const sourceVersions = snapshot.plan.source?.references?.versions;
            assert.ok(Array.isArray(sourceVersions));
            assert.equal(Reflect.set(sourceVersions, "0", "overwritten"), false);
            assert.equal(Reflect.set(snapshot, "ok", true), false);
            const passed = snapshot.executions[0];
            assert.ok(passed);
            assert.equal(Reflect.set(passed, "status", "not-applicable"), false);
            assert.equal(Reflect.set(passed.outcome, "kind", "failed"), false);
            const failure = snapshot.executions[1]?.outcome;
            assert.ok(failure?.kind === "failed");
            assert.equal(Reflect.set(failure.error, "message", "overwritten"), false);
            assert.equal(Reflect.set(snapshot.errors[0]!, "message", "overwritten"), false);
            const operation = snapshot.evidence.executions[0]?.operations[0];
            assert.ok(operation);
            assert.equal(Reflect.set(operation, "outcome", failure), false);
          }
        }]
      });
      assert.strictEqual(result, seen[0]);
      assert.equal(result.ok, false);
      assert.equal(executionPassed(result.executions[0]!), true);
      assert.equal(executionPassed(result.executions[1]!), false);
      assert.match(result.errors[0]?.message ?? "", /Injected state failure/);
      versions[0] = "changed by caller";
      assert.deepEqual(result.plan.source?.references?.versions, ["original"]);
      for (const execution of result.executions) {
        assert.ok(["ok", "error", "status", "reason"].every((key) => !(key in execution)));
      }
    }
  },
  {
    name: "runner environment cleans partial setup and all adapter/effect failure paths",
    async run() {
      const plan = await loadFixturePlan();
      for (const failure of ["setup", "create", "start", "state", "effect", "close", "teardown"] as const) {
        const calls: string[] = [];
        const adapterCalls: string[] = [];
        const result = await runJourney({
          plan,
          profiles: [defaultProfile()],
          adapter: fakeAdapter(adapterCalls, {
            failCreate: failure === "create",
            failStart: failure === "start",
            failStateId: failure === "state" ? "urn:state:alice-files-ready" : undefined,
            failClose: failure === "close",
            onClose: () => { calls.push("adapter-close"); }
          }),
          environment: {
            setup() {
              calls.push("setup");
              if (failure === "setup") throw new Error("Injected environment setup failure");
            },
            verifyEffect() {
              if (failure === "effect") throw new Error("Injected effect verification failure");
            },
            teardown({ executionFailed }) {
              calls.push("teardown");
              assert.equal(executionFailed, failure !== "teardown");
              if (failure === "teardown") throw new Error("Injected environment teardown failure");
            }
          }
        });
        assert.equal(result.ok, false, failure);
        assert.match(result.errors[0]?.message ?? "", /Injected/);
        assert.equal(calls[0], "setup");
        assert.equal(calls.at(-1), "teardown");
        assert.equal(calls.filter((call) => call === "teardown").length, 1);
        if (failure === "setup") assert.deepEqual(adapterCalls, []);
        if (failure !== "setup" && failure !== "create") assert.equal(calls[1], "adapter-close");
        if (failure === "effect") assert.equal(result.evidence.executions[0]?.operations.at(-1)?.outcome.kind, "failed");
      }

      const failures = await runJourney({
        plan,
        profiles: [defaultProfile()],
        adapter: fakeAdapter([], { failStateId: "urn:state:alice-files-ready", failClose: true }),
        environment: { teardown() { throw new Error("Environment cleanup failure"); } }
      });
      assert.match(failures.errors[0]?.message ?? "", /Injected state failure/);
      assert.match(failures.errors[0]?.message ?? "", /Injected adapter close failure/);
      assert.match(failures.errors[0]?.message ?? "", /Environment cleanup failure/);
    }
  },
  {
    name: "Nextcloud environment fails a transition whose effect has no verifier",
    async run() {
      const source = await loadFixturePlan();
      const transition = transitionOperation(source, "urn:transition:bob-accepts-share");
      const effect = transition.effects[0];
      assert.ok(effect);
      assert.ok(nextcloudEnvironment.verifyEffect);
      for (const effectId of ["urn:test:effect:unverified", "toString"]) {
        const operation = { ...transition, effects: [{ ...effect, id: effectId }] };
        const closeInputs: boolean[] = [];
        const result = await runJourney({
          plan: { ...source, operations: [operation] },
          profiles: [defaultProfile()],
          adapter: fakeAdapter([], { onClose: ({ executionFailed }) => { closeInputs.push(executionFailed); } }),
          environment: { verifyEffect: nextcloudEnvironment.verifyEffect }
        });
        assert.equal(result.ok, false);
        assert.equal(result.errors[0]?.message, `No Nextcloud effect verifier for ${effectId}`);
        assert.equal(result.evidence.executions[0]?.operations[0]?.outcome.kind, "failed");
        assert.deepEqual(closeInputs, [true]);
      }
    }
  },
  {
    name: "runner entry point executes without Node builtins or globals",
    async run() {
      await promisify(execFile)(process.execPath, [
        "--experimental-vm-modules", fileURLToPath(new URL("./runner-portability.mjs", import.meta.url))
      ]);
    }
  },
  {
    name: "touchpoint adapter shares each adapter execution across routes and isolates profiles",
    async run() {
      const plan = await loadFixturePlan();
      const calls: string[] = [];
      const contexts: JourneyExecutionContext[] = [];
      const unusedCalls: string[] = [];
      const shared = fakeAdapter(calls, { onCreate: (context) => { contexts.push(context); } });
      const result = await runJourney({
        plan,
        adapter: touchpointAdapter({
          "urn:touchpoint:nextcloud-a": shared,
          "urn:touchpoint:nextcloud-b": shared,
          unused: fakeAdapter(unusedCalls)
        }),
        profiles: [defaultProfile(), keyboardOnlyProfile()]
      });

      assert.equal(result.ok, true);
      assert.deepEqual(calls.filter((call) => /:(create|setup|teardown)$/.test(call)), [
        "default:create", "default:setup", "default:teardown",
        "keyboard-only:create", "keyboard-only:setup", "keyboard-only:teardown"
      ]);
      assert.deepEqual(contexts.map((context) => context.executionId), ["default-01", "keyboard-only-02"]);
      assert.notStrictEqual(contexts[0], contexts[1]);
      assert.ok(contexts.every((context) => context.plan === plan));
      assert.deepEqual(unusedCalls, []);
    }
  },
  {
    name: "touchpoint adapter rejects missing routes before any runtime setup",
    async run() {
      assert.throws(() => touchpointAdapter({}), /at least one touchpoint/);
      const plan = await loadFixturePlan();
      const calls: string[] = [];
      const environmentCalls: string[] = [];
      const adapter = touchpointAdapter({ "urn:touchpoint:nextcloud-a": fakeAdapter(calls) });
      const result = await runJourney({
        plan, adapter, profiles: [defaultProfile()],
        environment: { setup() { environmentCalls.push("setup"); } }
      });

      assert.equal(result.ok, false);
      assert.match(result.errors[0]?.message ?? "", /No adapter for touchpoint urn:touchpoint:nextcloud-b/);
      assert.deepEqual(calls, []);
      assert.deepEqual(environmentCalls, []);
      assert.deepEqual(result.evidence.executions[0]?.operations, []);
    }
  },
  {
    name: "touchpoint adapter cleans up creation, startup, and operation failures in reverse order",
    async run() {
      const plan = await loadFixturePlan();
      for (const failure of ["create", "start", "state"] as const) {
        const closeInputs: string[] = [];
        const webCalls: string[] = [];
        const nativeCalls: string[] = [];
        const result = await runJourney({
          plan,
          adapter: touchpointAdapter({
            "urn:touchpoint:nextcloud-a": fakeAdapter(webCalls, {
              onClose: ({ executionFailed }) => { closeInputs.push(`web:${String(executionFailed)}`); }
            }),
            "urn:touchpoint:nextcloud-b": fakeAdapter(nativeCalls, {
              failCreate: failure === "create",
              failStart: failure === "start",
              failStateId: failure === "state" ? "urn:state:bob-incoming-share-visible" : undefined,
              onClose: ({ executionFailed }) => { closeInputs.push(`native:${String(executionFailed)}`); }
            })
          }),
          profiles: [defaultProfile()]
        });

        assert.equal(result.ok, false, failure);
        assert.match(result.errors[0]?.message ?? "", /Injected/);
        assert.deepEqual(closeInputs, failure === "create" ? ["web:true"] : ["native:true", "web:true"]);
        assert.equal(webCalls.filter((call) => call.endsWith(":teardown")).length, 1);
        assert.equal(nativeCalls.filter((call) => call.endsWith(":teardown")).length, failure === "create" ? 0 : 1);
      }
    }
  },
  {
    name: "touchpoint adapter attempts all cleanup and closes idempotently after cleanup errors",
    async run() {
      const plan = await loadFixturePlan();
      const closed: string[] = [];
      const adapter = touchpointAdapter({
        "urn:touchpoint:nextcloud-a": fakeAdapter([], {
          failClose: true,
          onClose: () => { closed.push("web"); }
        }),
        "urn:touchpoint:nextcloud-b": fakeAdapter([], {
          failClose: true,
          onClose: () => { closed.push("native"); }
        })
      });
      const execution = adapter.createExecution({
        context: { runId: "cleanup-run", executionId: "cleanup-execution", plan, profile: defaultProfile() }
      });
      const state = stateOperation(plan, "urn:state:alice-files-ready");

      await assert.rejects(async () => execution.assertState(state), /not started/);
      await execution.start();
      await assert.rejects(async () => execution.start(), /cannot start from started/);
      await assert.rejects(async () => execution.close({ executionFailed: false }), (error: unknown) => {
        assert.ok(error instanceof AggregateError);
        assert.equal(error.errors.length, 2);
        assert.match(error.message, /Injected adapter close failure/);
        return true;
      });
      await execution.close({ executionFailed: false });
      assert.deepEqual(closed, ["native", "web"]);
      await assert.rejects(async () => execution.assertState(state), /not started/);
    }
  },
  {
    name: "runner tracks entry navigation separately for each actor and touchpoint",
    async run() {
      const source = await loadFixturePlan();
      const state = stateOperation(source, "urn:state:alice-files-ready");
      assert.ok(state.entryBinding);
      const nativeState = { ...state, id: "native-state", touchpointId: "native" };
      const changedEntry = {
        ...state,
        id: "changed-entry-state",
        entryBinding: { ...state.entryBinding, value: "another-entry" }
      };
      const plan: JourneyPlan = {
        ...source,
        operations: [state, nativeState, nativeState, state, changedEntry]
      };
      const webCalls: string[] = [];
      const nativeCalls: string[] = [];
      const result = await runJourney({
        plan,
        adapter: touchpointAdapter({
          [state.touchpointId]: fakeAdapter(webCalls),
          native: fakeAdapter(nativeCalls)
        }),
        profiles: [defaultProfile()]
      });

      assert.equal(result.ok, true);
      assert.deepEqual(webCalls.filter((call) => call.includes(":open:")), [
        `default:open:${state.entryBinding.value}`, "default:open:another-entry"
      ]);
      assert.deepEqual(nativeCalls.filter((call) => call.includes(":open:")), [
        `default:open:${state.entryBinding.value}`
      ]);
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
      assert.equal(result.executions[0].outcome.kind, "failed");
      assert.deepEqual(closeInputs, [true]);
      assert.match(failureMessage(result.executions[0]?.outcome), /Injected state failure/);
      const failedOperation = result.evidence.executions[0]?.operations[0];
      assert.equal(failedOperation?.operationKind, "state");
      assert.equal(failedOperation?.outcome.kind, "failed");
      assert.match(failureMessage(failedOperation?.outcome), /Injected state failure/);
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
      assert.match(
        failureMessage(result.executions[0]?.outcome),
        /Injected execution completion observer failure/
      );
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
          calls.push(`execution-completed:${execution.executionId}:${String(executionPassed(result))}`);
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
      assert.deepEqual(result.evidence.executions[0]?.operations, [
        {
          operationId: plan.operations[0].id,
          graphNodeId: (plan.operations[0] as StatePlanOperation).state.id,
          operationKind: "state",
          adapter: { name: "fake-adapter" },
          outcome: { kind: "passed" }
        }
      ]);
    }
  },
  {
    name: "runner records observer failures as non-ok results",
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
      assert.match(failureMessage(result.executions[0]?.outcome), /Injected observer failure/);
      assert.deepEqual(result.evidence.executions[0]?.operations, []);
    }
  },
  {
    name: "operation evidence characterization covers runner and Playwright execution",
    async run() {
      const emptyPlan: JourneyPlan = { id: "characterization-empty-plan", operations: [] };
      const singleProfile = await runJourney({
        plan: emptyPlan,
        adapter: fakeAdapter([]),
        profiles: [defaultProfile()],
        runId: "characterization-single"
      });
      assert.deepEqual(singleProfile.evidence.executions, [
        {
          executionId: "default-01",
          profileId: "default",
          operations: []
        }
      ]);

      const twoProfiles = await runJourney({
        plan: emptyPlan,
        adapter: fakeAdapter([]),
        profiles: [defaultProfile(), keyboardOnlyProfile()],
        runId: "characterization-two-profile"
      });
      assert.deepEqual(
        twoProfiles.evidence.executions.map((execution) => ({
          executionId: execution.executionId,
          profileId: execution.profileId,
          operations: execution.operations
        })),
        [
          {
            executionId: "default-01",
            profileId: "default",
            operations: []
          },
          {
            executionId: "keyboard-only-02",
            profileId: "keyboard-only",
            operations: []
          }
        ]
      );

      const sourcePlan = await loadFixturePlan();
      const state = stateOperation(sourcePlan, "urn:state:alice-files-ready");
      const failingState = await runJourney({
        plan: { ...sourcePlan, operations: [state] },
        adapter: fakeAdapter([], { failStateId: state.state.id }),
        profiles: [defaultProfile()],
        runId: "characterization-state-failure"
      });
      const failedOperation = failingState.evidence.executions[0]?.operations[0];
      assert.equal(failingState.ok, false);
      assert.equal(failedOperation?.operationId, state.id);
      assert.equal(failedOperation?.operationKind, "state");
      assert.equal(failedOperation?.outcome.kind, "failed");
      assert.match(failureMessage(failedOperation?.outcome), /Injected state failure/);

      const startupFailure = await runJourney({
        plan: emptyPlan,
        adapter: fakeAdapter([], { failStart: true }),
        profiles: [defaultProfile()],
        runId: "characterization-startup-failure"
      });
      assert.equal(startupFailure.ok, false);
      assert.match(
        failureMessage(startupFailure.executions[0]?.outcome),
        /Injected adapter startup failure/
      );
      assert.deepEqual(startupFailure.evidence.executions[0]?.operations, []);

      const closeFailure = await runJourney({
        plan: emptyPlan,
        adapter: fakeAdapter([], { failClose: true }),
        profiles: [defaultProfile()],
        runId: "characterization-close-failure"
      });
      assert.equal(closeFailure.ok, false);
      assert.match(
        failureMessage(closeFailure.executions[0]?.outcome),
        /Injected adapter close failure/
      );
      assert.deepEqual(closeFailure.evidence.executions[0]?.operations, []);

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
      assert.equal(observerFailure.ok, false);
      assert.match(
        failureMessage(observerFailure.executions[0]?.outcome),
        /Injected characterization observer failure/
      );
      assert.deepEqual(observerFailure.evidence.executions[0]?.operations, []);

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
      assert.deepEqual(playwrightObserverResult.evidence.executions[0]?.operations, [
        {
          operationId: state.id,
          graphNodeId: state.state.id,
          operationKind: "state",
          adapter: { name: "@openuji/journey-adapter-playwright", version: "0.1.0" },
          outcome: { kind: "passed" }
        }
      ]);
    }
  },
  {
    name: "playwright adapter converts role, name, context, and binding composition",
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
      assert.doesNotMatch(locator.toString(), /expanded=/);

      const expandedBindings = structuredClone(operation.activation.bindings);
      expandedBindings[0].locators[0].features = [
        {
          id: "test-expanded",
          name: "expanded",
          value: "true"
        }
      ];
      const expandedLocator = await toPlaywrightObservationLocator(
        root as never,
        expandedBindings,
        {
          driver,
          operation,
          context: fakeDriverContext()
        }
      );
      assert.match(expandedLocator.toString(), /expanded=true/);

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
      const execution = adapter.createExecution(fakeAdapterExecutionInput(context));

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
      const adapter = playwrightAdapter({
        driver: testPlaywrightDriver(),
        browser: browser as never,
        assertionTimeoutMs: 1
      });
      const execution = adapter.createExecution(fakeAdapterExecutionInput(context));

      await execution.start();
      await execution.close({ executionFailed: false });

      assert.equal(browser.closeCalls, 0);
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
      const execution = adapter.createExecution(fakeAdapterExecutionInput(fakeDriverContext()));

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
      assert.deepEqual(result.evidence.executions[0]?.operations, [
        {
          operationId: state.id,
          graphNodeId: state.state.id,
          operationKind: "state",
          adapter: { name: "@openuji/journey-adapter-playwright", version: "0.1.0" },
          outcome: { kind: "passed" }
        },
        {
          operationId: transition.id,
          graphNodeId: transition.transition.id,
          operationKind: "transition",
          adapter: { name: "@openuji/journey-adapter-playwright", version: "0.1.0" },
          outcome: { kind: "passed" }
        },
        {
          operationId: controlFlow.id,
          graphNodeId: controlFlow.transition.id,
          operationKind: "control-flow",
          adapter: { name: "@openuji/journey-adapter-playwright", version: "0.1.0" },
          outcome: { kind: "passed" }
        }
      ]);
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

      const execution = driver.createExecution(fakeDriverExecutionInput(context));
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
      const secondExecution = driver.createExecution(fakeDriverExecutionInput(secondContext));
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
    name: "axe audit report formatting derives immutable evidence from explicit data inputs",
    run() {
      const metadata = { notes: ["original"] };
      const input = {
        auditId: "pure-audit",
        createdAt: "2026-01-01T00:00:00.000Z",
        url: "https://example.test/apps/files/?x=1#fragment",
        strict: true,
        metadata
      };
      const scans = {
        pageState: fakeAxeResults({ passes: 1, violations: 1 }),
        matchedSurface: fakeAxeResults({ passes: 1 })
      };
      const report = buildAxeAuditReport(input, ["wcag2a"], scans);
      assert.deepEqual(buildAxeAuditReport(input, ["wcag2a"], scans), report);
      assert.equal(report.createdAt, input.createdAt);
      assert.equal(report.url, input.url);
      assert.equal(report.strict, true);
      assert.equal(report.summary.violations, 1);
      assert.equal(report.summary.passes, 2);
      assert.equal(report.evidence.pageState.nodes[0]?.urlPath, "/apps/files/?x=1#fragment");
      assert.equal(report.evidence.pageState.nodes[0]?.resultType, "violation");
      assert.ok(Object.isFrozen(report.scans.pageState.violations));
      metadata.notes.push("changed by caller");
      scans.pageState.violations.length = 0;
      assert.deepEqual(report.metadata.notes, ["original"]);
      assert.equal(report.scans.pageState.violations.length, 1);
    }
  },
  {
    name: "axe path classification replays immutable facts without changing evidence or reading mutable inputs",
    async run() {
      const source = await loadFixturePlan();
      const state = stateOperation(source, "urn:state:alice-files-ready");
      const automatic = cloneOperation(transitionOperation(source, "urn:transition:bob-accepts-share"));
      automatic.activation.requiredInputModalityProfiles = [];
      const unvisited = transitionOperation(source, "urn:transition:alice-opens-file-menu");
      const controlFlow = source.operations.find((operation): operation is ControlFlowPlanOperation => operation.kind === "control-flow");
      assert.ok(controlFlow);
      const plan = { ...source, operations: [state, automatic, controlFlow, unvisited] };
      const page = new FakeAxePage();
      const rawReport = fakeAxeReport({ auditId: "immutable-scan", page: page as never });
      const originalStateLabel = state.state.label;
      const axe = axeObserver({
        testInfo: new FakeAxeTestInfo("immutable-evidence") as never,
        reportId: "immutable-evidence",
        auditRunner: async () => {
          state.state.label = "changed during scan";
          return rawReport;
        }
      });
      const execution = fakeAxeExecution(plan);
      const empty = axe.evidence;
      assert.strictEqual(empty, axe.evidence);
      assert.ok(Object.isFrozen(empty));
      axe.onExecutionStarted?.({ execution });
      const started = axe.evidence;
      assert.equal(started.length, 1);
      assert.equal(axe.latestPathReport, undefined);
      await axe.observeOperation?.({
        execution, operation: state, stage: "state-asserted", expectedMatchCount: 1,
        page: page as never, locator: new FakeAxeLocator() as never
      });
      await axe.observeOperation?.({ execution, operation: automatic, stage: "transition-completed" });
      await axe.observeOperation?.({ execution, operation: controlFlow, stage: "control-flow-recorded" });
      const facts = axe.evidence;
      assert.equal(empty.length, 0);
      assert.equal(started.length, 1);
      assert.equal(facts.length, 4);
      assert.ok(facts.every((fact) => Object.isFrozen(fact)));
      const observed = facts.find((fact) => fact.kind === "operation-observed" && "audit" in fact.evidence);
      assert.ok(observed?.kind === "operation-observed" && "audit" in observed.evidence && observed.evidence.audit.kind === "completed");
      assert.equal(Reflect.set(observed.evidence.audit.report.summary, "violations", 99), false);
      assert.ok(facts.every((fact) => !("status" in fact) && !("reason" in fact)));

      // Mutating the caller's plan or scan result cannot rewrite captured facts.
      state.state.label = "changed by caller";
      assert.equal(Reflect.set(rawReport.summary, "violations", 99), true);
      const input = {
        reportId: "replayed-evidence",
        createdAt: "2026-01-01T00:00:00.000Z",
        result: fakeRunResult(plan, [executionResult(execution, true)]),
        evidence: facts,
        wcagTags: wcag22Tags
      };
      const first = buildAxeObservedPathReport(input);
      assert.deepEqual(buildAxeObservedPathReport(input), first);
      const summary = buildAxeAccessibilitySummaryReport({ pathReport: first });
      assert.equal(summary.generatedAt, input.createdAt);
      assert.deepEqual(buildAxeAccessibilitySummaryReport({ pathReport: first }), summary);
      assert.strictEqual(axe.evidence, facts);
      assert.ok(Object.isFrozen(first));
      assert.ok(Object.isFrozen(first.items));
      assert.deepEqual(first.items.map((item) => item.status), ["audited", "not-applicable", "not-applicable", "skipped"]);
      assert.equal(first.items[0]?.summary?.violations, 0);
      assert.notEqual(first.items[0]?.metadata.stateLabel, "changed by caller");
      assert.equal(first.items[0]?.metadata.stateLabel, originalStateLabel);
      assert.match(first.items[1]?.reason ?? "", /No-input transition completed/);
      assert.match(first.items[3]?.reason ?? "", /runner ended/);
      assert.equal(buildAxePathItems(facts.filter((fact) => fact.kind === "operation-observed"), execution.runId).length, 3);
    }
  },
  {
    name: "axe strict failures derive from scan history and remain isolated across runs",
    async run() {
      const source = await loadFixturePlan();
      const state = stateOperation(source, "urn:state:alice-files-ready");
      const plan = { ...source, operations: [state] };
      let scans = 0;
      const axe = axeObserver({
        testInfo: new FakeAxeTestInfo("strict-history") as never,
        reportId: "strict-history",
        strict: true,
        auditRunner(input) {
          scans += 1;
          return Promise.resolve(fakeAxeReport(input, { violations: scans === 1 ? 1 : 0 }));
        }
      });
      const firstExecution = fakeAxeExecution(plan);
      const observe = (execution: JourneyExecutionDescriptor) => axe.observeOperation?.({
        execution, operation: state, stage: "state-asserted", expectedMatchCount: 1,
        page: new FakeAxePage() as never, locator: new FakeAxeLocator() as never
      });
      axe.onExecutionStarted?.({ execution: firstExecution });
      await observe(firstExecution);
      await observe(firstExecution);
      const firstFacts = axe.evidence;
      await assert.rejects(() => reportAxe(axe, fakeRunResult(plan, [executionResult(firstExecution, true)])), /Axe found 1 WCAG violation/);
      assert.equal(axe.latestPathReport?.summary.violations, 0);
      assert.strictEqual(axe.evidence, firstFacts);

      const secondExecution = { ...firstExecution, runId: "second-run" };
      axe.onExecutionStarted?.({ execution: secondExecution });
      await observe(secondExecution);
      await reportAxe(axe, { ...fakeRunResult(plan, [executionResult(secondExecution, true)]), runId: secondExecution.runId });
      assert.equal(firstFacts.length, 3);
      assert.equal(axe.evidence.length, 5);
      assert.equal(axe.latestPathReport?.metadata.runId, secondExecution.runId);
      assert.equal(axe.latestPathReport?.items.length, 1);
      assert.equal(axe.latestPathReport?.summary.violations, 0);
    }
  },
  {
    name: "axe keeps failed screenshot evidence while a scoped audit succeeds",
    async run() {
      const source = await loadFixturePlan();
      const state = stateOperation(source, "urn:state:alice-files-ready");
      const plan = { ...source, operations: [state] };
      const axe = axeObserver({
        testInfo: new FakeAxeTestInfo("screenshot-failure-fact") as never,
        reportId: "screenshot-failure-fact",
        sourceScreenshots: { states: true },
        auditRunner: async (input) => fakeAxeReport(input)
      });
      const execution = fakeAxeExecution(plan);
      await axe.observeOperation?.({
        execution, operation: state, stage: "state-asserted", expectedMatchCount: 1,
        page: { url: () => "https://example.test", screenshot() { throw new Error("Screenshot failed"); } } as never,
        locator: new FakeAxeLocator() as never
      });
      assert.equal(axe.evidence.length, 1);
      const fact = axe.evidence[0];
      assert.ok(fact?.kind === "operation-observed" && "audit" in fact.evidence);
      assert.equal(fact.evidence.audit.kind, "completed");
      assert.equal(fact.evidence.screenshot.kind, "failed");
      await reportAxe(axe, fakeRunResult(plan, [executionResult(execution, true)]));
      assert.equal(axe.latestPathReport?.items[0]?.status, "audited");
      assert.equal(axe.latestPathReport?.items[0]?.sourceScreenshotError, "Screenshot failed");
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
      await reportAxe(axe, fakeRunResult(plan, [executionResult(execution, true)]));

      assert.equal(auditCalls.length, 2);
      assert.deepEqual([...wcag22Tags], [
        "wcag2a",
        "wcag2aa",
        "wcag21a",
        "wcag21aa",
        "wcag22aa"
      ]);
      assert.deepEqual(axe.latestPathReport?.wcagTags, [...wcag22Tags]);
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
    name: "axe path html escapes metadata while rendering generated report links",
    async run() {
      const sourcePlan = await loadFixturePlan();
      const state = stateOperation(sourcePlan, "urn:state:alice-files-ready");
      const plan: JourneyPlan = {
        ...sourcePlan,
        operations: [state]
      };
      const testInfo = new FakeAxeTestInfo("axe-html-escaping");
      const axe = axeObserver({
        testInfo: testInfo as never,
        reportId: "html-escaping",
        metadata: {
          injectedHtml: "<a href=https://evil.test>unsafe</a>"
        },
        auditRunner(input) {
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
      await reportAxe(axe, fakeRunResult(plan, [executionResult(execution, true)]));

      const pathHtmlAttachment = testInfo.attachments.find(
        (attachment) => attachment.name === "axe-path-html-escaping.html"
      );
      assert.ok(pathHtmlAttachment?.path);
      const pathHtml = await readFile(pathHtmlAttachment.path, "utf8");
      assert.match(pathHtml, /WCAG tags/);
      assert.match(pathHtml, /wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa/);
      assert.match(pathHtml, /&lt;a href=https:\/\/evil\.test&gt;unsafe&lt;\/a&gt;/);
      assert.doesNotMatch(pathHtml, /<a href=https:\/\/evil\.test>unsafe<\/a>/);
      const sourceJsonHref = axe.latestPathReport?.items[0].sourceJsonHref;
      assert.ok(sourceJsonHref);
      assert.ok(pathHtml.includes(`<a href="${sourceJsonHref}">JSON</a>`));
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
      await reportAxe(axe, fakeRunResult(plan, [executionResult(execution, true)]));

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
    name: "axe observer keeps source screenshot fallback when audit runner fails",
    async run() {
      const sourcePlan = await loadFixturePlan();
      const state = stateOperation(sourcePlan, "urn:state:alice-files-ready");
      const plan: JourneyPlan = {
        ...sourcePlan,
        operations: [state]
      };
      const testInfo = new FakeAxeTestInfo("axe-screenshot-fallback");
      const axe = axeObserver({
        testInfo: testInfo as never,
        reportId: "screenshot-fallback",
        sourceScreenshots: {
          states: true
        },
        auditRunner() {
          return Promise.reject(new Error("axe scan failed"));
        }
      });
      const execution = fakeAxeExecution(plan);

      axe.onExecutionStarted?.({ execution });
      await assert.rejects(async () => {
        await axe.observeOperation?.({
          execution,
          expectedMatchCount: 1,
          locator: new FakeAxeLocator() as never,
          operation: state,
          page: new FakeAxePage() as never,
          stage: "state-asserted"
        });
      }, /axe scan failed/);
      const failureFact = axe.evidence.find((fact) => fact.kind === "operation-observed");
      assert.ok(failureFact?.kind === "operation-observed" && "audit" in failureFact.evidence);
      assert.equal(failureFact.evidence.audit.kind, "failed");
      assert.equal(failureFact.evidence.screenshot.kind, "captured");
      await reportAxe(axe, fakeRunResult(plan, [executionResult(execution, false)]));

      const item = axe.latestPathReport?.items[0];
      assert.equal(item?.status, "skipped");
      assert.match(item?.reason ?? "", /axe audit did not complete/);
      assert.match(item?.sourceScreenshotHref ?? "", /\.source\.playwright-screenshot\.png$/);
      assert.equal(item?.sourceScreenshotError, undefined);
      assert.ok(testInfo.attachments.some((attachment) => attachment.name.endsWith("-source.png")));
    }
  },
  {
    name: "axe path report builder preserves UJG metadata and summaries",
    async run() {
      const report = buildAxePathAuditReport({
        reportId: "builder-test",
        createdAt: "2026-01-01T00:00:00.000Z",
        wcagTags: ["wcag2a", "wcag2aa"],
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
      assert.deepEqual(report.wcagTags, ["wcag2a", "wcag2aa"]);
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
      assert.equal(typeof nextcloudDriverOptions.entries["nextcloud.files"], "function");
      assert.equal(typeof nextcloudDriverOptions.entries["nextcloud.pendingShares"], "function");
      assert.equal(
        typeof nextcloudEnvironment.verifyEffect,
        "function"
      );
      assert.equal(typeof nextcloudEnvironment.setup, "function");
      assert.equal(typeof nextcloudEnvironment.teardown, "function");
      assert.equal(nextcloudDriverOptions.setupExecution, undefined);
      assert.equal(nextcloudDriverOptions.teardownExecution, undefined);
      assert.equal(nextcloudDriverOptions.effectHandlers, undefined);

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
    name: "nextcloud example pins Docker image to a versioned digest",
    async run() {
      const composeSource = await readFile(
        new URL("../examples/nextcloud-filesharing/deployment/compose.yaml", import.meta.url),
        "utf8"
      );
      const pinnedNextcloudImage =
        "nextcloud:34.0.2-apache@sha256:e93ccfc952c95f18175f3d297fb2f60c35070c05ca976050c250a9ddab793e75";

      assert.equal(composeSource.split(pinnedNextcloudImage).length - 1, 2);
      assert.doesNotMatch(composeSource, /nextcloud:stable-apache/);
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
      assert.match(configSource, /UJG_EXAMPLE_TIMEOUT_MS/);
      assert.match(configSource, /outputDir:\s*"test-results"/);
      assert.match(configSource, /outputFolder:\s*"playwright-report"/);
      assert.match(configSource, /@openuji\/journey-adapter-playwright\/summary-reporter/);
      assert.doesNotMatch(configSource, /\.\/ujg-summary-reporter\.ts/);

      const runSource = await readFile(
        new URL("../examples/nextcloud-filesharing/run.ts", import.meta.url),
        "utf8"
      );
      assert.match(runSource, /from "@playwright\/test"/);
      assert.match(runSource, /test\("executes the federated file-sharing UJG journey"/);
      assert.match(runSource, /const runner = createNextcloudFilesharingRunner\(\);[\s\S]*test\("executes the federated file-sharing UJG journey"[\s\S]*await runner\.run\(\{\s*browser:\s*browser as Browser,\s*testInfo\s*\}\)/);
      assert.match(runSource, /Architecture sketch:/);
      assert.match(runSource, /UJG_EVIDENCE_STDOUT/);
      assert.match(runSource, /browser:\s*browser as Browser/);
      assert.doesNotMatch(runSource, /printJourneyRunSummary/);
      assert.doesNotMatch(runSource, /testInfo\.attach\("ujg-evidence\.json"/);
      assert.doesNotMatch(runSource, /testInfo\.attach\("ujg-summary\.json"/);
      assert.doesNotMatch(runSource, /function attachRunSummary/);
      assert.doesNotMatch(runSource, /function runSummary/);
      assert.match(runSource, /playwrightJsonEvidenceReporter/);
      assert.match(runSource, /playwrightJourneyRunSummaryReporter/);
      assert.match(runSource, /axeObserver/);
      assert.match(runSource, /sourceScreenshots:\s*\{/);
      assert.match(runSource, /states:\s*true/);
      assert.match(runSource, /executionObservers:\s*\[axe\]/);
      assert.doesNotMatch(runSource, /observers:\s*\[axe\]/);
      assert.match(runSource, /const reporters = \[evidence,\s*axe,\s*summary\]/);
      assert.doesNotMatch(runSource, /preflightErrors/);
      assert.match(runSource, /await reportJourneyResult\(\{/);
      assert.match(runSource, /reporters,\s*result/s);
      assert.doesNotMatch(
        runSource,
        /profiles:\s*\[defaultProfile\(\),\s*keyboardOnlyProfile\(\)\],\s*reporters:/
      );
      assert.match(runSource, /expect\(reporting\.errors/);
      assert.match(runSource, /nextcloud-filesharing\.axe-path/);
      assert.match(runSource, /latestAccessibilitySummaryReportPath/);
      assert.match(runSource, /accessibility/);
      assert.doesNotMatch(runSource, /UJG journey \$\{result\.ok/);
      assert.doesNotMatch(runSource, /console\.log\(`  evidence:/);

      const reporterSource = await readFile(
        new URL("../packages/journey-adapter-playwright/src/summary-reporter.ts", import.meta.url),
        "utf8"
      );
      assert.match(reporterSource, /renderJourneyRunSummary/);
      assert.match(reporterSource, /ujg-summary\.json/);
      assert.match(reporterSource, /onEnd/);

      const adapterSource = await readFile(
        new URL("../packages/journey-adapter-playwright/src/reporters.ts", import.meta.url),
        "utf8"
      );
      assert.match(adapterSource, /playwrightJsonEvidenceReporter/);
      assert.match(adapterSource, /playwrightJourneyRunSummaryReporter/);
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
  assert.ok(profile.selectInputModality);
  return profile.selectInputModality(operation, {} as JourneyExecutionContext) as InputModalityDecision;
}

function assertJourneyInputModalityId(value: string): asserts value is JourneyInputModalityId {
  assert.ok(
    (journeyInputModalityIds as readonly string[]).includes(value),
    `Expected ${value} to be an executable journey input modality id`
  );
}

function cloneOperation(operation: TransitionPlanOperation): TransitionPlanOperation {
  return structuredClone(operation) as TransitionPlanOperation;
}

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `Expected source to include ${start}`);
  assert.notEqual(endIndex, -1, `Expected source to include ${end}`);
  return source.slice(startIndex, endIndex);
}

function isOperationStarted(
  event: JourneyProgressEvent
): event is Extract<JourneyProgressEvent, { type: "operation-started" }> {
  return event.type === "operation-started";
}

function isOperationTerminal(
  event: JourneyProgressEvent
): event is Extract<
  JourneyProgressEvent,
  { type: "operation-completed" | "operation-failed" }
> {
  return event.type === "operation-completed" || event.type === "operation-failed";
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
          calls.push(`${context.profile.id}:transition:${operation.transition.id}:${decision?.modality.id ?? "automatic"}`);
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

function fakeAdapterExecutionInput(
  context: JourneyExecutionContext
): Parameters<JourneyAdapter["createExecution"]>[0] {
  return { context };
}

function fakeDriverExecutionInput(
  context: PlaywrightDriverExecutionContext
): Parameters<PlaywrightJourneyDriver["createExecution"]>[0] {
  return { context };
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
    ok: executions.length > 0 && executions.every(executionPassed),
    runId: "axe-run",
    plan: {
      id: plan.id,
      ...(plan.source ? { source: plan.source } : {})
    },
    executions,
    assessments: executions.map((execution) => ({ kind: "applicable", profile: { id: execution.profileId } })),
    evidence: {
      executions: executions.map((execution) => ({
        executionId: execution.executionId,
        profileId: execution.profileId,
        operations: []
      }))
    },
    errors: executions.flatMap((execution) => execution.outcome.kind === "failed" ? [execution.outcome.error] : [])
  };
}

function executionResult(
  execution: Pick<JourneyExecutionDescriptor, "executionId" | "profile">,
  ok: boolean
): ExecutionResult {
  return {
    executionId: execution.executionId,
    profileId: execution.profile.id,
    outcome: ok ? { kind: "passed" } : { kind: "failed", error: { name: "Error", message: "Test execution failure" } }
  };
}

function failureMessage(outcome: JourneyOutcome | undefined): string {
  assert.ok(outcome?.kind === "failed", "Expected a failed outcome");
  return outcome.error.message;
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
  await reportAxe(axe, fakeRunResult(plan, [executionResult(execution, true)]));
}

async function reportAxe(axe: AxeObserver, result: RunResult): Promise<void> {
  await axe.report({
    result,
    json: JSON.stringify(result, null, 2)
  });
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
    return join(tmpdir(), `openuji-${this.id}-${pathSegments.join("-")}`);
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
