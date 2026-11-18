# Journey reporter

Publishing, comparison, and viewing of saved Journey Mesh results. These operations
load saved data and registered evidence; they do not execute journeys or plugins.

- `writeReport(dir, bundle)` publishes a complete directory: `manifest.json`,
  semantic JSON chunks, linked evidence, and the Vite viewer. It replaces stale
  output atomically after the new report succeeds.
- `readReport(dirOrManifest, kinds?)` reconstructs a logical suite or comparison.
  Provider audit documents remain linked artifacts. `openReport(reader)` loads
  only the index and provides `loadTest(id, profile?, includeEvidence?)` for lazy
  consumers. The HTTP viewer does not load provider evidence for maps or metrics.
- `publishReport(dirOrManifest, outputDir?)` republishes only registered evidence
  and report data; omitted output means republish in place.
- `compareBundles({baseline, candidate, outputDir, pairings?, title?})` accepts
  report directories or manifests. Subjects are complete reports under
  `subjects/<baseline|candidate>/`; the comparison references their manifests.
- `testPassed` and `testFailures` provide the shared pass policy.
- `fileArtifactStore(root, prefix?, maxFileBytes?)` enforces the resolved file
  limit for every write. `writeJsonDocument` / `readJsonDocument` and
  `writeHtmlPages` from `@openuji/journey-plugin` provide bounded structured
  storage and provider pages without provider-specific logic in the host.

Configure the suite's policy in the mesh:

```yaml
report:
  maxFileSizeMiB: 5
  excludedPhaseIds: [urn:phase:setup]
```

The default is 5 MiB (5,242,880 bytes). Positive fractional MiB values are allowed.
Test-level report settings control phase visibility, not storage. Republishing
uses the saved byte limit; comparisons use the smaller limit of available
subjects. Structured JSON is repacked when necessary. Opaque files, including
existing HTML pages and binary assets, must fit the destination limit.

All viewing uses HTTP; deploy the directory to a static host or run:

```sh
pnpm build
journey-mesh compare baseline-results candidate-results --output comparison
journey-mesh report comparison
journey-mesh render comparison/manifest.json --output published
```

Legacy `bundle.json` inputs are rejected. Regenerate those runs to use the new
format. For schema details see [report storage](../../docs/report-storage.md).

For viewer development against a generated report:

```sh
JOURNEY_REPORT_DIRECTORY=/absolute/path/to/report pnpm --filter @openuji/journey-reporter dev
```
