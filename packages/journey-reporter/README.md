# Journey reporter

Everything that happens to a saved result bundle: publishing it, comparing two
of them, and the report viewer that renders them. Nothing here executes journeys
or loads plugins.

- `writeReport(dir, bundle)` writes `bundle.json` and a self-contained
  `index.html` (viewer script, styles and bundle inlined), so a report opens from
  disk as well as over HTTP. The host calls it once per output directory;
  reporters never write `bundle.json`.
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

`web/` is the Vite/React viewer. A suite page shows every test's journey map
(`#test=<id>&profile=<id>` scrolls to one and selects the profile). The map
(`web/JourneyMap.tsx`) draws each segment's embedded model view (`journey-map`,
projected from the executed JSON-LD) with the vendored journey-path component,
filtered to the journeys that ran, with outcomes, observer `nodes` metrics and scoped screenshots
on the states, a metrics legend, and links to test-wide provider reports.
Comparisons draw both subjects' maps and link each to its report under
`subjects/<side>/`. Models without a drawable view fall back to a linear path
projected from the plan (`src/journey-path.ts`).

```sh
pnpm build                                   # builds dist/app, required before publishing
journey-mesh compare a/bundle.json b/bundle.json --output comparison
journey-mesh report comparison
```

For development against an existing report:

```sh
JOURNEY_REPORT_DIRECTORY=/absolute/path/to/report pnpm --filter @openuji/journey-reporter dev
```
