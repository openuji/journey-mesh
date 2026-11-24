# Playwright executor

`@openuji/journey-executor-playwright` runs web journeys in Chromium, Firefox or
WebKit. It performs keyboard and pointer transitions only through the steps a
UJG 1.0 RC4 `TransitionMaterialization` declares, and it does not work out a path
by itself. The UJG document declares the steps. `mesh.yaml` declares which key
performs each kind of step.

## Who declares what

| Layer | Declares |
| --- | --- |
| UJG document | The materializations of each transition, their modality, the step chain linked by `stepPreviousRef`, and optional step and start locators |
| Profile (`mesh.yaml`) | The preferred modality, and which materialization to run when several exist (`materializationPreference`) |
| Executor (`mesh.yaml`) | The key for each move kind and for activation (`keyboard`), and the interface that expires on its own (`transientUi`) |
| Executor | Performs exactly the declared steps, checks each one, and fails with a message that names the step |

A profile rejects a transition that has no materialization through the modality
it selects. This check runs during preflight, before any service starts.

## Steps

| Modality | Step | Performed as | Checked |
| --- | --- | --- | --- |
| `observability:keyboard` | `MoveStep` with a FocusMoveKind | The key from `keyboard.moves` for the focused object's role | Focus moved. With a locator, the focused object matches it. |
| `observability:keyboard` | `ActivationStep` | The key from `keyboard.activation` for the focused object's role | With a locator, the focused object matches it. |
| `observability:keyboard` | `ShortcutStep` | The object's `aria-keyshortcuts` (the first one), or the step's `urn:openuji:playwright:shortcut` extension, pressed at the current focus | The object matches exactly one element. |
| `observability:pointer` | `MoveStep` `operability:pointAt` | Scroll the object into view and move the pointer to its centre | The locator matches exactly one object (the executor never chooses). The pointer is over it and not covered. |
| `observability:pointer` | `ActivationStep` | Press and release at the pointer position | With a locator, the object under the pointer matches it. |
| `urn:openuji:input-modality:keyboard-text-entry` | `MoveStep` with a FocusMoveKind | Same as the keyboard move above | Same as the keyboard move above |

The object the user is at is the one the accessibility API reports as focused:
the focused element, or the element its `aria-activedescendant` names, such as
the highlighted option of a combobox. Keys and typed text still go to the
element that has DOM focus.

A `materializationStartLocatorRef` is checked before the first step: the
focused object for keyboard, and the object under the pointer for pointer.
Whether the transition was taken is checked by the next State operation in
the plan.

The executor never calls `focus()`, `click()`, `fill()` or a locator's
`press()`. Keys go to whatever has focus, so a defect in tab order or arrow-key
handling fails the step instead of being skipped.

Not supported (rejected during preflight): `operability:nextPage` and
`operability:previousPage`, pointer shortcuts, and keyboard moves whose kind
has no key in the table.

### Text entry

Entering text is outside RC4 Operability. The producer modality
`urn:openuji:input-modality:keyboard-text-entry` types the transition value at
the focused object, after checking that this object is the transition's bound
field. If focus has to move first, give the text-entry transition a
materialization through that modality whose steps are focus moves only:

```json
{ "@type": "TransitionMaterialization", "@id": "urn:material:enter-password",
  "materializationTransitionRef": "urn:transition:enters-password",
  "materializationModalityRef": "urn:openuji:input-modality:keyboard-text-entry",
  "materializationStepRefs": ["urn:step:enter-password:1"] },
{ "@type": "MoveStep", "@id": "urn:step:enter-password:1",
  "stepMoveKindRef": "operability:nextStop", "stepLocatorRef": "urn:locator:password" }
```

A field that already has focus, such as an autofocused login field, needs no
materialization. Chromium selects the existing text when Tab moves into a
filled input, so typing then replaces that text.

## Keyboard table

`keyboard` is an executor option. Each value is either a Playwright key, or a
map from an ARIA role of the focused object to a key, with `"*"` for any role.
Roles are tested with Playwright's role engine, the same one `getByRole` uses.
An entry you give replaces the default entry for that move kind, or the whole
`activation` binding. All other defaults stay.

Defaults (WAI-ARIA conventions for left-to-right, horizontal tab lists). Buttons
and toggles activate with Space and everything else with Enter. A button accepts
both, so set `activation: { button: Enter, ... }` to check Enter instead:

```yaml
keyboard:
  moves:
    operability:nextStop: Tab
    operability:previousStop: Shift+Tab
    operability:firstItem: Home
    operability:lastItem: End
    operability:nextItem: { tab: ArrowRight, option: ArrowDown, combobox: ArrowDown, menuitem: ArrowDown, treeitem: ArrowDown, radio: ArrowDown }
    operability:previousItem: { tab: ArrowLeft, option: ArrowUp, combobox: ArrowUp, menuitem: ArrowUp, treeitem: ArrowUp, radio: ArrowUp }
  activation: { button: Space, checkbox: Space, radio: Space, switch: Space, menuitemcheckbox: Space, menuitemradio: Space, "*": Enter }
```

The executor does not read `aria-orientation` or `dir`. For a vertical tab list
or a right-to-left page, set the keys:

```yaml
executors:
  web:
    use: "@openuji/journey-executor-playwright/plugin"
    options:
      keyboard:
        moves:
          operability:nextItem: { tab: ArrowDown }
          operability:previousItem: { tab: ArrowUp }
```

When the focused object has a role the binding doesn't list and there is no
`"*"`, the step fails and the error names the role to add. Producer-defined
FocusMoveKinds work once the table gives them a key.

## Transient interface

Some interface removes itself on a timer: a toast, a snackbar, a banner that
fades. While it is on the page, its controls are tab stops, so how many stops a
declared focus walk crosses depends on how long ago something else happened. That
is worst when a walk starts from lost focus, because it then runs from an end of
the document, where such controls usually sit. A count probed on a fast machine
fails on a slow one.

`transientUi` names that interface, and a materialization with a focus move
starts only once none of it is on the page:

```yaml
executors:
  web:
    use: "@openuji/journey-executor-playwright/plugin"
    options:
      transientUi:
        - { role: status }                  # any object with this ARIA role
        - { role: alert, name: Saved }      # role with its exact accessible name
        - { css: ".app-notification" }      # a Playwright CSS selector
```

- It is configuration, like `keyboard`. The executor knows no application's
  notifications, so nothing is transient unless the suite says so.
- It waits and nothing more. It never dismisses, hides or clicks anything, adds
  no step, and records no input action, because the user did nothing. The wait
  uses the same polling and `assertionTimeoutMs` as every other check, and
  fails naming what never went away.
- It applies to keyboard and text-entry materializations that have a focus move.
  Pointer paths, and keyboard paths that only activate at the current focus or
  press a shortcut, do not count stops and never wait.
- Declare an object whose role or selector no persistent element shares. `<output>`
  and live regions have the implicit role `status`, so `{ role: status }` fits a
  page only if nothing permanent uses it. A persistent match makes every walk
  time out instead of passing silently.
- Declare walks against a page without that interface, and probe their counts
  that way. The interface is still in the tab order while it is up, and users
  meet it there. The option makes the count repeatable, and it does not hide the
  defect.

## Finding paths

`journey-mesh discover` finds the steps a model does not declare yet. The
plugin declares a discovery mode, which the host builds in place of the executor
only in a discovery run; a test run never builds it. It takes the executor's own
settings, so the suite's browser, viewport, `keyboard` table and `transientUi`
apply unchanged. Findings go to the host, not to a file. In code,
`playwrightDiscoveryExecutor` is the discovery counterpart of `playwrightExecutor`.

Discovery is Web only by construction: it walks the browser's sequential focus
order, WAI-ARIA composite widgets and `aria-activedescendant`. No other executor
has a discovery mode, so `discover` rejects tests with journeys on them.

During discovery, the executor performs a declared materialization exactly as a
test run would. Discovery acts only on a transition without one:

| Modality | What discovery does | Path it reports |
| --- | --- | --- |
| Keyboard | Walks with the `operability:nextStop` key until the user is at the bound object. Then it retraces the walk and measures the `operability:previousStop` walk from the same start, keeping the shorter one. An object with an item role (`tab`, `menuitem`, `option`, `treeitem`, `radio`) is reached by walking into its container, then with `operability:nextItem` or `operability:previousItem`, again the shorter way. A combobox that controls a listbox counts as being in it. | The moves, then an activation. The last move names the bound object. |
| Text entry | Walks to the bound field the same way, matched by DOM focus | The moves, or nothing when the field already has focus |
| Pointer | Points at the bound object and presses | `operability:pointAt` naming the object, then an activation |

Discovery then takes the transition with the table's activation key, or types
the value, or presses the pointer, so the journey goes on to its next state.
Each transition gives one entry: `declared`, `found` with its steps, `at-target`,
or `not-found` with the objects the walk passed. When no path is found, the
transition fails, because the journey cannot go on.

- Keys come only from the keyboard table. Discovery never calls `focus()` or
  `click()`, so it only reports paths a keyboard user can take.
- A walk is measured once focus has stayed on one object for 500 ms. An
  application often moves focus a moment after a transition: a dialog focuses
  its first field, or a closing menu loses focus.
- After each walk is retraced, focus must be back at the start. Sometimes it
  cannot be:
  - the start is outside the tab order, such as a `main` element focused by
    script, or the document itself
  - the page changed during the walk

  Then the backward count is taken around the tab cycle, and the entry's `note`
  says so.
- Walks start once the declared `transientUi` has expired, like the walks of a
  test run.
- Discovery cannot know a shortcut, such as Escape closing a menu, or a start
  locator. Declare those yourself.
- A report is a proposal. Review the start and the objects passed before
  declaring it.

## Recorded input actions

Every step records one `JourneyInputAction` with `command` (`move`, `activate`,
`shortcut` or `text-entry`), `materializationId`, `stepId` and `gesture` (the
key, `pointer-move`, `pointer-press` or `type`). Each attempt is recorded once
as attempted and once as completed or failed, under the same `id`.

The executor passes these actions only to its observers. To get them into the
run record and the report, add
[`@openuji/journey-observer-operability`](../journey-observer-operability/README.md)
to the executor's observers and `@openuji/journey-report-operability` to the
report interpreters.

## Tests

`pnpm test` runs unit tests. `pnpm test:browser` runs the step checks and path discovery in
headless Chromium. It covers passing and failing tab lists, pointer
ambiguity, text entry, shortcuts and start checks. Install the browser first
with `pnpm exec playwright install chromium`.

## Observation contract

Executor observers attach to this executor through its observation contract,
`@openuji/playwright-observation/v1`. They import it from the `./observation`
entry, never from the package root, which loads Playwright:

```ts
import { playwrightObservationContract, type PlaywrightExecutionObserver } from "@openuji/journey-executor-playwright/observation";
```

The entry holds the observer types (`PlaywrightExecutionObserver`,
`PlaywrightOperationObservation`), the contract, the executor's recorded name
(`playwrightExecutorName`) and `toPlaywrightObservationLocator`. It loads no
browser runtime; `pnpm lint` checks that. The Appium executor has the same entry
for its Android contract, `@openuji/appium-android-observation/v1`.
