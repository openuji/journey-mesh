# Moodle user tour viewport (MDL-90255)

A Moodle user tour shows an *orphaned* step (one without a target) in a fixed
position. Before MDL-90255, the dialog took document-relative offsets, so when
the previous step had scrolled the page to its target, the orphaned step
appeared outside the viewport. This example reproduces the bug with Journey
Mesh at the baseline commit and shows that the fix keeps the dialog in view.

| Source | Commit | Expected result |
| --- | --- | --- |
| Baseline | [`46c042e7`](https://github.com/zavalit/moodle/commit/46c042e7da65f8cb2ec7dc19f46566ce61a393e1) | The orphaned step's `inViewport` expectation fails, and `End tour` cannot be reached |
| Fix | [`b5b1675c`](https://github.com/zavalit/moodle/commit/b5b1675c7967fea1df5f1bd4961710c33a74ea43) | Every expectation passes and the tour ends |

Both runs use the same models, fixture, images and viewport (1024×768); only
`MOODLE_SOURCE_SHA` differs.

## What runs

The services build and install Moodle from source, then seed the tour:

1. `source` (`journey-service-git`) checks out the selected commit of
   `zavalit/moodle`.
2. `build` (`journey-vendor-moodle/build/service`) builds an image from it on
   `moodlehq/moodle-php-apache` with the locked Composer dependencies. It keeps
   the committed compiled JavaScript, including the tour code the fix changes.
3. `stack` (`journey-vendor-moodle/stack/service`) installs a fresh site on
   Docker Compose (`deployment/compose.yaml`, with PostgreSQL). It sets the
   dashboard as the home page and the Boost theme, and checks that the site
   serves the built release, source and `tour.min.js`.
4. `tours` (`journey-vendor-moodle/user-tours/service`) imports
   `fixtures/scrolled-tour.json` and disables every other tour. The fixture is
   the tour of the fix's Behat scenario: step 1 targets `#page-footer`, step 2 is
   orphaned. It applies to Site administration (`/admin/search.php`) instead of
   the dashboard; see [Why Site administration](#why-site-administration).

The journeys (`ujg/usertour.ujg.jsonld`, UJG 1.0 RC4) run in Chromium with the
pointer-first `default` profile:

- **Admin login** (setup phase): enter the username and password, then log in
  to the dashboard.
- **Scrolled tour**: open Site administration. The footer step is shown and
  has scrolled the page to the footer. Activate `Next (1/2)`, and the orphaned
  step is shown. Activate `End tour`, and the tour is gone.

The UX observer measures both tour dialogs without scrolling or focusing:

| Probe | Expectation | Why |
| --- | --- | --- |
| `footer-step` | `scrolled` | The bug needs the page to be scrolled; without it the run proves nothing |
| `orphaned-step` | `visible`, `inViewport` | The bug: the dialog is fully inside the viewport |

An unmet expectation is an error in the observer's output, so the test fails.
For `orphaned-step` the observer records the dialog's box, the viewport and the
scroll position (`*.ux-geometry.json`), and a screenshot of the viewport.

## Why Site administration

The bug moves the orphaned dialog up by the page's scroll distance. It leaves
the viewport only when the page has scrolled further than the dialog's centred
top, (768 − 190) / 2 = 289 px for this dialog. A fresh site's dashboard is
959 px tall, so the footer step scrolls it by 165 px. Measured on both commits
with the same checks as the upstream Behat steps, the baseline dialog moved from
y 289 to y 124 but stayed in view, and the bug did not reproduce. Site
administration is 1882 px tall, so the footer step scrolls it far enough that
the baseline dialog ends up entirely above the viewport.

The fixture's steps, the viewport and the checks are unchanged from the
upstream scenario; only the page the tour applies to differs.

## Run it

Prerequisites: Docker, and Chromium for Playwright
(`pnpm --filter @openuji/journey-executor-playwright exec playwright install chromium`).
The first run clones Moodle and builds the image, which takes several minutes;
later runs reuse the checkout in `.runtime/source` and the built image. If that
first clone fails with an HTTP/2 stream error (`curl 92 … CANCEL`), run it again
with git over HTTP/1.1:
`GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=http.version GIT_CONFIG_VALUE_0=HTTP/1.1`.

```sh
pnpm --filter @openuji/example-moodle-usertour-viewport e2e:fix        # test-results/fix
pnpm --filter @openuji/example-moodle-usertour-viewport e2e:baseline   # test-results/baseline
pnpm --filter @openuji/example-moodle-usertour-viewport compare        # test-results/comparison
pnpm --filter @openuji/report-renderer serve examples/moodle-usertour-viewport/test-results/baseline
```

`e2e:baseline` exits with status 1: the reproduced bug fails the test. A run
reproduces the bug when it reached the orphaned step with the page scrolled and
the observer reports the `orphaned-step` `inViewport` error. A failed build,
install or login proves nothing. On the baseline the observer reports, for
example:

```text
Probe orphaned-step in execution pointer-01: expected inViewport, but the target
(x 369, y -798, 287.046875×190) is not contained in the 1024×768 viewport
```

The page was scrolled by 1087 px, and the dialog sits 1087 px above its centred
position. The next step then fails too: the pointer cannot reach `End tour` in a
dialog above the viewport, so the user cannot end the tour. With the fix the
dialog is at y 289, centred, and the tour ends. `compare` exits nonzero as well,
because its baseline failed.

On every pull request, the `Moodle User Tour Viewport Example` job in
`.github/workflows/example-ci.yml` runs both commits. It requires the fix to
pass, the baseline to fail with exactly the orphaned step's `inViewport` error,
and the comparison to show the two outcomes.

`journey-mesh validate mesh.yaml` checks the configuration, models, plugins and
contracts without Docker; `pnpm test` in this directory runs that and checks
the fixture and image pins.

Settings you can override through the environment or `deployment/.env`:
`MOODLE_SOURCE_SHA`, `MOODLE_PORT` (default `18090`), `MOODLE_STACK_PROJECT`,
`MOODLE_ADMIN_PASSWORD`, `MOODLE_DB_PASSWORD`, `HEADLESS` and
`MOODLE_EXAMPLE_TIMEOUT_MS`.
