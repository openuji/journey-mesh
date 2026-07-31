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

## Feedback

Use the [umbrella roadmap issue](https://github.com/openuji/journey-mesh/issues/11)
for broad feedback, or comment on a linked work-package issue for focused
technical discussion.
