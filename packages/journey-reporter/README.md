# Journey reporter

Everything that happens to a saved result bundle: publishing it, comparing two
of them, and the report viewer that renders them. Nothing here executes journeys
or loads plugins.

- `writeReport(dir, bundle)` writes `bundle.json` and the viewer. The host calls
  it once per output directory; reporters never write `bundle.json`.
- `publishReport(bundle.json, dir)` republishes a saved suite or comparison with
  only its registered evidence and the viewer, replacing `dir` atomically
  (`journey-mesh render`).
- `compareBundles({ baseline, candidate, outputDir, pairings?, title? })` compares
  two saved suite runs (`journey-mesh compare`). Executions pair by equal test and
  profile IDs unless explicit pairings are given. Each subject's evidence is
  copied to `subjects/<baseline|candidate>/`.
- `testPassed` / `testFailures` are the single pass rule used by the host, the
  CLI and the viewer.
- `fileArtifactStore(root, prefix?)` is the file-backed `JourneyArtifactStore`.
  Artifacts are registered with relative hrefs only.

`web/` is the Vite/React viewer. It renders suites (tests navigate with
`#test=<id>`), tests, comparisons, measurement tables and journey paths. The
journey path is projected client-side from the saved plan, outcomes and scoped
screenshots (`src/journey-path.ts`) and drawn with the vendored journey-path
component; a selector narrows it to one configured journey.

```sh
pnpm build                                   # builds dist/app, required before publishing
journey-mesh compare a/bundle.json b/bundle.json --output comparison
journey-mesh report comparison
```

For development against an existing report:

```sh
JOURNEY_REPORT_DIRECTORY=/absolute/path/to/report pnpm --filter @openuji/journey-reporter dev
```
