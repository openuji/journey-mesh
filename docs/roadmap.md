# Journey Mesh Technical Roadmap

> Proposed public roadmap; not necessarily funded, scheduled, or committed.

## Project links

- Repository: https://github.com/openuji/journey-mesh
- Website: https://journey-mesh.openuji.org/
- Roadmap milestone: https://github.com/openuji/journey-mesh/milestone/1
- Umbrella issue: https://github.com/openuji/journey-mesh/issues/11
- CI workflow: https://github.com/openuji/journey-mesh/actions/workflows/ci.yml
- Nextcloud Filesharing CI workflow: https://github.com/openuji/journey-mesh/actions/workflows/example-ci.yml

## Vision

Journey Mesh is a model-driven framework for executing and validating
cross-service user journeys. It connects portable journey models to automation
adapters, application drivers, interaction profiles, evidence observers, and
graph-linked reports.

The roadmap direction is to evolve Journey Mesh from fixed happy-path execution
into multipath-aware validation of functional, accessibility, reliability, and
deployment outcomes.

## Why cross-service validation matters

Federated and multi-service systems can pass isolated application tests while
still failing at service boundaries: discovery, account mapping, remote
availability, delayed delivery, upgrade compatibility, and evidence review. A
model-driven journey gives teams a shared graph for describing expected user
outcomes and linking runtime evidence back to the relevant states and
transitions.

## Current implementation

These capabilities are verified in this repository:

| Capability | Verified status |
| --- | --- |
| Generic runner | Executes compiled journey plans across profiles. |
| UJG binding | Compiles checked-in UJG JSON-LD into a linear execution plan; ambiguous branches are currently rejected. |
| Playwright adapter | Drives browser automation from runner operations. |
| Nextcloud driver | Supports the federated file-sharing reference example. |
| Interaction profiles | Includes default and keyboard-only profiles. |
| Axe observer | Records accessibility observations and produces path and summary reports. |
| Normalized evidence | Attaches Journey Mesh evidence JSON to Playwright results. |
| Nextcloud federation example | Provisions two local instances for Alice and Bob and runs the file-sharing journey. |
| CI | Provides package checks and a pull-request workflow for the Nextcloud filesharing example. |

## Intended architecture

The core runner remains application-neutral. It should execute journey plans,
select branches, record deterministic evidence, coordinate lifecycle hooks, and
publish reports without embedding application-specific behavior.

Model bindings translate portable journey models into execution plans. Adapters
connect those plans to automation environments. Drivers own application setup,
sessions, fixtures, and domain-specific effects. Profiles choose interaction
modalities. Observers collect evidence. Reporters present graph-linked results
for local review and CI.

## Extension responsibilities

- Model bindings own model parsing, validation, source references, and execution-plan generation.
- Automation adapters own generic execution against an automation runtime such as Playwright.
- Application drivers own service-specific navigation, fixture setup, session isolation, and effect handling.
- Interaction profiles own input-modality selection such as default pointer-first and keyboard-only operation.
- Observers own evidence collection and redaction for functional, accessibility, reliability, and deployment signals.
- Reporters own versioned output formats, human-readable summaries, and CI-compatible artifacts.

## Work packages

| WP | Issue | Status | Estimate | Objective | Deliverables | Acceptance criteria |
| --- | --- | --- | ---: | --- | --- | --- |
| WP1 | [Add multipath-aware journey execution](https://github.com/openuji/journey-mesh/issues/3) | Core, proposed | 18 days | Add deterministic alternative, failure, delayed, recovery, and converging paths. | Branch guards, runtime branch reasons, expected alternatives, bounded retries and polling, replay, coverage, traversal tests. | Three non-happy-path Nextcloud journeys execute; branch reasons are stable; bounded behavior and replay are tested; branch selection, retry attempts, and evidence identifiers preserve the containing touchpoint, actor, and service-instance context; reports separate alternatives, failures, skipped, and unvisited paths. |
| WP2 | [Stabilize execution and extension contracts](https://github.com/openuji/journey-mesh/issues/4) | Core, proposed | 12 days | Version model bindings, adapters, drivers, profiles, observers, and reporters. | Versioned TypeScript interfaces and JSON schemas, stable IDs, typed failures, lifecycle hooks, capability declarations, contract tests, templates, ADRs. | Every extension type has a documented versioned contract; independent extensions can run contract tests; incompatible versions produce actionable diagnostics. |
| WP3 | [Fediversity post-deployment and upgrade validation](https://github.com/openuji/journey-mesh/issues/5) | Core, proposed | 10 days | Implement a documented interface for consuming service endpoints, instance metadata and deployed revisions from reproducible Fediversity/Nix environments. Automate actor provisioning, readiness checks and fixtures, and demonstrate one before/after-upgrade comparison with redacted deployment provenance. | Deployment input interface, actor provisioning, readiness checks, fixtures, redacted provenance, before/after-upgrade comparison, CI example. | A documented command consumes Fediversity/Nix deployment outputs; the same journey runs before and after upgrade; reports compare revisions, branches, outcomes, timing, and observations without credentials. |
| WP4 | [Expand the Nextcloud federation reference journeys](https://github.com/openuji/journey-mesh/issues/6) | Core, proposed | 8 days | Expand the happy path into alternative, delayed, failure, and recovery cases. | Remote-user, availability, retry, acceptance, rejection, revocation, and delay scenarios with profiles, evidence, reports, docs, and tests. | Three alternative, negative, or recovery journeys execute; reports distinguish failure classes where evidence permits; Nextcloud logic stays outside the generic runner. |
| WP5 | [Add a Mastodon federation reference driver](https://github.com/openuji/journey-mesh/issues/7) | Core, proposed | 12 days | Prove reuse with one bounded cross-instance ActivityPub journey. | Mastodon driver, two-instance environment or deployment integration, provisioning, one primary journey with alternatives, contract tests, documentation, evidence. | Generic runtime executes Nextcloud and Mastodon; no Mastodon logic enters the core; one success and two alternative or failure paths run with bounded waits. |
| WP6 | [Add runtime reliability evidence](https://github.com/openuji/journey-mesh/issues/8) | Core, proposed | 8 days | Correlate runtime reliability evidence with functional and accessibility evidence. | Reliability observer, versioned schema, secret redaction, thresholds, execution comparison, CI policy integration, graph-linked reporting, tests. | Evidence uses stable IDs; credentials and authorization headers are redacted; CI can enforce policies; reports correlate runtime, functional, and accessibility evidence. |
| WP7 | [Improve reporting, CI integration, documentation, and release readiness](https://github.com/openuji/journey-mesh/issues/9) | Core, proposed | 8 days | Make Journey Mesh reproducible, reviewable, CI-compatible, and extensible. | HTML, JSON, JUnit-style output, coverage, comparison, graph-linked evidence, quick start, tutorials, CI workflows, security and contribution guidance, examples, release. | Clean checkout installs, builds, type-checks, lints, and tests; reference journeys run from documented commands; docs separate implemented, experimental, proposed, optional, and excluded work. |
| WP8 | [Add restricted Gherkin interoperability](https://github.com/openuji/journey-mesh/issues/10) | Optional, proposed | 6 days | Bridge a documented linear Gherkin subset to UJG without a second engine. | Import and export a documented linear subset, preserve source locations, diagnose unsupported or lossy mappings, publish subset docs and tests. | Linear subset imports through UJG into a valid execution plan; selected paths export as readable Gherkin; UJG remains authoritative. |

## Provisional effort

Core roadmap work is estimated at 76 person-days. Optional WP8 adds 6
person-days, for a total of 82 person-days. These are technical planning
estimates, not a public rate, budget, or delivery commitment.

## Expected outcomes

- Multipath-aware execution of realistic cross-service alternatives, failures, delays, and recoveries.
- Stable contracts for model bindings, adapters, drivers, profiles, observers, and reporters.
- Fediversity post-deployment and upgrade validation with redacted provenance and before/after comparison.
- Expanded Nextcloud reference coverage and one bounded Mastodon reference driver.
- Correlated functional, accessibility, reliability, and deployment evidence.
- CI-friendly reports and documentation that make the project easier to review and extend.

## Risks and mitigations

- Path explosion: bound branch traversal, loops, retries, and polling, and fail invalid cycles with actionable diagnostics.
- Secret leakage: define evidence ownership and require redaction for credentials, cookies, tokens, and authorization headers.
- Application coupling: keep driver-specific logic outside the generic runner and cover extension contracts with contract tests.
- Eventual consistency: record branch reasons, wait durations, retry counts, and uncertain or delayed outcomes.
- Scope drift: keep the roadmap limited to two committed reference drivers and separate proposed, optional, and excluded work.

## Out of scope

- No second full browser adapter.
- No full Gherkin/UJG equivalence.
- No more than two committed drivers.
- No AI-generated journeys.
- No WCAG certification.
- No general protocol-conformance suite.
- No hosted SaaS.
- No long-term production monitoring.

## Funding context

Some roadmap work may support an NLnet NGI Fediversity application. The formal
application is separate from this public roadmap. Publication of this roadmap
does not imply funding, approval, endorsement, or partnership.

## Licensing and openness

The repository declares the MIT License in `package.json` and includes the
checked-in [MIT license](../LICENSE).

## Feedback

Use the [umbrella roadmap issue](https://github.com/openuji/journey-mesh/issues/11)
for broad feedback, or comment on a linked work-package issue for focused
technical discussion.
