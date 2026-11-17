# Journey UX observations

An optional Playwright observer/reporter with a runtime-independent calculation
entrypoint. It does not navigate, activate controls, or create fixtures.

`deriveJourneyMetrics({ operations, result, observations, selection })` accepts
execution data and explicit journey-item/graph landmarks. It returns detached,
deeply frozen per-execution measurements. Incomplete paths produce `null` values.

The `./plugin` export composes through the YAML host's existing observer contract.
`selection` declares the journey item, arrival state, acceptance transition,
completion state, and navigation transitions. Each `probe` declares an ID, observed
state, and target graph node. Probes reuse compiled bindings and retain visibility
facts; browser handles never cross into evidence.

The reporter writes `ux-metrics.json` through the supplied artifact store and
preserves the functional result. The package root imports only types. Browser
access lives in `./playwright`; plugin loading and publication stay at I/O
boundaries. Collection/reporting errors follow the existing observer contracts.
