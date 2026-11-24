# Android platform

`@openuji/journey-platform-android` holds the pure Android contracts:
`AndroidJourneyClient` and `androidClientContract`
(`@openuji/journey-platform-android/client/v1`), the application and deep-link
entry targets, and the service output contracts `androidApkContract` and
`androidDevicesContract`. It depends on no SDK tooling, Appium, filesystem API
or vendor. Infrastructure operations are in
[`journey-toolkit-android`](../journey-toolkit-android/README.md); service
plugins are in [`journey-service-android`](../journey-service-android/README.md).
