# @openuji/journey-toolkit-ios

`@openuji/journey-toolkit-ios` provides reusable iOS infrastructure operations:

- CoreSimulator (`xcrun simctl`) runtime/device discovery, simulator creation, boot, and release.
- Simulator device pool parsing (`parseIosPool`).
- `.app` bundle `Info.plist` parsing and deterministic directory tree SHA-256 checksums.
- Installed simulator `.app` container verification (`./installation`).
- Xcode toolchain discovery, fingerprinting, and owned `xcodebuild` execution.

It declares no plugin and depends on no vendor, executor, or observer.
