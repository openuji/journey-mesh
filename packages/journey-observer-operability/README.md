# Operability observer

`@openuji/journey-observer-operability` records how each transition was
performed:

- the input decision: the modality the profile selected, the
  `InputModalityProfile` it satisfies, and the IRI of the UJG RC4
  `TransitionMaterialization` it ran
- every adapter command, one per declared step: the key or pointer action used,
  and whether it completed or failed, with the error

It only observes: it never acts on the page and never changes the verdict. The
resolved materialization steps are already in the test record's plan, so the
evidence stores only IRIs and commands.

```yaml
executors:
  web:
    use: "@openuji/journey-executor-playwright/plugin"
    observers:
      - use: "@openuji/journey-observer-operability/plugin"
        options:
          id: input-steps        # output ID; report data is written below it
report:
  interpreters:
    - use: "@openuji/journey-report-operability"
```

The observer works with the Playwright adapter. Its output has kind
`operability`, and its evidence format is `journey-mesh/operability-evidence`.
Reporting code imports types and the `isOperabilityOutput` guard from the
`./evidence` entry, which loads no browser runtime.

[`@openuji/journey-report-operability`](../journey-report-operability/README.md)
turns the evidence into the report's "Input steps" document.
