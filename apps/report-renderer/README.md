# Report renderer

An app that renders the Journey Mesh [report model](../../docs/report-model.md).
The packages stop at aggregated data; everything here is this app's own choice:
the viewer, static sites and their hosting limits, and Markdown. It reads
`<run>/report/**` and evidence files, never run records, so a run directory and a
comparison directory work the same way.

```sh
pnpm build                                                                  # once: packages and the viewer (dist/)
pnpm --filter @openuji/report-renderer serve    test-results                # viewer on http://127.0.0.1:9323/
pnpm --filter @openuji/report-renderer site     test-results --out site     # static site
pnpm --filter @openuji/report-renderer markdown test-results                # CI job summary or PR comment
```

Paths resolve against the directory you run `pnpm` from.

For the Nextcloud example, run this from the repository root:

```sh
pnpm --filter @openuji/report-renderer serve examples/nextcloud-filesharing/test-results
```

Open <http://127.0.0.1:9323/>. Pass the run directory containing `report/` and
the evidence files, rather than either JSON file printed by `journey-mesh test`.
Serving reads the existing data without rerunning tests. Stop it with Ctrl-C;
append `--port 9324` to use another port.

- **Viewer** (`src/`, React + Vite). It shows the journey map with outcomes,
  node metrics and screenshot previews, plus a profile switch, comparisons, and
  per-step evidence. Data documents open by `format` through
  `src/providers/index.tsx`, which covers the axe path report, raw axe audits
  and the Android report. Hash routes are `#test=…&profile=…`,
  `#data=<href>&format=…`, and `subject=baseline|candidate` for comparisons.
- **Markdown** (`cli/markdown.ts`). It reads the model with plain `JSON.parse`,
  as any other stack would.
- **Static sites** (`cli/site.ts`). They copy the run or comparison directory
  next to the built viewer, atomically.

## Hosting limits (sites only)

`--max-file-size-mib` defaults to 5 and applies to every file of the site,
including viewer assets.

- **JSON larger than the limit is split into linked chunks** at semantic
  boundaries (`format: "journey-mesh/json-document"`; the root keeps its path
  and parts live below `<name>.parts/`). No JSON string is split.
  `src/json-document.ts` reassembles chunks in the viewer.
- **Any other oversized file fails** with `ReportFileSizeError`, naming the
  file, its bytes and the limit.
- **A failed publication keeps the existing site.**

Run directories themselves are never split.

For viewer development against a run:
`JOURNEY_RUN_DIRECTORY=/absolute/path/to/test-results pnpm --filter @openuji/report-renderer dev`.

Tests: `pnpm test` (Node) and `pnpm test:browser` (Chromium via Playwright,
after `pnpm build`).
