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
  - Split into `packages/journey-runner`, `packages/journey-evidence`, and `packages/journey-profiles`.
  - The runner now consumes a neutral plan and delegates all execution to an adapter.
  - Evidence is emitted as normalized events grouped by profile execution.

- `tests/federation/accessible-filesharing.spec.ts`
  - Replaced by `examples/nextcloud-filesharing/run.ts`.
  - The example uses the real `examples/nextcloud-filesharing/ujg/filesharing.ujg.jsonld`, two profiles, the generic Playwright adapter, and a configured Nextcloud driver.

- `tests/federation/playwright-ujg-locator.ts`
  - Migrated into `packages/journey-adapter-playwright`.
  - The adapter remains Nextcloud-agnostic and translates neutral UJG locator/interaction targets into Playwright operations.

- `tests/federation/nextcloud-test-helpers.ts`
  - Migrated into `packages/journey-driver-nextcloud` and `examples/nextcloud-filesharing/environment.ts`.
  - Generic Nextcloud browser/session and OCS/WebDAV helpers live in the driver.
  - File-sharing-specific entry bindings, feature values, fixture cleanup, and effect verification live in the example.

- `tests/federation/axeJourneyReport.ts` and related axe/artifact packages
  - Deferred to future `journey-observer-axe` and static reporting work.

- `infrastructure/nextcloud-federation`
  - Migrated into `examples/nextcloud-filesharing/deployment`.
  - The example package owns stack scripts for `stack:up`, `stack:provision`, `stack:seed`, and `stack:reset`.
