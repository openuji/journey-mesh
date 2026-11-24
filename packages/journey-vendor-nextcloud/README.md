# Nextcloud vendor integration

`@openuji/journey-vendor-nextcloud` groups everything Journey Mesh needs to run
journeys against Nextcloud. It implements platform contracts and uses shared
helpers; it contains no browser or device automation.

| Entry | Kind | Source |
| --- | --- | --- |
| `web/plugin` | client for `webClientContract` | `src/web/` |
| `android/plugin` | client for `androidClientContract` | `src/android/` |
| `federated-sharing/plugin` | environment: fixtures and OCS/WebDAV effect checks | `src/environments/federated-sharing/` |
| `stack/service`, `stack-built/service` | a Nextcloud stack on [`journey-service-docker/compose`](../../docs/service-composition.md#compose-stacks-for-any-vendor) | `src/services/stack/` |
| `server-build/service` | a server image built from source | `src/services/` |
| `app-build/service` | an app image built from source | `src/services/` |
| `app-install/service` | installing a built app into a stack | `src/services/` |

The clients resolve bindings with `@openuji/journey-plugin/client`; the stack
adds only Nextcloud bootstrap (`occ`, apps, trusted domains, users) to the
generic Compose lifecycle. Any executor of a client's platform can run it, and
any executor observer attaches to the executor, not to this package.

[Service composition](../../docs/service-composition.md) shows how they connect.

## App build options

`app-build/service` builds an app from a source checkout in three stages:
1. `npm ci && npm run build` in `nodeImage`
2. `composer install --no-dev` in `composerImage`
3. copying the result into an image

| Option | Required | Meaning |
| --- | --- | --- |
| `directory` | yes | Where temporary build contexts are created |
| `image` | yes | Untagged image repository; the tag is derived from the source SHA and the recipe |
| `nodeImage` | yes | Node image, pinned by digest |
| `composerImage` | yes | Composer image, pinned by digest |
| `composerScripts` | no, default `false` | Run the app's composer scripts during `composer install` |
| `composerIgnorePlatformReqs` | no | Platform requirements to ignore while installing, for example `[ext-gd]` |

By default, composer runs with `--no-scripts`. Some apps generate code in their
scripts. Tables, for example, runs php-scoper in `post-install-cmd` to write
`lib/Vendor/` (`OCA\Tables\Vendor\…`), and the app fails at runtime without it.
Set `composerScripts: true` for such apps, the same way their own packaging runs
`composer install --no-dev`:

```yaml
tables-build:
  use: "@openuji/journey-vendor-nextcloud/app-build/service"
  inputs:
    source: { service: tables-source, output: source }
  options:
    directory: .runtime/builds
    image: journey-mesh/tables
    nodeImage: node:24.11.1-bookworm-slim@sha256:…
    composerImage: composer:2.8.12@sha256:…
    composerScripts: true
    composerIgnorePlatformReqs: [ext-gd]
```

`composerImage` only installs dependencies. The PHP extensions those dependencies
need at runtime come from the Nextcloud image. When the composer image lacks one,
name it in `composerIgnorePlatformReqs`. Tables, for example, locks a
PhpSpreadsheet that requires `ext-gd`. Each entry becomes
`--ignore-platform-req=<requirement>`, and only `php`, `php-64bit`, `ext-*` and
`lib-*` names are accepted.

The scripts run inside `composerImage`, so its PHP version must suit the app's
tools. The option changes the build recipe, and therefore the image tag. An
image built without scripts is never reused for a build with them.
`server-build/service` rejects the option.
