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

The Playwright report shows the attached `ujg-evidence.json` and Axe path reports. Axe source screenshots are attached by the Axe observer for reviewed state pages.

## Reset

```sh
pnpm --filter @openuji/example-nextcloud-filesharing stack:reset
```
