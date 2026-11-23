# Operability report interpreter

`@openuji/journey-report-operability` reads the evidence of the
[operability observer](../journey-observer-operability/README.md) and writes
one report document per test, labelled **Input steps** (format
`journey-mesh/operability`, file `operability.json`).

For each profile execution and each transition, the document lists:

- the outcome: passed, failed with its error, or not reached
- the modality, and the `TransitionMaterialization` that ran (IRI and label)
- each declared step, in order: kind, move kind, target locator, the key or
  pointer action used, and its result. A step after a failure shows as
  `not-performed`.
- commands without a declared step, such as typing a text value

Transitions in phases excluded from the report, such as setup, are left out.
The interpreter adds no journey-map node metrics, because those show
accessibility results. The report viewer opens the document from the test
page's **Open Input steps** link.

```yaml
report:
  interpreters:
    - use: "@openuji/journey-report-operability"
```
