# Nextcloud Federation Example Stack

Local infrastructure for executing the federated file-sharing UJG journey with Playwright.

## Topology

- Alice: `http://host.docker.internal:18081`
- Bob: `http://host.docker.internal:18082`
- Federated recipient: `bob@http://host.docker.internal:18082`

The instances use the same host name with separate published ports. Playwright on the host and Nextcloud inside Docker both resolve `host.docker.internal`, so federated backend requests do not use `localhost`.

## Start

From the repository root:

```sh
pnpm --filter @openuji/example-nextcloud-filesharing stack:up
pnpm --filter @openuji/example-nextcloud-filesharing stack:provision
pnpm --filter @openuji/example-nextcloud-filesharing stack:seed
```

The scripts use `deployment/.env` when present and fall back to `deployment/.env.example`.

## Run

```sh
pnpm --filter @openuji/example-nextcloud-filesharing e2e
pnpm --filter @openuji/example-nextcloud-filesharing e2e:headed
pnpm --filter @openuji/example-nextcloud-filesharing e2e:report
```

The Playwright report shows traces, screenshots, videos, and the attached `ujg-evidence.json` when artifacts are retained. By default browser artifacts are retained on failure; set `UJG_PLAYWRIGHT_ARTIFACTS=always` to retain them for successful local debugging runs.

To force Playwright traces on a successful debug run:

```sh
UJG_PLAYWRIGHT_ARTIFACTS=always pnpm --filter @openuji/example-nextcloud-filesharing e2e --trace on
```

## Reset

```sh
pnpm --filter @openuji/example-nextcloud-filesharing stack:reset
```
