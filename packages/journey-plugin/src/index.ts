/**
 * Everything a Journey Mesh plugin author needs: typed plugin kinds, option helpers,
 * artifact and result contracts. Types and pure helpers only, safe for browser bundles.
 */
export type * from "./artifacts.js";
export { defaultMaxFileBytes, reportFileLimit, ReportFileSizeError, byteLength, checkReportFile, validateReportHref } from "./report-storage.js";
export type { ReportStorageOptions } from "./report-storage.js";
export { writeJsonDocument, readJsonDocument } from "./json-document.js";
export type { JsonDocumentRef } from "./json-document.js";
export type * from "./results.js";
export type {
  AdapterDependencies, AdapterPlugin, Contract, DriverPlugin, EnvironmentPlugin, JourneyMeshPlugin, JourneyModelCompiler, JourneyModelView,
  JourneyObserverComponent, JourneyPluginContext, JourneyPluginKind, JourneyService, ModelPlugin, ObserverPlugin,
  PluginOfKind, ProfilePlugin, ReporterPlugin, ServicePlugin
} from "./plugins.js";
export {
  contract, defineAdapterPlugin, defineDriverPlugin, defineEnvironmentPlugin, defineModelPlugin, defineObserverPlugin,
  defineProfilePlugin, defineReporterPlugin, defineServicePlugin
} from "./plugins.js";
export { escapeHtml } from "./html.js";
export { writeHtmlPages } from "./html-pages.js";
export type { HtmlDocumentParts } from "./html-pages.js";
export { observedOperations, routedElsewhere } from "./observations.js";
export type { ObservationFact, ObservedOperation } from "./observations.js";
export { booleanOption, knownOptions, noOptions, optionalString, optionsObject, positiveNumber, requiredString, stringArray } from "./options.js";

export { sourceCheckoutContract, sourceIdentityContract, sourceIdentity } from "./services.js";
export type { SourceIdentity, SourceCheckout } from "./services.js";
