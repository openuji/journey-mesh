// Loaded directly by Node in build tooling (vite.config.ts), so relative imports in this
// entry's chain keep explicit .ts extensions.
export {
  compileUjgJsonLd,
  compileUjgYamlToJsonLd
} from "./data/jsonld.ts"
export type {
  UJGJsonLdCompositeState,
  UJGJsonLdDocument,
  UJGJsonLdJourney,
  UJGJsonLdJourneyEntry,
  UJGJsonLdJourneyExit,
  UJGJsonLdNode,
  UJGJsonLdOptions,
  UJGJsonLdState,
  UJGJsonLdSurface,
  UJGJsonLdTouchpoint,
  UJGJsonLdTransition
} from "./data/jsonld.ts"
