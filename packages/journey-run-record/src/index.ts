/**
 * The boundary between running journeys and everything that consumes their results.
 * The host writes a run record; reports, comparisons, and dashboards read it.
 * Types and pure helpers only, safe for browser bundles; filesystem access is in `./node`.
 */
export type * from "./types.js";
export { runRecordFormat, testRecordFormat } from "./types.js";
export { testDirectory, testRecordHref, testFilesPrefix, serviceFilesPrefix, suiteFilesPrefix, reservedNames, validateHref } from "./paths.js";
export { testFailures, testPassed } from "./verdict.js";
export { openRunRecord, loadSuiteRun } from "./read.js";
export type { RunReader, RunRecordHandle } from "./read.js";
