# Prototype Provenance

This repository was bootstrapped from selected implementation work in:

- Source repository: https://github.com/openuji/UJG-FedA11y
- Source branch: `feature/axe-integration`
- Source commit: `9179620e7ce656f9e11852b6194d5b3e4162f66f`

## First Iteration Source Mapping

- `tests/federation/ujg-resolver.ts` and `tests/federation/ujg-resolver-2.ts`
  - Migrated into `packages/journey-model-ujg`.
  - The migration keeps compact JSON-LD loading, state/transition target resolution, locator resolution, localized accessible-name resolution, input-modality profile resolution, and v1 happy-path plan compilation.

- `tests/federation/journeyRunner.ts`
  - Split into `packages/journey-runner`, `packages/journey-evidence`, and `packages/journey-profiles`.
  - The runner now consumes a neutral plan and delegates all execution to an adapter.
  - Evidence is emitted as normalized events grouped by profile execution.

- `tests/federation/accessible-filesharing.spec.ts`
  - Replaced for this iteration by `examples/nextcloud-filesharing/run.ts`.
  - The example uses the real `examples/nextcloud-filesharing/ujg/filesharing.ujg.jsonld`, two profiles, and a dummy adapter that records calls as evidence.

- `tests/federation/playwright-ujg-locator.ts`
  - Deferred to the future `journey-adapter-playwright` package.

- `tests/federation/nextcloud-test-helpers.ts`
  - Deferred to the future `journey-driver-nextcloud` package.

- `tests/federation/axeJourneyReport.ts` and related axe/artifact packages
  - Deferred to future `journey-observer-axe` and static reporting work.
