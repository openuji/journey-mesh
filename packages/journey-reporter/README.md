# Journey reporter

The reporting layer. It derives aggregated report data from
[run records](../../docs/run-record.md) and never loads a journey, executor or
observer runtime. It never changes a test verdict. It renders and publishes
nothing; that is up to the apps that consume its
[report model](../../docs/report-model.md).

| API | Purpose |
| --- | --- |
| `buildReport(runDir, { config })` | Interprets observer evidence and writes `<run>/report/` atomically: `report.json`, `tests/*.json`, `views/*.json` and interpreter `data/` |
| `loadReportConfig(meshYaml)` / `parseReportConfig(raw)` | The `report:` sections of a suite configuration: `interpreters` and `excludedPhaseIds` (with per-test overrides) |
| `defineInterpreter(...)` | Writes an observer interpreter, exported as `journeyMeshInterpreter` (subpath `./interpreter`) |
| `compareRuns({ baseline, candidate, outputDir, pairings?, title? })` | Writes a comparison directory: subjects below `subjects/<side>/`, the comparison model in `report/report.json` |
| `exportReport(dir, { data })` | Returns the whole report as one plain JSON value |
| `@openuji/journey-reporter/model` | Browser-safe: model types, `loadReportModel(jsonReader)`, `jsonReader(byteReader)` |

`schema/report-model.schema.json` is generated from `src/model/types.ts` with
`pnpm --filter @openuji/journey-reporter schema`. A test fails when the
committed schema is out of date.

CLI: `journey-mesh report <run> [--config mesh.yaml]`,
`journey-mesh export <run> [--data]`, `journey-mesh compare <a> <b>`.
Rendering, for example, is in [`apps/report-renderer`](../../apps/report-renderer).
