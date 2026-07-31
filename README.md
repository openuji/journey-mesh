# journey-mesh

[![CI](https://github.com/openuji/journey-mesh/actions/workflows/ci.yml/badge.svg?branch=main&event=push)](https://github.com/openuji/journey-mesh/actions/workflows/ci.yml)
[![Nextcloud Filesharing CI](https://github.com/openuji/journey-mesh/actions/workflows/example-ci.yml/badge.svg?event=pull_request)](https://github.com/openuji/journey-mesh/actions/workflows/example-ci.yml)


Model-driven execution and validation of cross-service user journeys, with pluggable model bindings, automation adapters, application drivers, interaction profiles, and evidence observers.


## Nextcloud Example

See [`examples/nextcloud-filesharing/README.md`](examples/nextcloud-filesharing/README.md) for the concise architecture flow, sample e2e output, and artifact links.

The Nextcloud file-sharing example owns its own scripts:

```bash
pnpm --filter @openuji/example-nextcloud-filesharing stack:up
pnpm --filter @openuji/example-nextcloud-filesharing stack:provision
pnpm --filter @openuji/example-nextcloud-filesharing stack:seed
pnpm --filter @openuji/example-nextcloud-filesharing e2e
pnpm --filter @openuji/example-nextcloud-filesharing e2e:report
```

The example loads `examples/nextcloud-filesharing/ujg/filesharing.ujg.jsonld`, configures the generic Playwright adapter and Nextcloud driver, runs `defaultProfile()` and `keyboardOnlyProfile()`, and attaches normalized evidence JSON to the Playwright test result. Set `UJG_EVIDENCE_STDOUT=1` to also print the full evidence JSON.

## Roadmap

Journey Mesh currently demonstrates model-driven execution of a federated
Nextcloud file-sharing journey through the generic runner, UJG binding,
Playwright adapter, Nextcloud driver, default and keyboard-only profiles, and
axe accessibility observer.

The proposed roadmap adds multipath-aware execution, stable extension contracts,
Fediversity/Nix post-deployment and upgrade validation, expanded Nextcloud
scenarios, a Mastodon driver, runtime reliability evidence, and improved reporting and documentation.

- [Technical roadmap](docs/roadmap.md)
- [Public roadmap issue](https://github.com/openuji/journey-mesh/issues/11)

The roadmap is proposed and is not a delivery commitment.

## License

MIT. See [`LICENSE`](LICENSE).
