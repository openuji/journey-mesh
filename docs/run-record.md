# Run record format, version 2

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
| `format`, `version` | `"journey-mesh/run"`, `2` |
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
| `result` | The runner's immutable `RunResult`: assessments, executions, per-operation outcomes and the `executor` that ran each operation |
| `observers` | Observer outputs: `{ id, kind, measurements, evidence, errors }` |
| `observerErrors` | Observer outputs that failed or were invalid |
| `segments`, `views` | The configured journeys (`{ id, journeyId, executor, view? }`) and the model document snapshot behind each |
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

## Version 1

Version 1 called the component that executed an operation an *adapter*.
Version 2 renames it to *executor*; nothing else changed. The reader accepts
both versions and normalizes version 1 in memory, so interpreters, observers,
the reporter and `compare` only ever see version-2 records:

| Version 1 | Version 2 |
| --- | --- |
| `segments[].adapter` | `segments[].executor` |
| `result.evidence.executions[].operations[].adapter` | `…operations[].executor` |
| `@openuji/journey-adapter-playwright` | `@openuji/journey-executor-playwright` |
| `@openuji/journey-adapter-appium` | `@openuji/journey-executor-appium` |
| `@openuji/journey-runner/routed-adapter` | `@openuji/journey-runner/routed-executor` |
| `@openuji/journey-runner/touchpoint-adapter` | `@openuji/journey-runner/touchpoint-executor` |

Other component names are kept as recorded. A report built from a version-1 run
equals the report built from the same run written as version 2, and comparing a
version-1 baseline with a version-2 run gives the same result as comparing two
version-1 runs. The mapping lives only in
[`legacy.ts`](../packages/journey-run-record/src/legacy.ts). Republishing a
version-1 run (for example as a `compare` subject) writes it as version 2.
