# Run record format, version 1

The run record is what execution leaves behind and the only thing reporting
reads. The host writes it atomically after the run. It is plain JSON plus the
evidence files observers and environments registered, with no size limits, no
chunking and no presentation data. Types and readers are in
[`@openuji/journey-run-record`](../packages/journey-run-record/src/index.ts).

```
<run>/
  run.json                    # RunRecord, format "journey-mesh/run"
  files/**                    # suite-level evidence
  tests/<test>/run.json       # TestRecord, format "journey-mesh/run/test"
  tests/<test>/files/**       # evidence of that test (observers, environment)
  services/<key>/**           # evidence of a service
  report/**                   # not part of the record: derived by reporting
```

`<test>` is the test ID percent-encoded with `.` encoded as `%2E`, so no name is
`.` or `..`. Top-level names (`run.json`, `files`, `tests`, `services`,
`report`) are reserved and cannot collide with a test.

## References

Every `href` in the record is a relative path from the run directory: no empty,
`.` or `..` segments and no URL syntax. A run directory can therefore be moved,
copied or published as is. Readers reject references that escape it, including
through symlinks. Hrefs are file paths; percent-encode each segment to build a
URL.

## `run.json`

| Field | Meaning |
| --- | --- |
| `format`, `version` | `"journey-mesh/run"`, `1` |
| `label`, `target` | The system under test, when configured |
| `ok` | The suite verdict |
| `startedAt`, `finishedAt` | ISO timestamps |
| `errors` | Suite-level execution errors (services, cancellation) |
| `provenance` | What services provided, by service key; never credentials |
| `files` | Suite and service evidence files |
| `tests` | `{ id, ok, href }` per test, in run order |

## `tests/<test>/run.json`

| Field | Meaning |
| --- | --- |
| `id`, `ok` | The test and its verdict |
| `plan` | The compiled plan that ran |
| `result` | The runner's immutable `RunResult`: assessments, executions, per-operation outcomes |
| `observers` | Observer outputs: `{ id, kind, measurements, evidence, errors }` |
| `observerErrors` | Observer outputs that failed or were invalid |
| `segments`, `views` | The configured journeys and the model document snapshot behind each |
| `files` | Evidence files: `{ name, href, contentType, scope?, format? }` |

An evidence file's `scope` ties it to an execution and, optionally, an
operation. Its `format` names the data format for consumers that interpret it,
for example `journey-mesh/axe-audit`.

## Verdict

A test passes when `result.ok` is true, `observerErrors` is empty, and no
observer output has `errors`. Reporting never changes it.

## Reading

```ts
import { openRunRecord } from "@openuji/journey-run-record";        // browser-safe
import { readRunRecord, runReader } from "@openuji/journey-run-record/node";

const run = await readRunRecord("test-results");                  // every test record loaded
const { run: index, loadTest } = await openRunRecord(runReader("test-results"));
```
