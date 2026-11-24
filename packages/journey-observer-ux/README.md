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

An unreached interval is unavailable. An interrupted interval retains its observed
command count with partial status. Recorded commands remain evidence when later
assertions fail. Every value is scoped by run, execution, profile, and operation.
The host records this output in the run record. Reports and
comparisons consume its measurements without recalculation.
