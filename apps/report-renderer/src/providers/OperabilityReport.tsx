import type { OperabilityReport as Report, OperabilityStepReport, OperabilityTransitionReport } from "@openuji/journey-report-operability";
import { MetadataTable } from "../ui.js";

const kinds: Readonly<Record<string, string>> = { move: "Move", activation: "Activate", shortcut: "Shortcut", "text-entry": "Type text" };
const statuses: Readonly<Record<string, string>> = { completed: "Done", failed: "Failed", attempted: "Started, no result", "not-performed": "Not performed" };
const outcomes: Readonly<Record<string, string>> = { passed: "Passed", failed: "Failed", "not-executed": "Not reached" };
const namedGestures: Readonly<Record<string, string>> = {
  "pointer-move": "Pointer move",
  "pointer-press": "Pointer press",
  tap: "Touch tap",
  "swipe-down": "Touch swipe down",
  type: "Typing"
};

/** `operability:nextStop` → `next stop`, `urn:openuji:move:swipe-down` → `swipe down`; other IRIs stay as they are. */
const moveKind = (id: string) => id.startsWith("operability:")
  ? id.slice("operability:".length).replace(/([A-Z])/g, " $1").toLowerCase()
  : id.startsWith("urn:openuji:move:")
    ? id.slice("urn:openuji:move:".length).replace(/-/g, " ")
    : id;

function Step({ step }: { step: OperabilityStepReport }) {
  const target = step.locator ? [step.locator.role, step.locator.name && `“${step.locator.name}”`].filter(Boolean).join(" ") || step.locator.id : "";
  return <tr data-status={step.status}>
    <td>{step.position}</td>
    <td>{kinds[step.kind] ?? step.kind}{step.moveKindId && <> · {moveKind(step.moveKindId)}</>}{step.label && <small>{step.label}</small>}</td>
    <td>{target}</td>
    <td>{step.gesture && (namedGestures[step.gesture] ?? <kbd>{step.gesture}</kbd>)}</td>
    <td>{statuses[step.status] ?? step.status}{step.error && <small role="note">{step.error}</small>}</td>
  </tr>;
}

function Transition({ transition }: { transition: OperabilityTransitionReport }) {
  const input = transition.input;
  return <article className="input-transition" data-outcome={transition.outcome} id={`input-${transition.operationId}`}>
    <h3>{transition.label} <small>{outcomes[transition.outcome] ?? transition.outcome}</small></h3>
    <p>{input
      ? <>Through <code>{input.modalityLabel ?? input.modalityId}</code>{input.materialization
        ? <>, declared steps <code title={input.materialization.id}>{input.materialization.label ?? input.materialization.id}</code></>
        : ", no declared steps"}</>
      : transition.outcome === "not-executed" ? "Not reached." : "No input declared."}</p>
    {transition.error && transition.outcome === "failed" && <p role="note">{transition.error}</p>}
    {transition.steps.length > 0 && <div className="table-scroll"><table className="input-steps">
      <thead><tr><th scope="col">#</th><th scope="col">Step</th><th scope="col">Target</th><th scope="col">Key, pointer or touch</th><th scope="col">Result</th></tr></thead>
      <tbody>{transition.steps.map((step) => <Step key={step.position} step={step} />)}</tbody>
    </table></div>}
  </article>;
}

/** How each transition was performed: declared Operability steps and the gestures used (format `journey-mesh/operability`). */
export function OperabilityReport({ value }: { value: unknown }) {
  const report = value as Report;
  return <article className="provider-report operability">
    <h1>Input steps</h1>
    <MetadataTable rows={[
      ["Transitions", report.summary.transitions],
      ["Through declared steps", report.summary.materialized],
      ["Steps", report.summary.steps],
      ["Failed steps", report.summary.failedSteps],
      ...(report.excludedPhaseIds.length ? [["Phases not shown", report.excludedPhaseIds.join(", ")] as const] : [])
    ]} />
    {report.executions.map((execution) => <section key={execution.executionId} data-profile={execution.profileId}>
      <h2>{execution.profileId}</h2>
      {execution.transitions.map((transition) => <Transition key={transition.operationId} transition={transition} />)}
    </section>)}
  </article>;
}
