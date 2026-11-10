# Separate infrastructure lifecycles from YAML journey execution

## Summary

Give each layer one responsibility:

- `stack:*` manages Nextcloud.
- `android:*` manages the emulator and APK.
- `appium:*` manages Appium.
- `journey-mesh test` only reads `journey.yaml` and selects a test.

Remove the cross-layer `android:local` launcher.

## Implementation Changes

### Lifecycle commands

- Keep backend preparation explicit:

  ```sh
  pnpm stack:up
  pnpm stack:provision
  pnpm stack:seed
  ```

- Add:

  ```sh
  pnpm android:up
  pnpm android:down
  pnpm appium:up
  pnpm appium:down
  ```

- `stack:up` starts only Docker services. The stack scripts discover a host address reachable from browsers, containers, and Android, then persist the effective configuration in `.runtime/stack.env`. Provision and seed remain separate.
- `android:up` installs missing pinned SDK components, creates or validates the API 35 Pixel 6 AVD, downloads the pinned Nextcloud APK, boots the emulator, and writes its UDID to `.runtime/android.env`. Use the official [Android SDK package tooling](https://developer.android.com/tools/agents/android-cli/commands/sdk_install).
- `android:down` stops only that managed AVD and clears stale runtime state; it does not delete the AVD or APK.
- `appium:up` requires the managed emulator to be online, installs the pinned UiAutomator2 driver into the isolated Appium home, starts Appium, waits for readiness, and writes its endpoint to `.runtime/appium.env`.
- `appium:down` stops only the recorded Appium process and cleans stale state.
- Add the three generated runtime env files to `journey.yaml` as optional inputs. Process environment values retain highest precedence, and browser-only selection continues to work without Android/Appium state.
- Remove `android:local`, its implementation, and its cross-layer lifecycle tests. Keep `run-ci.sh` as a CI-only orchestration helper.

### Website

Replace the “complete flow” claim with two independently copyable YAML commands:

```sh
pnpm exec journey-mesh test examples/nextcloud-filesharing/journey.yaml --test browser-sharing
```

```sh
pnpm exec journey-mesh test examples/nextcloud-filesharing/journey.yaml --test native-recipient-sharing
```

Label them with their literal test IDs, explain the browser/browser versus browser/Android distinction, and link setup instructions directly to the example README. Do not include stack, emulator, or Appium details in these run commands.

### Documentation

Restructure the example README into:

1. One-time repository prerequisites.
2. Backend lifecycle: `stack:up`, `stack:provision`, `stack:seed`.
3. Optional native runtime: `android:up`, then `appium:up`.
4. YAML-only test commands for either test ID.
5. Shutdown in reverse order.

Document supported macOS/Linux architectures, first-run downloads, Android license prompts, Linux KVM, generated runtime files, logs, and non-destructive shutdown behavior.

## Test Plan

- Test stack runtime URL generation and reuse across up/provision/seed.
- Test fresh and idempotent Android provisioning, host-native image selection, incompatible AVD rejection, readiness, and targeted shutdown.
- Test Appium startup, driver installation, readiness, stale PID handling, port conflicts, and targeted shutdown.
- Verify both generic YAML commands work without manual environment exports.
- Verify `browser-sharing` validates and runs when Android/Appium runtime files are absent.
- Preserve CI Android coverage and runtime-pin validation.
- Run example tests plus the complete web check/lint/build suite.
- Visually verify the two website command blocks on desktop and mobile, including independent clipboard feedback.

## Assumptions

- Backend provision and seed remain explicit operations.
- `android:up` does not start Appium, Nextcloud, or tests.
- `appium:up` does not start Nextcloud or execute tests.
- Removing `android:local` is acceptable without a deprecation period.
- No JourneyMesh library API or YAML schema change is required.
