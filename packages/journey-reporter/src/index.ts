/**
 * The reporting layer: derive aggregated report data from run records. It reads `run.json` and evidence
 * files only, loads no journey, adapter, or observer runtime, and never changes a test verdict. What to do
 * with the data (viewers, sites, Markdown, templates) is up to the apps that consume the model (`./model`).
 */
export { buildReport } from "./report.js";
export type { BuildReportOptions, BuiltReport } from "./report.js";
export { compareRuns } from "./compare.js";
export type { CompareRunsInput } from "./compare.js";
export { exportReport } from "./export.js";
export type { ExportedReport, ExportedTest } from "./export.js";
export { defaultReportConfig, excludedPhasesFor, loadInterpreters, loadReportConfig, parseReportConfig } from "./config.js";
export type { InterpreterConfig, LoadedInterpreter, ReportConfig } from "./config.js";
export { defineInterpreter } from "./interpreter.js";
export type { DerivedData, Interpretation, InterpreterDefinition, InterpreterInput, NodeSummary } from "./interpreter.js";
export { buildReportModel, buildTestModel, testModelHref, testSummary } from "./model/build.js";
export type { Interpreted } from "./model/build.js";
export { compareMeasurements, inferPairings, validatePairings } from "./comparison.js";
export { selectJourneyMaps } from "./journey-maps.js";
export type { JourneyMapSelection } from "./journey-maps.js";
export * from "./model/index.js";
