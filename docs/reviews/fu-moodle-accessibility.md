# Learn@FU accessibility regression programme

Status: initial upstream test matrix; no verified FU production reproduction yet.

## Sources and scope

- Original FU journey: https://fu-journey-lines.openuji.org/journeys/ses_3f9f90f0-dcfe-458a-b9b5-180c9a0bf574/ (recording could not be retrieved during initial research; import a sanitized export before claiming FU observations).
- FU summer 2026 guidance names Moodle 5.0: https://www.fu-berlin.de/sites/digitale-lehre/praxistipps/praxistipps-sose-26/index.html
- FU deployment is locally operated; the exact release, theme, plugin versions, customizations, tour definition and upgrade plans remain unverified.
- Standards: WCAG 2.1 A/AA and applicable EN 301 549 requirements for the Berlin public-sector context; WCAG 2.2 A/AA for Moodle's product target. See https://www.berlin.de/lb/digitale-barrierefreiheit/anforderungen/technische-standards/ and https://moodledev.io/general/development/policies/accessibility .
- Audit epics: [MDL-84362](https://moodle.atlassian.net/browse/MDL-84362) (2025), [MDL-88926](https://moodle.atlassian.net/browse/MDL-88926) (2026).
- Upstream backporting: https://moodledev.io/general/development/policies/backporting .

## First job

The manual workflow [fu-moodle-accessibility.yml](../../.github/workflows/fu-moodle-accessibility.yml) runs the existing MDL-90255 regression against four independent clean installations, using only official Moodle sources:
1. Provisional FU proxy: exact Moodle 5.0.12 commit (operator can supply a verified official commit).
2. Latest published 5.3.x release tag resolved to an exact commit.
3. MOODLE_503_STABLE head, for upcoming LTS changes.
4. main head, for development changes.

The original fork baseline/fix comparison remains unchanged by default. The new matrix is exploratory, not a conformance gate. An exact viewport assertion failure is a finding; installation, navigation, fixture or unexpected test failures are inconclusive. The fixture was designed for a development branch; older versions may require adaptation. A fresh stack per subject avoids shared tour completion state. The first job uses only the existing pointer profile. Before adding multiple profiles to the same stack, reset the tour state or use separate disposable executions.

As of 2026-11-25 the compiled tour asset Git blob is 9e0d8d5ebc3b97d7c2fb21570fec370db78afc28 in 5.0.12, 5.3.1, main (7e0fe783245b41a8c3f6b0a81f210bce7975e581), and the original buggy baseline. The proposed fork fix changes it to c653c6a7fa322cea5343b9d1642dae2e89210964. This is source evidence, not a runtime result.

## Seed inventory

All entries except MDL-90255 are candidates for future executable reproductions, not verified FU findings. WCAG mappings are initial hypotheses to validate during modeling.

| Upstream issue | Test intent | WCAG candidate | Priority |
|---|---|---|---|
| MDL-90255 | Orphaned tour dialog remains reachable after scroll; keyboard operation separately | 2.1.1, 2.4.7, 2.4.11 where applicable | First job |
| MDL-73125 | Restore meaningful focus after closing sortable-list dialog | 2.4.3 | P1 |
| MDL-84065 | Escape book table-of-contents navigation with keyboard | 2.1.2 | P1 |
| MDL-88948 / MDL-88949 | Navigate course index; inspect exposed tree roles | 2.1.1, 4.1.2 | P1 |
| MDL-89444 | Groups control in enrolment dialog has meaningful computed name | 4.1.2 | P1 |
| MDL-88956 | Assignment word-limit field has programmatic label | 1.3.1, 4.1.2 | P1 |
| MDL-85690 | Keyboard navigation in nested TinyMCE help dialog | 2.1.1, 2.1.2 | P2 |
| MDL-89207 | Accordion expanded state reflects actual state | 4.1.2 | P2 |
| MDL-88962 | Section movement exposes a status announcement | 4.1.3 | P2 |
| MDL-88963 | Block action target sizing, accounting for criterion exceptions | 2.5.8 (2.2) | P2 |
| MDL-89815 | Token scope validation error exposed to assistive technology | 3.3.1 | P2 |

Release sources: [5.2.3](https://moodledev.io/general/releases/5.2/5.2.3), [5.2.2](https://moodledev.io/general/releases/5.2/5.2.2), [5.3.1](https://moodledev.io/general/releases/5.3/5.3.1). Verify issue-specific affected/fixed branches and fixture prerequisites before implementing each test. A release note does not show that a defect is present at FU.

## Next work

- Obtain the exact FU release/build, upstream base SHA if available, theme and plugin versions, language, relevant settings and a sanitized tour export. Request a dedicated test account and staging deployment for any FU-side testing. Do not automate real user/course data or publish raw production captures.
- Translate the original sanitized report into a stable UJG journey and explicit accessibility expectations.
- Add a keyboard materialization that uses real sequential keyboard actions rather than direct focus or pointer fallback. Isolate application state per execution.
- Reuse the existing axe observer for rule-based discovery; add passive transition-level focus and computed accessibility-name/role/state assertions where needed. Do not treat axe or Playwright accessibility snapshots as a complete WCAG or screen-reader test.
- Add synthetic course, learner and teacher fixtures for the next P1 journeys. Report pass, reproduced, inconclusive and not applicable separately; preserve exact source and fixture identity.
- Once manual execution is verified, schedule a weekly matrix on the protected default branch and review new accessibility tracker entries, release notes and audit epics. Keep rolling-branch results pinned to their resolved commit.

No real FU credentials, user content or deployment are needed by the initial job.
