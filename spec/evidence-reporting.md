Evidence and reporting

Runner, adapter, driver, profile, and observers contribute facts to the same evidence record.

The reporter does not control the execution. It consumes those facts and renders them.

Evidence producers
## Runner
Journey started and completed.
State entered and reached.
Transition started and completed.
Nested journey entered and exited.
Effect produced or consumed.
Journey failure and final status.
## Adapter
Locator resolution.
Match count.
Interaction performed.
Input modality used.
Assertion result.
Browser screenshot.
Trace or browser error.
## Driver
Touchpoint opened.
Actor authenticated.
Entry binding resolved.
Fixture created.
Dynamic feature resolved.
Application ready.
Fixture cleanup completed.
## Profile
Profile selected.
Allowed modality selected.
Preferred modality unavailable.
Forbidden modality requested.
Profile-specific failure.
## Observer
Observation started and completed.
Observer findings.
Observer metrics.
Observer-generated assets.
Observer errors.

## Reporter

The static reporter writes a portable directory:

evidence/
├── index.html
├── run.json
├── events.ndjson
├── metrics.json
├── components.json
├── executions/
│   ├── default/
│   └── keyboard-only/
├── assets/
│   ├── screenshots/
│   ├── traces/
│   └── observer-axe/
└── journey/
    └── journey.ujg.jsonld

The run manifest should include component provenance:
```ts
{
  "components": {
    "runner": {
      "name": "@openuji/journey-runner",
      "version": "0.1.0"
    },
    "adapter": {
      "name": "@openuji/journey-adapter-playwright",
      "version": "0.1.0"
    },
    "driver": {
      "name": "@openuji/journey-driver-nextcloud",
      "version": "0.1.0"
    },
    "profiles": [
      "default",
      "keyboard-only"
    ],
    "observers": [
      {
        "name": "@openuji/journey-observer-axe",
        "version": "0.1.0"
      }
    ],
    "reporters": [
      {
        "name": "@openuji/journey-reporter-static",
        "version": "0.1.0"
      }
    ]
  }
}
```