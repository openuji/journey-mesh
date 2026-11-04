# Native Nextcloud gate captures

Captured from the published `nextcloud-350000290.apk` (Nextcloud 35.0.2), using
Appium 3.9.0 / UiAutomator2 8.7.3 on a dedicated temporary Pixel 6 emulator:
API 37 Google APIs arm64, 1080 × 2400, 420 dpi, English UI.
The API 35 x86_64 image in the runtime manifest is the separate CI baseline.

- `pending-offer.xml`: Alice's modeled web offer, before Bob's native Accept tap.
- `accepted-offer.xml`: Notifications after that native tap; the offer is absent.
- `navigation-sidebar.xml`: the native sidebar and its Shared navigation item.
- `shared-file.xml`: native Shared view displaying `report.pdf` after acceptance.

The existing OCS/WebDAV effect verifier independently confirmed the accepted
mounted file. These are real captured hierarchies, not generated native stand-ins.
Login screens and credentials are excluded. The literal `{user}` in the notification
subject is emitted by this APK. Dates, hierarchy indexes, and node bounds belong
to this captured run; tests inspect the relevant controls and semantic milestones.
