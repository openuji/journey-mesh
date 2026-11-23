# Playwright adapter

`@openuji/journey-adapter-playwright` runs web journeys in Chromium, Firefox or
WebKit. It performs keyboard and pointer transitions only through the steps a
UJG 1.0 RC4 `TransitionMaterialization` declares, and it does not work out a path
by itself. The UJG document declares the steps. `mesh.yaml` declares which key
performs each kind of step.

## Who declares what

| Layer | Declares |
| --- | --- |
| UJG document | The materializations of each transition, their modality, the step chain linked by `stepPreviousRef`, and optional step and start locators |
| Profile (`mesh.yaml`) | The preferred modality, and which materialization to run when several exist (`materializationPreference`) |
| Adapter (`mesh.yaml`) | The key for each move kind and for activation (`keyboard`) |
| Adapter | Performs exactly the declared steps, checks each one, and fails with a message that names the step |

A profile rejects a transition that has no materialization through the modality
it selects. This check runs during preflight, before any service starts.

## Steps

| Modality | Step | Performed as | Checked |
| --- | --- | --- | --- |
| `observability:keyboard` | `MoveStep` with a FocusMoveKind | The key from `keyboard.moves` for the focused object's role | Focus moved. With a locator, the focused object matches it. |
| `observability:keyboard` | `ActivationStep` | The key from `keyboard.activation` for the focused object's role | With a locator, the focused object matches it. |
| `observability:keyboard` | `ShortcutStep` | The object's `aria-keyshortcuts` (the first one), or the step's `urn:openuji:playwright:shortcut` extension, pressed at the current focus | The object matches exactly one element. |
| `observability:pointer` | `MoveStep` `operability:pointAt` | Scroll the object into view and move the pointer to its centre | The locator matches exactly one object (the adapter never chooses). The pointer is over it and not covered. |
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

The adapter never calls `focus()`, `click()`, `fill()` or a locator's
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

`keyboard` is an adapter option. Each value is either a Playwright key, or a
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

The adapter does not read `aria-orientation` or `dir`. For a vertical tab list
or a right-to-left page, set the keys:

```yaml
adapters:
  web:
    use: "@openuji/journey-adapter-playwright/plugin"
    options:
      keyboard:
        moves:
          operability:nextItem: { tab: ArrowDown }
          operability:previousItem: { tab: ArrowUp }
```

When the focused object has a role the binding doesn't list and there is no
`"*"`, the step fails and the error names the role to add. Producer-defined
FocusMoveKinds work once the table gives them a key.

## Recorded input actions

Every step records one `JourneyInputAction` with `command` (`move`, `activate`,
`shortcut` or `text-entry`), `materializationId`, `stepId` and `gesture` (the
key, `pointer-move`, `pointer-press` or `type`). Each attempt is recorded once
as attempted and once as completed or failed, under the same `id`.

## Tests

`pnpm test` runs unit tests. `pnpm test:browser` runs the step checks in
headless Chromium. It covers passing and failing tab lists, pointer
ambiguity, text entry, shortcuts and start checks. Install the browser first
with `pnpm exec playwright install chromium`.
