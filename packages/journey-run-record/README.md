# Journey run record

The boundary between running journeys and everything that consumes their results.
The host writes a run record; reports, comparisons and dashboards read it. See
the [format](../../docs/run-record.md).

- **`.`** (browser-safe): the record types, `testPassed` / `testFailures` (the
  only verdict rule), path helpers, and `openRunRecord(read)`.
- **`./node`**: `fileEvidenceStore(root, prefix)` (the evidence store plugins
  write to), `writeRunRecord(dir, run)`, `readRunRecord(dir)`, `runReader(dir)`
  and `publishAtomically`.
