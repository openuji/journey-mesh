# Nextcloud Federation Example Stack

Local infrastructure for the YAML-defined federated file-sharing journey tests.

## Topology

- Alice: `http://host.docker.internal:18081`
- Bob: `http://host.docker.internal:18082`
- Federated recipient: `bob@http://host.docker.internal:18082`

The instances use the same host name with separate published ports. Compose maps `host.docker.internal` inside the containers with `extra_hosts`; your host OS/browser may still need `/etc/hosts` entry `127.0.0.1 host.docker.internal`.

Do not switch these URLs to `localhost` unless you also update the federation setup; container-to-container federated requests can break.

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

The Journey Mesh HTML index links the functional evidence, axe path reports, and source screenshots under `test-results/<test-id>/`. Tests and their adapters are declared in [`journey.yaml`](../journey.yaml).

## Reset

```sh
pnpm --filter @openuji/example-nextcloud-filesharing stack:reset
```
