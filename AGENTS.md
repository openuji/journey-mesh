# Working in this repository

Read [docs/architecture.md](docs/architecture.md) first. It holds the layers,
roles and invariants; the code is the reference for everything else.

Before you finish a change, run:

```sh
pnpm build && pnpm typecheck && pnpm lint && pnpm test
```

## Documentation

Keep the documentation to architecture and invariants. Do not add markdown that
restates APIs, options, file formats or CLI usage: that belongs in code (types,
the configuration schema, JSDoc, `--help`). When you change an invariant, change
`docs/architecture.md` and the check that enforces it in the same commit.

## Command-line contract

Third-party tools, such as agent skills, run these CLIs and rely on what they
print. The contract is the `--help` text, the exit codes, the first line of an
error, and the stdout lines the help documents (for example `PASS <id>` and
`Run record: <path>`).

| CLI | Declaration | Contract |
| --- | --- | --- |
| `journey-mesh` | [`packages/journey-cli/src/index.ts`](packages/journey-cli/src/index.ts) | [`contract/journey-mesh.help.txt`](packages/journey-cli/contract/journey-mesh.help.txt) |
| `journey-executor-appium` | [`packages/journey-executor-appium/src/runtime/cli.ts`](packages/journey-executor-appium/src/runtime/cli.ts) | [`contract/journey-executor-appium.help.txt`](packages/journey-executor-appium/contract/journey-executor-appium.help.txt) |
| `journey-service-android` | [`packages/journey-service-android/src/cli.ts`](packages/journey-service-android/src/cli.ts) | [`contract/journey-service-android.help.txt`](packages/journey-service-android/contract/journey-service-android.help.txt) |
| report renderer scripts | [`apps/report-renderer/cli/args.ts`](apps/report-renderer/cli/args.ts) | [`contract/report-renderer.help.txt`](apps/report-renderer/contract/report-renderer.help.txt) |
| finding reporter scripts | [`apps/finding-reporter/cli/args.ts`](apps/finding-reporter/cli/args.ts) | [`contract/finding-reporter.help.txt`](apps/finding-reporter/contract/finding-reporter.help.txt) |

Each CLI declares its commands once as a `CliDefinition` from
`@openuji/journey-plugin/cli`. Parsing, defaults, usage lines, help and argument
errors are derived from it. Do not parse arguments or write help text by hand,
and keep defaults the CLI owns in the declaration, not in code.

To change the contract:

1. Change the declaration and the behaviour together.
2. Run `UPDATE_CLI_CONTRACT=1 pnpm test` and review the diff of the contract
   files. A diff you did not intend is a bug to fix, not a snapshot to accept.
3. In the package's `test/contract.test.ts`, test every promise the help makes:
   defaults, printed lines and exit codes.
4. Name the contract change in the pull request description. Removing or
   renaming a command, option, printed line or exit code breaks third-party
   tools.

Never edit a contract file, or rerun `UPDATE_CLI_CONTRACT`, just to make a
failing test pass. A new bin needs a contract file and a test that checks it;
`pnpm lint` (rule 12) fails without them.
