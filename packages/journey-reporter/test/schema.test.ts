import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Ajv } from "ajv";
import { buildReport, compareRuns } from "../src/index.js";
import { collectivesTest } from "./collectives-fixture.js";
import { fixtureConfig, savedTest, suiteRun, writeRun } from "./fixtures.js";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const schemaPath = join(packageRoot, "schema/report-model.schema.json");

test("the committed JSON Schema matches the model types", async () => {
  const output = join(await mkdtemp(join(tmpdir(), "report-schema-")), "schema.json");
  await promisify(execFile)(process.execPath, [join(packageRoot, "node_modules/ts-json-schema-generator/bin/ts-json-schema-generator.js"),
    "--path", "src/model/types.ts", "--tsconfig", "tsconfig.json", "--type", "ReportModelDocument", "--no-type-check", "--out", output], { cwd: packageRoot });
  assert.deepEqual(JSON.parse(await readFile(output, "utf8")), JSON.parse(await readFile(schemaPath, "utf8")), "Run pnpm --filter @openuji/journey-reporter schema");
});

test("suite and comparison models validate against the schema", async () => {
  const schema = JSON.parse(await readFile(schemaPath, "utf8"));
  const ajv = new Ajv({ allErrors: true, strict: false });
  ajv.addSchema(schema, "report-model");
  const validate = (type: string, value: unknown) => {
    const check = ajv.compile({ $ref: `report-model#/definitions/${type}` });
    assert.ok(check(value), JSON.stringify(check.errors, null, 2));
  };
  const directory = await mkdtemp(join(tmpdir(), "report-schema-models-"));
  const baseline = await writeRun(join(directory, "baseline"), suiteRun([await collectivesTest(), savedTest()]));
  const candidate = await writeRun(join(directory, "candidate"), suiteRun([await collectivesTest()]));
  const { model, tests } = await buildReport(baseline, { config: fixtureConfig({ excludedPhaseIds: ["urn:phase:setup"] }) });
  validate("ReportModel", model);
  for (const test of tests) validate("TestModel", test);
  validate("ReportModel", await compareRuns({ baseline, candidate, outputDir: join(directory, "comparison"), config: fixtureConfig() }));
});
