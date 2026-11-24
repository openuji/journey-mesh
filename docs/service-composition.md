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
    use: "@openuji/journey-vendor-nextcloud/app-build/service"
    inputs:
      source: { service: source, output: source }
    options:
      directory: .runtime/build
      image: journey/example-app
      nodeImage: ${NODE_BUILD_IMAGE}
      composerImage: ${COMPOSER_BUILD_IMAGE}
  app-install:
    use: "@openuji/journey-vendor-nextcloud/app-install/service"
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
contracts fail preflight. `validate` parses settings and validates operations without
starting services or constructing runtime adapters and observers. All runtime tests
are constructed after service startup and before the first fixture is changed.
Producers compensate partial acquisitions before throwing; the host releases
returned handles in reverse order, including after invalid outputs or cancellation.

Each source resolves the PR head once per run. Every dependent receives that same
checkout identity. Re-running unchanged configuration fetches the new head. A
`sha` instead of `pullRequest` selects an exact commit. Dirty checkouts and changed
repository origins are rejected. Source directories remain pristine; builds work
on temporary copies and may reuse Docker's cache.

## Supplied routines

| Plugin | Inputs | Outputs |
| --- | --- | --- |
| `journey-service-git/plugin` | none | `source`, `identity` |
| `journey-vendor-nextcloud/app-build/service` | `source` | `app` |
| `journey-vendor-nextcloud/server-build/service` | `source` | `image` |
| `journey-vendor-nextcloud/stack/service` | none | `stack` |
| `journey-vendor-nextcloud/stack-built/service` | `image` | `stack`, `identity` |
| `journey-vendor-nextcloud/app-install/service` | `app`, `stack` | `identity` |
| `journey-platform-android/apk-build/service` | `source`, optional `sibling` | `apk`, `identity` |
| `journey-platform-android/service` | none | `devices` |
| `journey-executor-appium/service` | optional `devices` | `server` |

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

## Native subjects

An APK build copies its `source` checkout, and an optional `sibling` checkout next
to it, so a composite build (`includeBuild("../library")`) finds the library at the
relative path the source declares. `sourceDirectory` and `siblingDirectory` name the
two directories. The host's Android SDK and a JDK of the pinned `javaVersion`
(`JAVA_HOME`) run the source's Gradle wrapper. `toolchains` lists further JDK
majors the build's Gradle toolchains need; each comes from `JAVA_HOME_<major>_X64`,
`JAVA_HOME_<major>_ARM64` (as `actions/setup-java` sets them) or, on macOS,
`java_home`, and Gradle neither auto-detects nor downloads others. The APK's
package, version code and version name come from the built file. The versioned
cache key includes repository/head pairs, recipe/layout options and fingerprints
of resolved JDK and build tools. Atomic publication creates a new immutable APK
generation; rebuilding never deletes a generation held by an execution. Cache
records retain historical build identities separately from the current PR selection.

Build provenance distinguishes configured JDK majors, resolved installations, and
observed Gradle/JVM versions. An injected init script records the actual Gradle
runtime and compilers of executed `JavaCompile` tasks, including composite builds.
Unexecuted and unsupported task toolchains remain unknown. Cache hits carry the
historical observations with `cache.reused: true`; they are not new observations
or a claim of a hermetic, byte-reproducible build.

The Android service boots one device from a top-level `avd`, or several named
`devices` sharing the same pins. `reversePorts` lets each device reach host ports
as its own `localhost`, so a local stack can use one base URL for host clients
and devices. The Appium service checks its `devices` input and outputs its
`server`. The Appium adapter's optional `application`, `server` and `devices`
inputs replace the pinned APK download, the endpoint and per-touchpoint UDIDs:

```yaml
executors:
  android:
    use: "@openuji/journey-executor-appium/plugin"
    inputs:
      application: { service: app-build, output: apk }
      server: { service: appium, output: server }
      devices: { service: devices, output: devices }
    options:
      application: { package: com.example.client, activity: com.example.MainActivity }
      devices:
        urn:touchpoint:alice-phone: { device: alice }
        urn:touchpoint:bob-phone: { device: bob }
```

## Plugin contract

Service and adapter plugins declare `inputs` and `optionalInputs` as contract maps.
The typed helpers infer a plain `ResolvedInputs<Required, Optional>` constructor
record from those declarations. The host checks references and contract IDs during
preparation, then supplies a deeply frozen snapshot in `create` dependencies:

```ts
create(settings, context, { inputs }) {
  return {
    name: "example",
    async start({ signal }) {
      const resource = await acquire(settings, inputs.source, signal);
      try {
        return startedService({ value: resource.value }, resource.identity,
          () => resource.release());
      } catch (error) {
        await resource.release();
        throw error;
      }
    }
  };
}
```

`parse(options, configuration, metadata)` receives configured input names in
`metadata.names`, never input values, an evidence store, or a runtime accessor.
Adapter `validateOperations(settings, configuration, { driver })` performs pure
operation checks before services start. Drivers and observers have no input
accessor or input dependency record. Prepared suites retain configuration, compiled
plans and component recipes. Every execution receives new runtime instances,
resolved inputs and evidence stores.

A service's `start({ signal })` returns a `StartedService` with `outputs`, an
optional provenance snapshot, and `release()`. `startedService` freezes output
and provenance snapshots. There is no `up`, `down`, or mutable `provenance()`
getter. The host registers a lease before validating outputs, so output validation
cannot strand a successful acquisition. A service that throws before returning
must compensate its own partial acquisition.

Automatic release stops only acquired resources. Android distinguishes owned and
borrowed emulators, records only reverse mappings it added, and preserves existing
mappings. Legacy env files are published/restored at the service boundary. Explicit
CLI shutdown uses `stopConfigured(context)` and configuration/service-scoped
ownership records, without parsing input-dependent settings or inventing input
values. Both `services up --service NAME` and `services down --service NAME` include
the dependency closure. This replaces the former single-service selection rule.
SIGINT/SIGTERM abort startup; owned subprocess groups receive TERM, then KILL after
five seconds, with another bounded wait. Cleanup failures remain visible.

## Observe a test run's infrastructure

Runtime observers subscribe before service allocation and remain active through
cleanup, including compensation after partial startup failure. Resource owners
publish lifecycle events and await subscribers before deleting owned resources;
they do not contain log selection, diagnostic commands, or capture policy.

For example, configure the independent Docker observer at suite level:

```yaml
runtimeObserverTimeoutMs: 30000
runtimeObservers:
  - use: "@openuji/journey-observer-docker/plugin"
    options:
      containerLogs: true
      tail: 2000
      timeoutMs: 10000
      files:
        - name: application
          path: /var/log/example/application.log
```

File paths are explicit container paths. The observer captures each file on the
application services exposed by a Compose resource, as well as optional Compose
container output, before release. It requires no Nextcloud driver or stack.
Its artifacts live under `diagnostics/observer-<index>/` in the run directory.
An unavailable file produces a capture-error artifact without hiding other
sources. Subscriber failures and deadlines are recorded separately in
`diagnostics/errors.json`; diagnostics do not decide the journey verdict.
`runtimeObserverTimeoutMs` (default 30 seconds) is the longest a resource owner
waits for any observer per event. An observer's own `timeoutMs` can shorten that
wait but never extend it.

Custom runtime observers export `defineRuntimeObserverPlugin({ kind:
"runtime-observer", parse, create })`. Their runtime instance implements
`start(source)` and `close()`. `source` is a frozen, subscribe-only port.
`source.subscribe(topic, callback, { name, timeoutMs })` returns an unsubscribe
function. The callback receives an immutable `{ topic, source, timestamp, value }`
observation and an independent abort signal for its deadline. Producers publish a
shared typed contract with `context.observations.publish(topic, value)`, the only
publishing channel; `JourneyService.start` receives just the abort signal. Outside
a suite run, such as `services up`, nothing subscribes and publishing does nothing.
Observers own their subscriptions and capture resources and release them in `close()`.

`target` references a source-identity output of a selected service. The host stores
only repository, head, optional PR and version there; runtime working paths and
private stack configuration stay out of the run record. Producers must keep secrets
and absolute paths out of provenance.

For service-built APKs, the builder verifies the signature and checksum. Appium
receives complete construction values and `noSign: true`. On managed local devices,
a typed ADB port pulls the installed base APK and compares its checksum, package,
version code and version name before the first modeled interaction. Each device's
comparison is an execution-scoped evidence file. A mismatch fails the execution;
session cleanup still runs. This requires a local Appium server and managed device
input. Pinned APK and remote-server configurations retain their existing behavior.
Entry navigation activates the application; it does not impose a cold restart.
