# Docker services

`@openuji/journey-service-docker` holds what any Docker Compose based service
shares:

- `./compose`: the Compose stack lifecycle (`startComposeStack`,
  `releaseComposeStack`, `validateComposeConfiguration`). A vendor's stack service
  supplies `prepare` and `bootstrap` hooks; the lifecycle owns the env file,
  project freshness, ownership records, `up`/`down` and the lifecycle publications.
- `./observations`: the `composeLifecycle` runtime observation topic that
  [`journey-observer-docker`](../journey-observer-docker) subscribes to.

See [service composition](../../docs/service-composition.md#compose-stacks-for-any-vendor).
