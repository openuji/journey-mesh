# Journey report: Android accessibility

Report interpreter for
[`journey-observer-android-accessibility`](../journey-observer-android-accessibility).
From the recorded hierarchy journal it derives `android-accessibility.json`
(`journey-mesh/android-accessibility`) and journey-map node metrics of kind
`native` (findings, passes) and `skipped`.

```yaml
report:
  interpreters:
    - use: "@openuji/journey-report-android"
```

It reads only the observer's `./evidence` entry, never Appium.
