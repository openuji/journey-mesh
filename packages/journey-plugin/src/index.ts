/**
 * Everything a Journey Mesh plugin author needs: typed plugin kinds, option helpers, and the
 * evidence store contract. Execution-side only: nothing here knows about reports or rendering.
 * Types and pure helpers only, safe for browser bundles.
 */
export type * from "./artifacts.js";
export type {
  AdapterDependencies, AdapterPlugin, Contract, DriverPlugin, EnvironmentPlugin, InputDeclarations, InputMetadata, ResolvedInputs, ServiceDependencies, StartedService, JourneyConfigContext, JourneyMeshPlugin, JourneyModelCompiler, JourneyModelView,
  JourneyObserverComponent, JourneyPluginContext, JourneyPluginKind, JourneyService, ModelPlugin, ObserverPlugin,
  PluginOfKind, ProfilePlugin, ServicePlugin
} from "./plugins.js";
export {
  contract, defineAdapterPlugin, defineDriverPlugin, defineEnvironmentPlugin, defineModelPlugin, defineObserverPlugin,
  defineProfilePlugin, defineServicePlugin
} from "./plugins.js";
export { startedService } from "./started-service.js";
export { observedOperations, routedElsewhere } from "./observations.js";
export type { ObservationFact, ObservedOperation } from "./observations.js";
export { booleanOption, knownOptions, noOptions, optionalString, optionsObject, positiveNumber, requiredString, stringArray } from "./options.js";

export { sourceCheckoutContract, sourceIdentityContract, sourceIdentity } from "./services.js";
export type { SourceIdentity, SourceCheckout } from "./services.js";
