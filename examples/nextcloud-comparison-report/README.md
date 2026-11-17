# Nextcloud acceptance comparison

A standalone static report comparing Nextcloud 34.0.2 and server PR #66147. It
covers default and keyboard activation profiles for accepting `report.pdf` from
a remote instance. Decline, folders, Android, and the main website are excluded.

From the repository root, with Docker running:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @openuji/example-nextcloud-filesharing comparison:run
pnpm --filter @openuji/nextcloud-comparison-report dev
```

The comparison command builds the pinned PR server and Notifications app, starts
isolated Alice/Bob stacks, verifies their versions, runs both profiles against
both variants, collects evidence, and builds the report into `dist/`. The initial
source build takes several minutes and is cached by Docker. Ports are 18081/18082
and 18181/18182; networks are 10.253.34.0/24 and 10.253.36.0/24. The manifest in the
file-sharing example owns these pins. Adjust subnets there if they overlap local
networks. Comparison URLs retain `host.docker.internal` as their canonical host;
LAN host discovery is reserved for device-enabled runs.

Each invocation retains timestamped evidence under
`examples/nextcloud-filesharing/test-results/comparison/`. The `latest` file selects
the run used for replay. Failed journeys still generate reports and return a
nonzero exit status. Missing measurements remain unknown.

The tested JSON-LD/YAML models and observer plan are saved with each run. Replay
uses these snapshots, including pure metric derivation, rather than current model
files. See [the initial findings and ticket draft](../nextcloud-filesharing/comparison/findings.md).

```sh
# Rebuild from the last run's saved evidence, without browser or stack access.
pnpm --filter @openuji/example-nextcloud-filesharing comparison:report

# Reconcile running containers and configuration without deleting data volumes.
pnpm --filter @openuji/example-nextcloud-filesharing comparison:prepare

# Delete only the dedicated comparison services and their data volumes.
pnpm --filter @openuji/example-nextcloud-filesharing comparison:down
```

## Measurement definitions

Both journeys begin at All files after authentication and share creation. Fixture
setup resets Bob's Shares disclosure to collapsed before each profile.

- **Input actions:** successful input-bearing recipient transitions between arrival
  and the verified final state. Setup, scans, assertions, and automatic continuations
  are excluded.
- **Actions to acceptance:** a verified prefix ending at acceptance and its service
  effect check. It remains measurable if a later UI state fails.
- **Navigation before/after acceptance:** successful inputs classified by graph
  references in example configuration. These describe the modeled path.
- **Initial visibility:** the acceptance locator is uniquely present and visible
  at arrival. Viewport presence additionally requires its complete bounding box
  inside the fixed 1440 × 1000 viewport. This is a DOM observation, rather than a
  human discoverability score or an occlusion test.
- **Automatic reveal:** the final state is verified with no input after acceptance.
  The PR model checks the file row; the baseline navigates to Shares.
- **Axe totals:** page-scan violations and incomplete checks across audited states.
  Repeated findings across scans are counted repeatedly. Per-state page and scoped
  results remain available in the diagram and original reports.

The PR identifies itself as Nextcloud 36 development. Differences from 34.0.2 can
include changes beyond the PR. A pinned Notifications app restores the normal
notification flow that a bare Git checkout replaces with a legacy blocking modal.

## Composition and purity

The example supplies deployment and measurement selections. Existing model,
driver, adapter, profile, and environment plugins own execution. The optional UX
observer captures detached facts; pure functions derive metrics and report data
from explicit inputs. Reports preserve `RunResult`. Rendering consumes exported
data and versioned authoring models. A pinned renderer snapshot removes the
private repository and absolute local path from the build.

The report preserves the demo's paper/ink palette and Arial typography. The
typeface is a deliberate continuity choice for this report.

One baseline disclosure uses an explicit `CustomLocator`: Nextcloud names both
Shares and Folder tree disclosures “Open menu.” Its namespaced CSS stays in the
example model. The compiler preserves opaque extensions; the Playwright adapter
interprets its own namespace and rejects unsupported namespaces in preflight.

## Publish with GitHub Actions

Pages is configured to use GitHub Actions for this repository. After pushing these
changes to the default branch, run **Nextcloud acceptance comparison** from the
Actions tab. For forks, first select **Settings → Pages → Source → GitHub Actions**.
The workflow retains evidence for 90 days and deploys the static report. The
publish summary contains the ticket-ready link; version/profile selections are
shareable query parameters. Ticket posting is manual.

Test failures remain failures in the final workflow status while their diagnostic
page is published. The page records generation time and workflow URL. Pages shows
the latest published report; workflow artifacts retain the corresponding evidence.
