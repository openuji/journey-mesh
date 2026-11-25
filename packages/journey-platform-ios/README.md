# @openuji/journey-platform-ios

`@openuji/journey-platform-ios` holds the pure iOS contracts:

- `iosClientContract` (`@openuji/journey-platform-ios/client/v1`), the application and deep-link entry targets, and `IosJourneyClient`.
- `iosAppContract` (`@openuji/ios-app/v1`) and `IosAppBundle`.
- `iosDevicesContract` (`@openuji/ios-devices/v1`), `IosDevice`, and `IosDevices`.

It depends on no toolkit, service, executor, vendor, or observer. Reusable simulator and Xcode operations live in [`journey-toolkit-ios`](../journey-toolkit-ios/README.md); service plugins are in [`journey-service-ios`](../journey-service-ios/README.md).
