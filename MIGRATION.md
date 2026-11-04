# Prototype Provenance

This repository was bootstrapped from selected implementation work in:

- Source repository: https://github.com/openuji/UJG-FedA11y
- Source branch: `feature/axe-integration`
- Source commit: `9179620e7ce656f9e11852b6194d5b3e4162f66f`

## Source Mapping

- `tests/federation/ujg-resolver.ts` and `tests/federation/ujg-resolver-2.ts`
  - Migrated into `packages/journey-model-ujg`.
  - The migration keeps compact JSON-LD loading, state/transition target resolution, locator resolution, localized accessible-name resolution, input-modality profile resolution, and v1 happy-path plan compilation.

- `tests/federation/journeyRunner.ts`
  - Split into `packages/journey-runner` and `packages/journey-profiles`; neutral plan contracts live in `packages/journey-execution-model`.
  - The runner now consumes a neutral plan and delegates all execution to an adapter.
  - Immutable operation evidence and outcomes live in the runner's result contracts, grouped by profile execution.

- `tests/federation/accessible-filesharing.spec.ts`
  - Replaced by `examples/nextcloud-filesharing/journey.yaml` and the generic Journey Mesh CLI.
  - The example uses the real `examples/nextcloud-filesharing/ujg/filesharing.ujg.jsonld`, two profiles, the generic Playwright adapter, and a configured Nextcloud driver.

- `tests/federation/playwright-ujg-locator.ts`
  - Migrated into `packages/journey-adapter-playwright`.
  - The adapter remains Nextcloud-agnostic and translates neutral UJG locator/interaction targets into Playwright operations.

- `tests/federation/nextcloud-test-helpers.ts`
  - Migrated into `packages/journey-driver-nextcloud` and `examples/nextcloud-filesharing/environment.ts`.
  - Generic Nextcloud browser/session and OCS/WebDAV helpers live in the driver.
  - File-sharing-specific entry bindings, feature values, fixture cleanup, and effect verification live in the example.

- `tests/federation/axeJourneyReport.ts` and related axe/artifact packages
  - Migrated into `packages/journey-observer-axe`, with immutable collected facts and pure report projection.

- `infrastructure/nextcloud-federation`
  - Migrated into `examples/nextcloud-filesharing/deployment`.
  - The example package owns stack scripts for `stack:up`, `stack:provision`, `stack:seed`, and `stack:reset`.

## YAML-defined tests

The Nextcloud example now has one `journey.yaml`. Its named tests select model
journeys and adapters explicitly. `run.ts`, `android.run.ts`, `web-driver.ts`, and
the Playwright Test configuration files have been removed. Existing `e2e` and
`e2e:android` shortcuts select ordinary test IDs through the same CLI.

Generic artifacts now live under `test-results/<test-id>/`, with a root HTML index
and `journey-results.json`. Use `journey-mesh report test-results` to browse them.
Axe still supports existing `testInfo` callers and additionally accepts
`artifacts: JourneyArtifactStore`. Programmatic runner/adapter APIs remain valid.
`compileUjgJourneyPlan` optionally accepts `{ journeyId }` for subtree selection.
See [the YAML configuration contract](docs/yaml-tests.md).
