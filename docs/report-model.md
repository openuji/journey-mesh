# Report model, version 1

The report model is plain JSON derived from a run record, shaped for templates
and frontends. Everything a report needs is already joined: the plan with
execution outcomes, interpreter metrics, screenshots and evidence files per step,
journey-map overlays, and measurement comparisons. Consumers only read and
render. The types are in
[`src/model/types.ts`](../packages/journey-reporter/src/model/types.ts). The
JSON Schema is
[`schema/report-model.schema.json`](../packages/journey-reporter/schema/report-model.schema.json);
its root accepts any model file.

```
<run>/report/
  report.json                       # ReportModel: the run, its tests, report errors
  tests/<test>.json                 # TestModel: profiles, steps, maps, data
  views/<sha256>.json               # model document snapshots ({ format, document })
  data/<test>/<observer>/<name>     # interpreter outputs, e.g. axe-path.json
```

`journey-mesh test` writes it after every run. `journey-mesh report <run>`
rebuilds it from the run record alone; nothing is executed. A comparison
directory (`journey-mesh compare`) has the same `report/report.json` with
`kind: "comparison"`, and each subject's own report is below `subjects/<side>/`.

## Rules for consumers

- **Every `href` is relative to the run directory the file belongs to.** For a
  comparison subject, that is `subjects/<side>/`. Percent-encode each segment
  for URLs.
- **`ok` is the run's verdict, copied from the run record.** `errors` lists
  report problems only, such as a failing interpreter or a broken journey map.
- **Profile outcomes are `passed`, `failed`, `not-executed` or `not-applicable`.**
  Step and map outcomes are `passed`, `failed` or `not-executed`.
- **`NodeMetrics` is open.** The documented kinds are `axe`
  (`pageState`/`matchedSurface` counts), `native` (`findings`, `passes`) and
  `skipped` (`reason`). Render unknown kinds generically.
- **Dispatch interpreter data and evidence files on `format`.** Known formats
  are `journey-mesh/axe-path`, `journey-mesh/axe-audit`,
  `journey-mesh/accessibility-summary` and `journey-mesh/android-accessibility`.
  Link anything else.
- **Run directories always contain whole files.** What an app does when it
  publishes them, such as splitting files for a host's size limit, is that app's
  own format.

## Reading it

Any stack, with plain JSON:

```sh
jq '.tests[] | {id, ok, profiles}' test-results/report/report.json
jq '.profiles[0].steps[] | select(.outcome == "failed") | .label' test-results/report/tests/sharing.json
```

```python
import json, pathlib
from jinja2 import Template

run = pathlib.Path("test-results")
report = json.loads((run / "report/report.json").read_text())
tests = [json.loads((run / t["href"]).read_text()) for t in report["tests"]]
print(Template(open("summary.j2").read()).render(report=report, tests=tests))
```

One file with everything inlined (tests, view documents, and with `--data` every
interpreter output):

```sh
journey-mesh export test-results --data --output report.json
```

JavaScript, in Node.js or the browser:

```ts
import { loadReportModel } from "@openuji/journey-reporter/model";

const url = (href: string) => `./${href.split("/").map(encodeURIComponent).join("/")}`;
const report = await loadReportModel(async (href) => (await fetch(url(href))).json());
const test = await report.loadTest(report.model.tests[0].id);
```

In Node.js, `jsonReader(runReader(dir))` reads a run directory.
[`apps/report-renderer`](../apps/report-renderer) is one consumer: an
interactive viewer, static site publication, and a Markdown summary written with
plain `JSON.parse`.

## Adding report data for a new observer

1. In the observer package, export a types-only `./evidence` entry for what
   `output()` records.
2. Write an interpreter module that the reporting layer loads from
   `report.interpreters`:

```ts
import { defineInterpreter } from "@openuji/journey-reporter/interpreter";

export const journeyMeshInterpreter = defineInterpreter({
  kind: "my-observer",                   // matches JourneyObserverOutput.kind
  async interpret({ test, output, readJson }) {
    return {
      nodes: [{ executionId, operationId, metrics: { kind: "my-metric", score: 3 } }],
      data: [{ name: "my-report.json", format: "example/my-report", label: "My report", value: { ... } }]
    };
  }
});
```

3. Render `example/my-report` in your template, or add a view to
   `apps/report-renderer/src/providers/index.tsx`.
