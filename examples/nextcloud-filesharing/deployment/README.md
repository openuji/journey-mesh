# Nextcloud federation infrastructure

The example declares its deployment in [`../mesh.yaml`](../mesh.yaml) using
`@openuji/journey-vendor-nextcloud/stack/service`, the same packaged infrastructure
used by `journey-checks` jobs. This directory contains Compose, database
initialization, source environment defaults, and the scenario fixture.

| Test service | Default Compose project | Canonical host | Alice / Bob ports |
| --- | --- | --- | --- |
| `web-stack` | `journey-mesh-filesharing-web` | `host.docker.internal` | 18081 / 18082 |
| `android-stack` | `journey-mesh-filesharing-android` | `NEXTCLOUD_ANDROID_STACK_HOST` | 18083 / 18084 |

## Run

From `examples/nextcloud-filesharing`:

```sh
pnpm e2e

# Native: set this to a host IPv4 reachable by browser, containers, and emulator.
stack_interface=$(route -n get default | awk '/interface:/{print $2}')
export NEXTCLOUD_ANDROID_STACK_HOST="$(ipconfig getifaddr "$stack_interface")"
pnpm android:up
pnpm appium:up
pnpm e2e:android
```

`journey-mesh test mesh.yaml --test <id>` preflights the selected test, starts
its stack, verifies the installed Nextcloud version and image identity,
provisions accounts and federation settings, and runs every profile. It removes
its stack's containers and volumes afterward, also after failure or cancellation.
The host records the stack's credential-free provenance and identity evidence
under `test-results/`. Validation parses components without starting services.

The federated-sharing environment owns fixture setup, effect checks, and fixture
cleanup per profile. No separate stack preparation or seeding command is needed.
Android and Appium remain independently managed by their packaged services.

## Configuration

`envFiles` reads `.env.example`, then optional `.env` in this directory; shell
values override both. `.runtime/android.env` and `.runtime/appium.env` supply
native runtime settings. Generated Nextcloud files are never configuration
inputs.

Set `NEXTCLOUD_ANDROID_STACK_HOST` explicitly in `.env` or the shell for native
tests. There is no discovery or default address. On macOS use your active
interface's IPv4; on Linux with the emulator use a reachable host address such as
Docker's default bridge gateway. CI exports that gateway before running the test.
After a network change, update the value before the next run. The native browser,
app, and containers all use the same canonical addresses.

The browser defaults to `host.docker.internal`. It must resolve on the host;
Linux may need `127.0.0.1 host.docker.internal` in `/etc/hosts`. Compose keeps
`host.docker.internal:host-gateway` inside the containers. That mapping does not
configure emulator DNS.

YAML contains the pinned Nextcloud image/version and these overridable defaults:

- `NEXTCLOUD_WEB_STACK_PROJECT`, `NEXTCLOUD_ANDROID_STACK_PROJECT`
- `NEXTCLOUD_WEB_STACK_HOST` (browser only)
- `NEXTCLOUD_WEB_ALICE_PORT`, `NEXTCLOUD_WEB_BOB_PORT`
- `NEXTCLOUD_ANDROID_ALICE_PORT`, `NEXTCLOUD_ANDROID_BOB_PORT`

Shared account and database defaults use the `NEXTCLOUD_ALICE_*`,
`NEXTCLOUD_BOB_*`, `NEXTCLOUD_ADMIN_*`, and `POSTGRES_*` values in `.env.example`.
YAML anchors share account and URL values across the stack, drivers, and fixture
environment. Changing a host or port also changes the federated recipient.
Projects and published ports must be distinct across concurrent deployments.

The service writes its private Compose environment to
`.runtime/stacks/<web|android>/stack.env` relative to the example. This file is
owned by the package runtime and is not read back by the mesh. To change image
pins, Compose files, or enabled apps, edit the service options in YAML.

## Migrate persistent stacks

The previous example scripts managed persistent projects named
`ujg-nextcloud-federation` and `ujg-nextcloud-federation-android`. The new managed
projects have different names and never adopt or delete those deployments.
Stop any old containers using ports 18081–18084 before running the new tests.

To retain the old volumes, stop the old deployment in Docker Desktop. To inspect
its containers from the CLI:

```sh
docker ps --filter label=com.docker.compose.project=ujg-nextcloud-federation \
  --format '{{.ID}} {{.Names}}'
docker ps --filter label=com.docker.compose.project=ujg-nextcloud-federation-android \
  --format '{{.ID}} {{.Names}}'
```

Use the actual project names if they were overridden. Stop only the selected
old containers with `docker stop <container-id> ...`; this preserves their
volumes. The mesh ignores old `compose.env`, `test.env`, `deployment.json`, and
shared `.runtime/stack.env` files.

The packaged service requires a fresh managed project. Existing containers or
volumes under a selected managed project cause startup to fail without deleting
them; choose an unused project name or explicitly remove that project's test
resources before retrying. Reports, SDKs, APKs, Appium caches, and unrelated
deployments are retained by normal test cleanup.
