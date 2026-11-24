import { readFile } from "node:fs/promises";
import { compileUjgJourneyPlan, toJourneyMapDocument, type UjgDocument } from "@openuji/journey-model-ujg";
import { testRecordFormat, type TestRecord } from "@openuji/journey-run-record";

/**
 * Snapshot of the real PR2945 model; no separate display topology. Outcomes are controlled test evidence.
 * Map node metrics are recorded by a `fixture-nodes` observer and passed through by `fixtures/node-interpreter.mjs`.
 */
export async function collectivesTest(): Promise<TestRecord> {
  const document: UjgDocument = JSON.parse(await readFile(new URL("./fixtures/collective-own.ujg.jsonld", import.meta.url), "utf8"));
  const segments = ["login", "sharing"].map((id) => ({ id, journeyId: `urn:journey:collective-own:${id}`, executor: "web", view: "collectives" }));
  const operations: Awaited<ReturnType<typeof compileUjgJourneyPlan>>["operations"][number][] = [];
  for (const segment of segments) {
    const child = await compileUjgJourneyPlan(document, { journeyId: segment.journeyId });
    for (const operation of child.operations) operations.push({ ...operation, id: `${segment.id}/${operation.id}`, segment: segment.id, sequence: operations.length });
  }
  const profiles = ["default", "keyboard-only"];
  const sharing = operations.filter((operation) => operation.segment === "sharing" && operation.kind === "state");
  const counts = { violations: 0, incomplete: 0, passes: 15, inapplicable: 45 };
  return {
    format: testRecordFormat, version: 2, ok: true,
    id: "collective-own", segments, views: { collectives: { format: "journey-map", document: toJourneyMapDocument(document) } },
    plan: { id: "plan", operations }, observerErrors: [], files: [],
    result: { ok: true, runId: "saved", plan: { id: "plan" }, errors: [],
      assessments: profiles.map((id) => ({ kind: "applicable", profile: { id } })),
      executions: profiles.map((id) => ({ executionId: id, profileId: id, outcome: { kind: "passed" } })),
      evidence: { executions: profiles.map((id) => ({ executionId: id, profileId: id, operations: operations.map((operation) => ({ operationId: operation.id, operationKind: operation.kind, outcome: { kind: "passed" } })) })) }
    },
    observers: [{ id: "axe", kind: "fixture-nodes", measurements: [], errors: [], evidence: { nodes: profiles.flatMap((id) => [
      { executionId: id, operationId: sharing[0].id, metrics: { kind: "axe", pageState: { ...counts, violations: id === "default" ? 6 : 2, incomplete: 3 }, matchedSurface: { ...counts, violations: 3, incomplete: 1 } } },
      { executionId: id, operationId: sharing[1].id, metrics: { kind: "skipped", reason: "No audit" } },
      { executionId: id, operationId: sharing[2].id, metrics: { kind: "axe", pageState: counts, matchedSurface: counts } }
    ]) } }]
  };
}
