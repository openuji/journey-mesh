# Journey report: axe

Report interpreter for [`journey-observer-axe`](../journey-observer-axe). From
the recorded axe journal and raw audit evidence (`journey-mesh/axe-audit`), it
derives:

- `axe-path.json` (`journey-mesh/axe-path`): every planned operation of every
  execution, audited or with the reason it was not
- `accessibility-summary.json` (`journey-mesh/accessibility-summary`): counts
  per state and transition
- journey-map node metrics of kind `axe` (page and surface counts) and `skipped`

```yaml
report:
  interpreters:
    - use: "@openuji/journey-report-axe"
```

It reads only the observer's `./evidence` entry, never Playwright or axe-core.
