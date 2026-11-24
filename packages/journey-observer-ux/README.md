# Journey UX observations

The Playwright observer records detached command events and passive visibility
probes. It does not navigate, activate controls, create fixtures, or render reports.

`deriveUXOutput` calculates provider-owned measurements from compiled operations,
functional outcomes, recorded actions, and probe facts. Counters declare `from`
and `until` references, optionally restrict `operations`, and select attempted,
completed, or failed commands. Each executor command counts once, including a
text-entry command. The Playwright executor records one command for each declared
materialization step, so a keyboard path of six focus moves and one activation
counts seven. Typing a value is still one command, not one per character.

The YAML plugin accepts `id`, `counters`, `checkpoints`, and `probes`. References
use scoped operation aliases resolved by the model plugin during preparation.
Checkpoints measure functional operation outcomes. Probes declare `at` and `target`
references and measure visibility and viewport containment without interaction.

## Probe expectations

A probe measures its target when the `at` state has been asserted: whether the
target is visible, whether it is fully contained in the viewport, and the page's
vertical scroll (`<probe>/scrollY`). It reads the target's box, the viewport and
the scroll position, and never scrolls, focuses or hovers, so observing does not
change what the next operation sees.

Without `expect`, a probe is informational. With it, every unmet expectation is
an error in the observer output, which fails the test like axe `strict` mode:

```yaml
observers:
  - use: "@openuji/journey-observer-ux/plugin"
    options:
      id: tour
      probes:
        - { id: footer-step, label: Footer step, at: tour.footer, target: tour.footer, expect: [scrolled] }
        - { id: orphaned-step, label: Orphaned step, at: tour.orphaned, target: tour.orphaned,
            expect: [visible, inViewport], screenshot: true }
```

| Expectation | Met when |
| --- | --- |
| `visible` | exactly one element matches the target and it is visible |
| `inViewport` | that element's box lies entirely inside the viewport |
| `scrolled` | the page is scrolled vertically (`scrollY > 0`) |

A probe with expectations re-reads the geometry, up to ten times 100 ms apart,
until two consecutive readings agree. A missing, ambiguous or still-changing
target cannot meet an expectation. A probe whose state was never reached adds no
error; the execution has already failed. For each such probe the observer writes
a geometry record (format `journey-mesh/ux-geometry`: the box, viewport, scroll
and which expectations were met), and with `screenshot: true` a screenshot of the
viewport, taken after the geometry was read.

An unreached interval is unavailable. An interrupted interval retains its observed
command count with partial status. Recorded commands remain evidence when later
assertions fail. Every value is scoped by run, execution, profile, and operation.
The host records this output in the run record. Reports and
comparisons consume its measurements without recalculation.
