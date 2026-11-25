# Moodle user tour viewport (MDL-90255)

A Moodle user tour shows an *orphaned* step (one without a target) in a fixed
position. Before MDL-90255 the dialog took document-relative offsets, so when
the previous step had scrolled the page, the orphaned step appeared outside the
viewport. This example reproduces the bug at the baseline commit and shows that
the fix keeps the dialog in view.

| Source | Commit | Expected result |
| --- | --- | --- |
| Baseline | [`46c042e7`](https://github.com/zavalit/moodle/commit/46c042e7da65f8cb2ec7dc19f46566ce61a393e1) | The orphaned step's `inViewport` expectation fails, and `End tour` cannot be reached |
| Fix | [`b5b1675c`](https://github.com/zavalit/moodle/commit/b5b1675c7967fea1df5f1bd4961710c33a74ea43) | Every expectation passes and the tour ends |

Both runs use the same models, fixture, images and viewport (1024×768); only
`MOODLE_SOURCE_SHA` differs. The services build Moodle from that commit,
install a fresh site and import [`fixtures/scrolled-tour.json`](fixtures/scrolled-tour.json),
the tour of the fix's Behat scenario. The UX observer then checks that the
footer step scrolled the page (`scrolled`) and that the orphaned step is fully
in view (`visible`, `inViewport`).

## Why Site administration

The tour applies to Site administration instead of the dashboard. The bug moves
the dialog up by the scroll distance, so it only leaves the viewport when the
page scrolls further than the dialog's centred top (289 px here). A fresh
dashboard scrolls only 165 px and does not reproduce the bug; Site
administration scrolls far enough.

## Run

Build the workspace first (see the [root README](../../README.md#quick-start)).
Requires Docker. The first run clones Moodle and builds the image, which takes
several minutes.

```sh
pnpm --filter @openuji/example-moodle-usertour-viewport e2e:fix        # test-results/fix
pnpm --filter @openuji/example-moodle-usertour-viewport e2e:baseline   # test-results/baseline, exits 1
pnpm --filter @openuji/example-moodle-usertour-viewport compare        # test-results/comparison
pnpm --filter @openuji/report-renderer serve examples/moodle-usertour-viewport/test-results/baseline
```

A baseline run proves the bug only when it reached the orphaned step with the
page scrolled and fails with that step's `inViewport` error; a failed build,
install or login proves nothing. CI (`example-ci.yml`) checks exactly that.
