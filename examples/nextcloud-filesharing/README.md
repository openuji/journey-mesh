# Nextcloud file sharing

[![Nextcloud Filesharing CI](https://github.com/openuji/journey-mesh/actions/workflows/example-ci.yml/badge.svg?event=pull_request)](https://github.com/openuji/journey-mesh/actions/workflows/example-ci.yml)

Alice shares a file with Bob across two federated Nextcloud instances. The same
journeys run in two compositions, defined in [`mesh.yaml`](mesh.yaml):

- `browser-sharing`: Alice and Bob in browsers (Playwright), with the default
  and keyboard-only profiles.
- `native-recipient-sharing`: Alice in a browser, Bob in the Nextcloud Android
  app (Appium), in one ordered plan.

Each test starts its own Nextcloud stacks and removes them afterward.

## Run

Build the workspace first (see the [root README](../../README.md#quick-start)).
Run from this directory:

```sh
pnpm e2e              # browser-sharing
pnpm e2e:report       # view the results on http://127.0.0.1:9323/
```

The native test also needs Android Studio with `ANDROID_HOME` set (KVM on
Linux), and a host IPv4 that the browser, the containers and the emulator can
all reach:

```sh
export NEXTCLOUD_ANDROID_STACK_HOST=192.168.1.10
pnpm appium:up        # boots the emulator and Appium; they stay up
pnpm e2e:android      # native-recipient-sharing
pnpm appium:down
```

Settings come from `mesh.yaml`, `deployment/.env.example` and an optional
`deployment/.env`; shell values win. `HEADLESS=false` shows the browsers.
`AXE_STRICT=true` and `ANDROID_A11Y_STRICT=true` make accessibility findings
fail the test. On Linux the browser test may need
`127.0.0.1 host.docker.internal` in `/etc/hosts`.

## Findings

The keyboard paths were modeled on Nextcloud 34.0.2:

- On the Files page, "Skip to main content" does not move the keyboard start
  point.
- Enter on a file row's "Sharing options" button does not open the sharing
  panel; Space does.
