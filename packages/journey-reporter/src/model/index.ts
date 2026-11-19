/**
 * The report model contract for renderers and templates. Browser-safe: types and the loader.
 * Building the model from a run record happens in the package's Node entry.
 */
export type * from "./types.js";
export { reportModelFormat, testModelFormat } from "./types.js";
export { jsonReader, loadReportModel } from "./load.js";
export type { ByteReader, JsonReader, LoadedReport } from "./load.js";
