# Nextcloud Federation Example Stack

Local infrastructure for executing the federated file-sharing UJG journey with Playwright.

## Topology

- Alice: `http://host.docker.internal:18081`
- Bob: `http://host.docker.internal:18082`
- Federated recipient: `bob@http://host.docker.internal:18082`

The instances use the same host name with separate published ports. Compose maps `host.docker.internal` inside the containers with `extra_hosts`; your host OS/browser may still need `/etc/hosts` entry `127.0.0.1 host.docker.internal`.

Do not switch these URLs to `localhost` unless you also update the federation setup; container-to-container federated requests can break.

## Start

From the repository root:

```sh
pnpm stack:up
pnpm stack:provision
pnpm stack:seed
```

The scripts use `deployment/.env` when present and fall back to `deployment/.env.example`.

## Run

```sh
pnpm e2e
pnpm e2e:headed
pnpm e2e:report
```

The Playwright report shows the attached `ujg-evidence.json` and Axe path reports. Axe source screenshots are attached by the Axe observer for reviewed state pages.

## Reset

```sh
pnpm --filter @openuji/example-nextcloud-filesharing stack:reset
```
