# journey-mesh

Model-driven execution and validation of cross-service user journeys, with pluggable model bindings, automation adapters, application drivers, interaction profiles, and evidence observers.

## Commands

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm lint
pnpm test
```

## Nextcloud Example

The Nextcloud file-sharing example owns its own scripts:

```bash
pnpm --filter @openuji/example-nextcloud-filesharing stack:up
pnpm --filter @openuji/example-nextcloud-filesharing stack:provision
pnpm --filter @openuji/example-nextcloud-filesharing stack:seed
pnpm --filter @openuji/example-nextcloud-filesharing e2e
pnpm --filter @openuji/example-nextcloud-filesharing e2e:report
```

The example loads `examples/nextcloud-filesharing/ujg/filesharing.ujg.jsonld`, configures the generic Playwright adapter and Nextcloud driver, runs `defaultProfile()` and `keyboardOnlyProfile()`, and attaches normalized evidence JSON to the Playwright test result. Set `UJG_EVIDENCE_STDOUT=1` to also print the full evidence JSON.

Playwright traces are retained on failure by default. For a successful debug run with retained trace plus adapter screenshots/videos, use:

```bash
UJG_PLAYWRIGHT_ARTIFACTS=always pnpm --filter @openuji/example-nextcloud-filesharing e2e --trace on
```
