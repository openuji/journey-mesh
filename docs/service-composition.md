# Compose a runnable subject from services

The UJG model defines the journey's states, transitions, commands, input modalities,
and effects. Services prepare the system it runs against. They do not supply an
alternative test script.

Declare each repository/PR once in a Git source service. Pass its output through
the build and installation services using `inputs`:

```yaml
target: { service: app-install, output: identity }
services:
  source:
    use: "@openuji/journey-service-git/plugin"
    options:
      repository: https://github.com/nextcloud/collectives.git
      pullRequest: 2945
      directory: .tmp/source
  app-build:
    use: "@openuji/journey-driver-nextcloud/app-build/service"
    inputs:
      source: { service: source, output: source }
    options:
      directory: .runtime/build
      image: journey/example-app
      nodeImage: ${NODE_BUILD_IMAGE}
      composerImage: ${COMPOSER_BUILD_IMAGE}
  app-install:
    use: "@openuji/journey-driver-nextcloud/app-install/service"
    inputs:
      app: { service: app-build, output: app }
      stack: { service: stack, output: stack }
    options:
      directory: .runtime/install
      services: [nextcloud]
      enable: true
```

The example fragment requires a `stack` service, ordinary model/adapter/profile
configuration, and digest-pinned build-image environment values. A test requires
`services: [app-install]`; its dependency closure starts once before profiles run.

An input reference implies a dependency. `dependsOn` adds ordering where no output
is consumed. Unknown references, cycles, absent required inputs, and incompatible
contracts fail preflight. `validate` constructs components but never runs their
`up` methods. Failed/partially started services are cleaned up in reverse order.

Each source resolves the PR head once per run. Every dependent receives that same
checkout identity. Re-running unchanged configuration fetches the new head. A
`sha` instead of `pullRequest` selects an exact commit. Dirty checkouts and changed
repository origins are rejected. Source directories remain pristine; builds work
on temporary copies and may reuse Docker's cache.

## Supplied routines

| Plugin | Inputs | Outputs |
| --- | --- | --- |
| `journey-service-git/plugin` | none | `source`, `identity` |
| `journey-driver-nextcloud/app-build/service` | `source` | `app` |
| `journey-driver-nextcloud/server-build/service` | `source` | `image` |
| `journey-driver-nextcloud/stack/service` | none | `stack` |
| `journey-driver-nextcloud/stack-built/service` | `image` | `stack`, `identity` |
| `journey-driver-nextcloud/app-install/service` | `app`, `stack` | `identity` |

All package names in the table have the `@openuji/` prefix. App builds use the
app's `appinfo/info.xml` ID/version and its Node/Composer build conventions. The
Node and Composer images are required, digest-pinned options. Server builds also
require a pinned `runtimeImage`; the server version comes from `version.php`.
No routine special-cases a repository name, app name, or PR number.

The ordinary stack supplies a released image with `image` and `expectedVersion`.
Optional `systemConfig` declares Nextcloud system settings as strings, booleans,
or safe integers. They are applied with their explicit scalar type during stack
provisioning; job-specific fixture settings belong here rather than in routines.
A built stack consumes its image and version from `inputs.image`; it rejects a
second image/build/version declaration. App installation copies artifacts before
enabling them. Existing apps are replaced at the path Nextcloud resolves; new apps
go into `custom_apps`. Replacements remove obsolete files, and installation verifies
the resolved app path, SHA marker, and version on every selected instance. A fresh
managed stack owns its containers and volumes; teardown removes those resources,
not unrelated running stacks or shared images.

## Plugin contract

Service plugins may declare named `inputs` and `outputs` as maps of `Contract`
objects. The host compares contract IDs during preparation. `up({ signal, inputs })`
returns an output record; missing declared outputs fail startup. Old services can
still return `void`. Only runtime consumers receive the outputs: working paths
and private stack configuration are not serialized into the result bundle.

`target` must reference a source-identity output of a selected service. The host
stores only `repository`, `sourceSha`, optional `pullRequest`, and optional
`version` in `bundle.target`. Select installation identity to describe verified
installed code, rather than merely a fetched checkout. Service `provenance()`
remains independent and must not return secrets or absolute working paths.

For meshes with composed inputs, `services up --service NAME` includes that
service's dependencies and cleans up attempted services on failure. Legacy meshes
without inputs retain the previous single-service CLI selection behavior.
