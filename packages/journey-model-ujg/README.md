# UJG compiler

The model plugin selects a version-specific compiler from the document's frozen
`@context` URLs. Only **UJG 1.0 RC4** is implemented. RC3, ED, mixed versions,
missing contexts, and unknown versions fail explicitly. There is no legacy mode.

```yaml
model:
  use: "@openuji/journey-model-ujg/plugin"
```

Use the published RC4 module contexts, or the RC4 aggregate context together with
the optional module contexts your document uses. Context mappings and standard
individuals are built into the compiler; they are never fetched at runtime.
The accepted input form is compact JSON-LD with standard term names and top-level
nodes. Inline context overrides, aliases, expanded serialization, relative node
identifiers, and document URLs with fragments are unsupported. Each imported
document declares its own contexts.

## Imports and snapshots

`loadUjgDocumentGraph(source)` loads the root and its import closure from files,
file URLs, or HTTP(S). Relative imports resolve against the importing document's
retrieval location, including the final URL after redirects. Document `@id` does
not supply a retrieval base. Import-only documents may omit `nodes`.

Repeated dependencies and cycles are loaded once per normalized location. There
is no persistent network cache. HTTP retrieval has a 30-second timeout. Failures
include the importer chain. All documents must use the root's version. Identical
node definitions deduplicate; differing definitions of the same IRI are an
unsupported feature, with no root-wins or import-order override policy.

For in-memory input with relative imports, supply an explicit `documentUrl`:

```ts
const graph = await loadUjgDocumentGraph(document, {
  documentUrl: new URL("file:///workspace/models/main.jsonld")
});
const plan = await compileUjgJourneyPlan(graph, { journeyId: "urn:journey:pages" });
const map = toJourneyMapDocument(graph);
```

`parseUjgDocument` parses and checks one document without retrieving imports.
`loadUjgDocument` retrieves one document. Use `loadUjgDocumentGraph` for complete
reference validation. `toJourneyMapDocument` accepts a resolved graph, or a single
document without imports. The plugin shares one immutable graph snapshot between
compilation and map projection during preparation.

## Validation and supported lowering

Errors distinguish `invalid-document`, `unsupported-feature`,
`unsupported-version`, and `import-error` through `UjgCompileError.code`.
Reference validation and Operability validation run over the complete import
closure. This is a compiler for a documented subset, not a replacement for every
RC4 module's normative SHACL conformance validator.

Plan lowering supports phased `Step` execution, linear local paths, one child
Journey per CompositeState, one owning composite per selected Journey, explicit
default entries, and unambiguous persona/touchpoint assignments. Local actions
need Command Surfaces; automatic child-exit continuations remain control flow.
Branches, cycles, StateCollection traversal, adjacency, outgoing navigation,
invocation, and guarded branches are not lowered.

Each observed node needs one Surface. State recognition needs one binding using
`urn:observation-event:presence` or `urn:observation-event:absence` and an explicit
`expectedMatchCount`. A Command Surface needs one activation binding/event.
These are lowering restrictions, not general RC4 validity rules. Accessible
relations are validated as references but are not lowered. Unsupported optional
modules fail explicitly when their semantics are present.

## Operability output

Transition operations include `materializations`, an array of independent
alternatives. Each retains its IRI, transition, modality, optional start locator,
source State, direction, and resolved steps. Step arrays are reconstructed from
`stepPreviousRef`; the source arrays never determine step order. Step IDs,
predecessors, optional locators/move kinds, and opaque extensions survive.

Standard references stay compact, for example `observability:keyboard`,
`observability:pointer`, and `operability:nextItem`. Recognized full standard IRIs
normalize to those identifiers. Producer IRIs remain unchanged. Standard
individuals need no serialized declaration; custom modalities and move kinds do.

Materializations for all four RC4 transition classes are structurally validated.
Only the supported selected topology is lowered to operations. Descriptive
materializations may omit details; the compiler never supplies missing moves,
locators, shortcuts, or text entry. Text entry is outside RC4 Operability and may
use an explicitly declared producer modality.

Profiles choose which materialization runs. After a profile selects a modality, it
selects the one materialization through that modality. If there are several, it
takes the first that `materializationPreference` lists; source order never decides.
It rejects a transition that has none, unless the modality is producer text entry or
the profile sets `requireMaterialization: false`. Preflight runs this selection
before any service starts.

The Playwright adapter performs the selected steps and checks each one as
Operability §7 requires. See its [README](../journey-executor-playwright/README.md).
The Appium adapter refuses materializations through the modalities it supports
until it can perform them. Compilation succeeding says nothing about a
materialization's runtime result.

Existing RC3 jobs must use an older mesh release until they are migrated.

## Another specification version

Add a separate implementation under `src/versions/<version>/` and register its
descriptor in `src/versions/index.ts`. It owns parsing, validation, plan lowering,
and projection into the shared renderer contract. Retrieval and immutable graph
handling are version-neutral. Keep compact standard references, and preserve
version/compiler provenance on plans and operations through host composition.
Do not change RC4 interpretation when adding another version. The fixed RC4 plan
fixture and registry coexistence test check this contract.
