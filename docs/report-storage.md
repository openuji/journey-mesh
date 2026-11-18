# Report directory format, version 1

A report is a directory with one `manifest.json` entry point. Files are compact
JSON or ordinary linked assets; the HTML viewer contains no result payload.
Serve the whole directory over HTTP with `journey-mesh report <directory>` or a
static server. Reading, rendering, and comparing reports requires no mesh,
model source files, application, or plugin loading.

## Policy

Suite-level `report.maxFileSizeMiB` defaults to 5. Positive finite numeric values
are converted once with `floor(value * 1,048,576)` and must produce a positive
safe integer byte count. The manifest persists that count as
`storage.maxFileBytes`. It applies to every generated file, including manifests,
JSON chunks, HTML pages, screenshots, and application assets. Test-level report
settings may replace phase exclusions but cannot change the storage limit.

Republishing retains the saved limit. Comparisons use the smaller limit of their
available subjects, or the default if neither subject loads. JSON evidence is
repacked under that limit. Opaque assets must fit; a large screenshot, XML file,
individual JSON string, object key, or HTML section fails with
`ReportFileSizeError`, naming the file, actual bytes, and configured limit.
Evidence is never silently truncated. Failed publication preserves the existing
destination, and successful publication removes stale and unregistered output.

## Report and test manifests

The root has `format: "journey-mesh/report"`, `version: 1`, `kind` (`suite` or
`comparison`), `storage`, and a `summary` reference. References are objects with
`href`, a relative storage path. The summary contains report metadata, status,
errors, provenance, and artifact descriptors.

A suite also has a `tests` reference to its test index. Index entries contain
test IDs, status, profile IDs, metric kinds, and test-manifest references. Each
test manifest uses `format: "journey-mesh/test"`, `version: 1`, with references
for `summary`, `plan`, `views`, `outputs`, and `executions`. Execution records
are separate documents, so profile switching does not load unrelated executions.
Observer summaries carry evidence references; raw observer evidence is not
needed to draw a journey map or compare measurements.

Distinct model views are stored once under `data/models/`. Test data lives under
`data/tests/<encoded-test-id>/`. Provider evidence retains its test directory,
for example `<encoded-test-id>/<audit-id>.axe.json`. A comparison's `subjects`
references `subjects/baseline/manifest.json` and
`subjects/candidate/manifest.json` rather than embedding suite results.

References in report/test data are relative to their report root. Each
comparison subject is its own report root. Provider artifact references and
their JSON document parts are relative to their test's artifact-store root.
Paths cannot escape that root, including through symlinks during publication.

## Structured JSON documents

`writeJsonDocument(store, {name, value, ...metadata})` writes a root artifact with
`storage: "json-document"`. Every document uses
`format: "journey-mesh/json-document"` and `version: 1`:

| Kind | Content | Decoded value |
| --- | --- | --- |
| `value` | `value` | The original JSON value |
| `array` | `entries` | Ordered array entries |
| `object` | `entries` of `[key, entry]` | Object properties |
| `concat` | `collection` and `parts` references | Concatenated arrays or merged objects |

An entry is `{kind: "inline", value}` or `{kind: "ref", ref: {href}}`.
Transport descriptors sit outside provider/domain data: `$ref`, `@id`, and
similarly named fields in original values keep their original meaning. Large
arrays, objects, and reference indexes are recursively paged. No JSON string is
split across files. Child files live below `<name>.parts/` and are marked
`auxiliary` in the artifact registry.

`readJsonDocument(reader, ref)` reconstructs the original JSON using either
filesystem or HTTP reads. It rejects unsupported versions, invalid paths,
missing files, and reference cycles. `JourneyArtifactStore.maxFileBytes` supplies
the policy to both provider helpers and ordinary writes.

## Provider evidence and pages

The axe observer persists completed raw audits during capture and outputs linked
journal records, summaries, node metrics, and policy errors. The axe reporter
reads those audit references to render finding pages; it does not write another
raw audit. Passing-node details remain in the linked audit documents.

Native HTML references screenshots and hierarchy XML instead of embedding their
contents. Both providers use `writeHtmlPages` with complete semantic sections.
The helper adds bounded page navigation, including following existing finding
fragments into later pages. Secondary pages are auxiliary artifacts. Provider
rendering remains inside the provider package.

`readReport(directoryOrManifest)` reconstructs logical result objects for Node
consumers. `openReport(reader)` reads report indexes first and exposes lazy test
loading for the viewer. Only the new manifest format is accepted; existing
`bundle.json` reports must be regenerated.
