# Nextcloud Federation Example Stack

Local infrastructure for the YAML-defined federated file-sharing journey tests.

## Topology

- Alice: `http://<runtime-host>:18081`
- Bob: `http://<runtime-host>:18082`
- Federated recipient: `bob@http://<runtime-host>:18082`

The instances use one canonical host with separate published ports. `stack:up`
discovers a host IPv4 address reachable from the host browser, containers, and
Android, then writes the effective values to `../.runtime/stack.env`. On macOS
this is a LAN address; on Linux it is normally the Docker bridge gateway.
Override discovery with `NEXTCLOUD_STACK_HOST=<IPv4>`.

Do not replace the generated URLs with `localhost` or `10.0.2.2`: those names do
not identify the same host from every participant in the federated journey.

## Start

From the repository root:

```sh
pnpm --filter @openuji/example-nextcloud-filesharing stack:up
pnpm --filter @openuji/example-nextcloud-filesharing stack:provision
pnpm --filter @openuji/example-nextcloud-filesharing stack:seed
```

The scripts use `deployment/.env` when present and fall back to
`deployment/.env.example`. Literal `host.docker.internal` values are replaced
with the discovered runtime host. `NEXTCLOUD_STACK_ENV_FILE` can provide a
complete source environment; `stack:up` materializes it into the generated
runtime file so later YAML commands need no shell export.

## Run

```sh
pnpm exec journey-mesh test examples/nextcloud-filesharing/mesh.yaml --test browser-sharing
```

The Journey Mesh HTML index links the functional evidence, axe path reports, and source screenshots under `test-results/<test-id>/`. Tests and their adapters are declared in [`mesh.yaml`](../mesh.yaml).

## Reset

```sh
pnpm --filter @openuji/example-nextcloud-filesharing stack:reset
```

Reset removes the containers, volumes, and generated stack runtime environment.
