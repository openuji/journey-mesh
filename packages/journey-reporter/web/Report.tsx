import { useEffect, useState } from "react";
import type { ComparisonResultBundle, SuiteResultBundle, TestResultBundle } from "@openuji/journey-plugin";
import { JourneyPathView } from "./JourneyPathView.js";
import { compareMeasurements } from "../src/comparison.js";
import { testPassed } from "../src/outcome.js";
import { artifactHref, subjectDirectory, testDirectory } from "../src/paths.js";

export type ViewerBundle = SuiteResultBundle | ComparisonResultBundle;
const operationLabel = (op: TestResultBundle["plan"]["operations"][number]) => op.kind === "state" ? op.state.label ?? op.state.id : op.transition.label ?? op.transition.id;
const display = (value: number | boolean | string | null | undefined) => value == null ? "Unavailable" : typeof value === "boolean" ? value ? "Yes" : "No" : String(value);

function Errors({ items }: { items: readonly { message: string }[] }) {
  return items.length ? <ul className="errors">{items.map((item, index) => <li key={index}>{item.message}</li>)}</ul> : null;
}
function artifactsFor(test: TestResultBundle, profile?: string) {
  return test.artifacts.filter((artifact) => !artifact.scope || artifact.scope.runId === test.result.runId && (!profile || artifact.scope.profileId === profile) && test.result.executions.some((execution) => execution.executionId === artifact.scope!.executionId));
}
function Visualizations({ test, profile, base = "", label }: { test: TestResultBundle; profile: string; base?: string; label: string }) {
  return test.result.executions.some((execution) => execution.profileId === profile)
    ? <JourneyPathView test={test} profile={profile} base={base} label={label} />
    : <p className="empty">No journey visualization is available for this execution.</p>;
}
function TestDetails({ test, base = "", profile }: { test: TestResultBundle; base?: string; profile?: string }) {
  const execution = test.result.executions.find((item) => item.profileId === profile);
  const selectedErrors = profile ? execution?.outcome.kind === "failed" ? [execution.outcome.error] : [] : test.result.errors;
  const executions = test.result.evidence.executions.filter((item) => !profile || item.profileId === profile);
  const measurements = test.outputs.flatMap((output) => output.measurements.filter((metric) => !profile || metric.scope.profileId === profile));
  const artifacts = artifactsFor(test, profile);
  const screenshots = artifacts.filter((artifact) => artifact.contentType === "image/png");
  const downloads = artifacts.filter((artifact) => artifact.contentType !== "image/png");
  const observerErrors = test.outputs.flatMap((output) => output.errors);
  return <>
    <Errors items={selectedErrors} /><Errors items={test.reportingErrors} />
    {observerErrors.length > 0 && <details><summary>Observer policy findings</summary><Errors items={observerErrors} /></details>}
    <details><summary>Executed steps and outcomes</summary>
      {executions.length ? executions.map((item) => <div key={item.executionId}>
        <h3>{item.profileId}</h3>
        <table className="operation-table"><thead><tr><th scope="col">Planned step</th><th scope="col">Outcome</th></tr></thead><tbody>
          {test.plan.operations.map((op) => <tr key={op.id}><th scope="row" title={op.id}><small>{op.kind}</small>{operationLabel(op)}</th><td>{item.operations.find((entry) => entry.operationId === op.id)?.outcome.kind ?? "unexecuted"}</td></tr>)}
        </tbody></table>
      </div>) : <p>No execution was started.</p>}
    </details>
    <details><summary>Evidence and screenshots</summary>
      <div className="evidence-gallery">{screenshots.map((artifact) => {
        const op = test.plan.operations.find((item) => item.id === artifact.scope?.operationId);
        const label = op ? operationLabel(op) : artifact.name;
        const src = base + artifactHref(artifact.href);
        return <figure key={artifact.href}><a href={src}><img loading="lazy" src={src} alt={label} /></a><figcaption>{label}</figcaption></figure>;
      })}</div>
      <ul className="artifact-links">{downloads.map((artifact) => <li key={artifact.href}><a href={base + artifactHref(artifact.href)}>{artifact.name}</a>{!artifact.scope && <small>Test-wide report</small>}</li>)}</ul>
      {!screenshots.length && !downloads.length && <p>No evidence was captured.</p>}
    </details>
    <details><summary>Observer measurements</summary>
      {measurements.length ? <table className="measurement-table"><thead><tr><th scope="col">Measurement</th><th scope="col">Value</th><th scope="col">Status</th></tr></thead><tbody>
        {measurements.map((metric, index) => <tr key={index}><th scope="row">{metric.label}<small>{metric.unit}</small></th><td>{display(metric.value)}</td><td>{metric.status}{metric.reason && <small>{metric.reason}</small>}</td></tr>)}
      </tbody></table> : <p>No measurements were provided.</p>}
    </details>
  </>;
}
function Comparison({ bundle }: { bundle: ComparisonResultBundle }) {
  const pairings = bundle.pairings.length ? bundle.pairings : [{ id: "unavailable", baseline: { test: "", profile: "" }, candidate: { test: "", profile: "" } }];
  const selections = pairings.map((pair) => ({
    ...pair,
    scenario: JSON.stringify([pair.baseline.test, pair.candidate.test]),
    scenarioLabel: pair.baseline.test === pair.candidate.test ? pair.baseline.test || "Unavailable" : `${pair.baseline.test || "Unavailable"} / ${pair.candidate.test || "Unavailable"}`,
    profileLabel: pair.baseline.profile === pair.candidate.profile ? pair.baseline.profile || "Unavailable" : `${pair.baseline.profile || "Unavailable"} / ${pair.candidate.profile || "Unavailable"}`
  }));
  const [selectedId, setSelectedId] = useState(selections[0].id);
  const selected = selections.find((pair) => pair.id === selectedId) ?? selections[0];
  const scenarios = [...new Map(selections.map((pair) => [pair.scenario, pair])).values()];
  const profiles = selections.filter((pair) => pair.scenario === selected.scenario);
  const rows = compareMeasurements(bundle).filter((row) => row.pairing === selected.id);
  return <>
    <div className="run-summary"><span>{bundle.ok ? "Both subjects passed" : "Contains failed or incomplete executions"}</span><time dateTime={bundle.generatedAt}>Generated {bundle.generatedAt}</time></div>
    <Errors items={bundle.errors} />
    <div className="controls">
      <div><label htmlFor="scenario">Scenario</label><select id="scenario" value={selected.scenario} onChange={(event) => {
        const available = selections.filter((pair) => pair.scenario === event.target.value);
        setSelectedId((available.find((pair) => pair.profileLabel === selected.profileLabel) ?? available[0]).id);
      }}>{scenarios.map((pair) => <option key={pair.scenario} value={pair.scenario}>{pair.scenarioLabel}</option>)}</select></div>
      <div><label htmlFor="profile">Profile</label><select id="profile" value={selected.id} onChange={(event) => setSelectedId(event.target.value)}>{profiles.map((pair) => <option key={pair.id} value={pair.id}>{pair.profileLabel}</option>)}</select></div>
    </div>
    <p id="selection-status" role="status">{selected.scenarioLabel} / {selected.profileLabel} · baseline and candidate</p>
    <section data-comparison-pair={selected.id} key={selected.id}>
      <div className="subjects" aria-label="Baseline and candidate journey paths">{(["baseline", "candidate"] as const).map((side) => {
        const subject = bundle.subjects[side];
        const label = subject.label ?? subject.bundle?.label ?? (side === "baseline" ? "Baseline" : "Candidate");
        const selection = selected[side];
        const test = subject.bundle?.tests.find((item) => item.id === selection.test);
        const execution = test?.result.executions.find((item) => item.profileId === selection.profile);
        const status = execution?.outcome.kind ?? "unavailable";
        const base = `${subjectDirectory(side)}/${artifactHref(testDirectory(selection.test))}/`;
        return <article className="subject" key={side} data-subject={side} data-test={selection.test} data-profile={selection.profile}>
          <div className="subject-heading"><h3>{label}</h3><span className={`status ${status}`}>{status === "passed" ? "Passed" : status === "failed" ? "Failed" : "Not executed"}</span></div>
          <p className="subject-meta">{side === "baseline" ? "Baseline" : "Candidate"} · {selection.profile || "No execution"}</p>
          <Errors items={[...subject.errors, ...(subject.bundle?.errors ?? [])]} />
          {test ? <><Visualizations test={test} profile={selection.profile} base={base} label={side === "baseline" ? "Baseline" : "Candidate"} /><TestDetails test={test} base={base} profile={selection.profile} /></> : <p className="empty">The subject did not produce an execution bundle.</p>}
          <details><summary>Tested system provenance</summary><pre>{JSON.stringify(subject.bundle?.provenance ?? {}, null, 2)}</pre></details>
        </article>;
      })}</div>
      <h2>Measurement comparison</h2>
      <p className="note">Automated journey measurements. Numeric changes use candidate minus baseline. Only complete, compatible values receive a calculated change.</p>
      {rows.length ? <table className="comparison-table"><thead><tr><th scope="col">Measurement</th><th scope="col">Baseline</th><th scope="col">Candidate</th><th scope="col">Change</th></tr></thead><tbody>{rows.map((row, index) => <tr key={index}>
        <th scope="row">{row.label}<small>{row.unit}</small></th>
        {[row.baseline, row.candidate].map((metric, side) => <td key={side}><span className="value">{display(metric?.value)}</span>{metric && metric.status !== "available" && <small>{metric.status}</small>}</td>)}
        <td>{row.delta !== null ? row.delta > 0 ? `+${row.delta}` : row.delta : row.changed !== null ? row.changed ? "Changed" : "Unchanged" : <abbr title={row.reason ?? row.status}>{row.status === "partial" ? "Partial" : row.status === "missing" ? "Missing" : "Incompatible"}</abbr>}</td>
      </tr>)}</tbody></table> : <p>No paired observer measurements are available.</p>}
    </section>
  </>;
}
function useHashTest(): string | undefined {
  const read = () => new URLSearchParams(location.hash.slice(1)).get("test") ?? undefined;
  const [selected, setSelected] = useState(read);
  useEffect(() => {
    const update = () => setSelected(read());
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  return selected;
}
function Suite({ bundle }: { bundle: SuiteResultBundle }) {
  const selectedId = useHashTest();
  const test = bundle.tests.find((item) => item.id === selectedId);
  if (test) {
    const base = `${artifactHref(testDirectory(test.id))}/`;
    return <>
      <p><a href="#">All tests</a></p>
      <h2>{test.id}</h2>
      <p>{testPassed(test) ? "Passed" : "Failed"}</p>
      {test.result.executions.map((execution) => <section key={execution.executionId}><h3>{execution.profileId}</h3><Visualizations test={test} profile={execution.profileId} base={base} label={test.id} /></section>)}
      <TestDetails test={test} base={base} />
    </>;
  }
  return <>
    <p>{bundle.ok ? "Passed" : "Failed"} · {bundle.generatedAt}</p>
    <Errors items={bundle.errors} />
    <ul>{bundle.tests.map((item) => <li key={item.id}><a href={`#${new URLSearchParams({ test: item.id })}`}>{item.id}</a> — {testPassed(item) ? "passed" : "failed"}</li>)}</ul>
    {bundle.provenance && Object.keys(bundle.provenance).length > 0 && <details><summary>Tested system provenance</summary><pre>{JSON.stringify(bundle.provenance, null, 2)}</pre></details>}
  </>;
}
export function Report({ bundle }: { bundle: ViewerBundle }) {
  const title = bundle.kind === "comparison" ? bundle.title : bundle.label ?? "Journey Mesh results";
  useEffect(() => { document.title = title; }, [title]);
  return <>
    <header><strong>Journey Mesh</strong><a href="bundle.json" download>Download result bundle</a></header>
    <main><h1>{title}</h1>
      {bundle.kind === "comparison" ? <Comparison bundle={bundle} /> : <Suite bundle={bundle} />}
    </main>
    <footer>Execution outcomes and observer evidence · Journey Mesh</footer>
  </>;
}
