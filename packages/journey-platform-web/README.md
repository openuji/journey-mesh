# Web platform

`@openuji/journey-platform-web` is the contract between Web clients and Web
executors: `WebJourneyClient`, `WebEntryTarget`, `webEntryTarget()` and
`webClientContract` (`@openuji/journey-platform-web/client/v1`). A vendor's Web
client implements it; any Web executor, such as
[`journey-executor-playwright`](../journey-executor-playwright/README.md), can run
that client. The package executes nothing and depends on no browser, executor,
vendor or observer.
