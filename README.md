# journey-runner

First migration iteration for a model-driven UJG journey runner.

## Commands

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm example:nextcloud:dummy
```

`pnpm example:nextcloud:dummy` loads `examples/nextcloud-filesharing/ujg/filesharing.ujg.jsonld`, compiles it into a neutral plan, runs the plan once with `defaultProfile()` and once with `keyboardOnlyProfile()`, and prints normalized evidence JSON.
