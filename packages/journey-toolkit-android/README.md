# Android toolkit

`@openuji/journey-toolkit-android` provides reusable Android infrastructure
operations: SDK and JDK discovery (`findSdk`, `findJdk`, `hostToolchain`), ADB
and emulator control (`androidUp`, `releaseAndroidDevice`), device pool parsing,
Gradle invocation, APK inspection (`parseBadging`) and installation checks
(`./installation`: `verifyApkChecksum`, `verifyInstalledApk`). It declares no
plugin and knows no vendor or executor. Service plugins and the Appium executor
use it.
