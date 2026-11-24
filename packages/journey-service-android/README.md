# Android services

`@openuji/journey-service-android` provides the Android infrastructure service
plugins, built on [`journey-toolkit-android`](../journey-toolkit-android/README.md):

| Entry | Inputs | Outputs |
| --- | --- | --- |
| `emulator/service` | none | `devices`: booted emulators by name, with persistent ownership |
| `apk-build/service` | `source`, optional `sibling` | `apk`, `identity`: a Gradle-built APK, cached by source and toolchain |

The `journey-service-android` bin checks a suite's Android configuration in CI:

```sh
journey-service-android android check mesh.yaml [--service <key>] [--require-locale <locale>] [--github-output]
```

See [service composition](../../docs/service-composition.md#native-subjects).
