# @openuji/journey-service-ios

`@openuji/journey-service-ios` provides the iOS infrastructure service plugins, built on [`journey-toolkit-ios`](../journey-toolkit-ios/README.md):

- `@openuji/journey-service-ios/simulator/service`: provisions and manages single or pooled iOS Simulators, outputting `iosDevicesContract`.
- `@openuji/journey-service-ios/app-build/service`: builds a simulator `.app` bundle from a Git source checkout with `xcodebuild`, caching immutable generations and outputting `iosAppContract` and `sourceIdentityContract`.

The `journey-service-ios` bin checks a suite's iOS configuration in CI:

```sh
journey-service-ios ios check mesh.yaml [--service <key>] [--require-locale <locale>] [--github-output]
```
