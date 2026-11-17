import { useEffect, useState, type ReactNode } from "react";
import type { ComparisonResultBundle, SuiteResultBundle, TestResultBundle } from "@openuji/journey-plugin";
import { JourneyMap, MetricsLegend, metricKinds } from "./JourneyMap.js";
import { compareMeasurements } from "../src/comparison.js";
import { testPassed } from "../src/outcome.js";
import { artifactHref, subjectDirectory, testDirectory } from "../src/paths.js";

export type ViewerBundle = SuiteResultBundle | ComparisonResultBundle;
const operationLabel = (op: TestResultBundle["plan"]["operations"][number]) => op.kind === "state" ? op.state.label ?? op.state.id : op.transition.label ?? op.transition.id;
const display = (value: number | boolean | string | null | undefined) => value == null ? "Unavailable" : typeof value === "boolean" ? value ? "Yes" : "No" : String(value);
const testBase = (id: string, prefix = "") => `${prefix}${artifactHref(testDirectory(id))}/`;
const profileHash = (test: string, profile?: string) => `#${new URLSearchParams({ test, ...(profile ? { profile } : {}) })}`;
const profilesOf = (test: TestResultBundle) => test.result.executions.map((execution) => execution.profileId);

function Errors({ items }: { items: readonly { message: string }[] }) {
  return items.length ? <ul className="errors">{items.map((item, index) => <li key={index}>{item.message}</li>)}</ul> : null;
}
function Status({ outcome }: { outcome: "passed" | "failed" | "unavailable" }) {
  return <span className={`status ${outcome}`}>{outcome === "passed" ? "Passed" : outcome === "failed" ? "Failed" : "Not executed"}</span>;
}
const executionOutcome = (test: TestResultBundle | undefined, profile: string) => test?.result.executions.find((item) => item.profileId === profile)?.outcome.kind ?? "unavailable";

/** Links to the provider reports for people who need every finding: test-wide HTML written by reporters. */
function ReportLinks({ test, base = "", children }: { test: TestResultBundle; base?: string; children?: ReactNode }) {
  const reports = test.artifacts.filter((artifact) => artifact.contentType === "text/html" && !artifact.scope);
  return reports.length || children ? <div className="report-links">
    {children}
    {reports.map((artifact) => <a key={artifact.href} href={base + artifactHref(artifact.href)} target="_blank" rel="noopener">Open {artifact.label ?? artifact.name}</a>)}
  </div> : null;
}

function ProfileSwitch({ profiles, value, onChange }: { profiles: readonly string[]; value: string; onChange: (profile: string) => void }) {
  if (profiles.length < 2) return null;
  return <div className="profile-switch" role="group" aria-label="Interaction profile">
    {profiles.map((profile) => <button type="button" key={profile} aria-pressed={profile === value} onClick={() => onChange(profile)}>{profile}</button>)}
  </div>;
}

/** Everything below the map: steps, evidence, measurements. Collapsed, for people who need to dig. */
function TestDetails({ test, base, profile }: { test: TestResultBundle; base: string; profile: string }) {
  const execution = test.result.executions.find((item) => item.profileId === profile);
  const recorded = test.result.evidence.executions.find((item) => item.executionId === execution?.executionId);
  const measurements = test.outputs.flatMap((output) => output.measurements.filter((metric) => metric.scope.profileId === profile));
  const artifacts = test.artifacts.filter((artifact) => !artifact.scope || artifact.scope.executionId === execution?.executionId);
  const screenshots = artifacts.filter((artifact) => artifact.contentType === "image/png");
  const downloads = artifacts.filter((artifact) => artifact.contentType !== "image/png");
  const observerErrors = test.outputs.flatMap((output) => output.errors);
  return <div className="details">
    {observerErrors.length > 0 && <details><summary>Observer policy findings</summary><Errors items={observerErrors} /></details>}
    <details><summary>Executed steps and outcomes</summary>
      {recorded ? <table className="operation-table"><thead><tr><th scope="col">Planned step</th><th scope="col">Outcome</th></tr></thead><tbody>
        {test.plan.operations.map((op) => <tr key={op.id}><th scope="row" title={op.id}><small>{op.segment ? `${op.segment} · ${op.kind}` : op.kind}</small>{operationLabel(op)}</th><td>{recorded.operations.find((entry) => entry.operationId === op.id)?.outcome.kind ?? "unexecuted"}</td></tr>)}
      </tbody></table> : <p>No execution was started.</p>}
    </details>
    <details><summary>Evidence and screenshots</summary>
      <div className="evidence-gallery">{screenshots.map((artifact) => {
        const op = test.plan.operations.find((item) => item.id === artifact.scope?.operationId);
        const label = op ? operationLabel(op) : artifact.name;
        const src = base + artifactHref(artifact.href);
        return <figure key={artifact.href}><a href={src}><img loading="lazy" src={src} alt={label} /></a><figcaption>{label}</figcaption></figure>;
      })}</div>
      <ul className="artifact-links">{downloads.map((artifact) => <li key={artifact.href}><a href={base + artifactHref(artifact.href)}>{artifact.label ?? artifact.name}</a>{!artifact.scope && <small>All profiles</small>}</li>)}</ul>
      {!screenshots.length && !downloads.length && <p>No evidence was captured.</p>}
    </details>
    <details><summary>Observer measurements</summary>
      {measurements.length ? <table className="measurement-table"><thead><tr><th scope="col">Measurement</th><th scope="col">Value</th><th scope="col">Status</th></tr></thead><tbody>
        {measurements.map((metric, index) => <tr key={index}><th scope="row">{metric.label}<small>{metric.unit}</small></th><td>{display(metric.value)}</td><td>{metric.status}{metric.reason && <small>{metric.reason}</small>}</td></tr>)}
      </tbody></table> : <p>No measurements were provided.</p>}
    </details>
  </div>;
}

function useHash(): URLSearchParams {
  const read = () => new URLSearchParams(location.hash.slice(1));
  const [params, setParams] = useState(read);
  useEffect(() => {
    const update = () => setParams(read());
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  return params;
}
const testAnchor = (id: string) => `test-${testDirectory(id)}`;

/** One test: the journey map with node metrics first, then links and collapsed details. */
function TestSection({ test, params }: { test: TestResultBundle; params: URLSearchParams }) {
  const profiles = profilesOf(test);
  const requested = params.get("test") === test.id ? params.get("profile") : null;
  const [profile, setProfile] = useState(profiles.find((item) => item === requested) ?? profiles[0] ?? "");
  useEffect(() => { if (requested && profiles.includes(requested)) setProfile(requested); }, [requested]);
  const select = (next: string) => {
    setProfile(next);
    history.replaceState(null, "", profileHash(test.id, next));
  };
  const base = testBase(test.id);
  const execution = test.result.executions.find((item) => item.profileId === profile);
  return <section className="test-page" id={testAnchor(test.id)} data-test={test.id}>
    <div className="test-heading"><h2>{test.id}</h2><Status outcome={executionOutcome(test, profile)} /></div>
    <ProfileSwitch profiles={profiles} value={profile} onChange={select} />
    <Errors items={[...(execution?.outcome.kind === "failed" ? [execution.outcome.error] : []), ...test.reportingErrors]} />
    {execution ? <JourneyMap test={test} profile={profile} base={base} label={test.id} /> : <p className="empty">This profile was not executed.</p>}
    <ReportLinks test={test} base={base} />
    <TestDetails test={test} base={base} profile={profile} />
  </section>;
}

/** A suite run: every test's journey map on one page. */
function Suite({ bundle }: { bundle: SuiteResultBundle }) {
  const params = useHash();
  const target = params.get("test");
  useEffect(() => { if (target) document.getElementById(testAnchor(target))?.scrollIntoView(); }, [target]);
  return <>
    <div className="run-summary"><Status outcome={bundle.ok ? "passed" : "failed"} /><time dateTime={bundle.generatedAt}>Generated {bundle.generatedAt}</time></div>
    <Errors items={bundle.errors} />
    {bundle.tests.length > 1 && <nav className="test-index" aria-label="Tests">{bundle.tests.map((item) => <a key={item.id} href={profileHash(item.id)}>{item.id} <Status outcome={testPassed(item) ? "passed" : "failed"} /></a>)}</nav>}
    {bundle.tests.map((test) => <TestSection key={test.id} test={test} params={params} />)}
    <MetricsLegend kinds={new Set(bundle.tests.flatMap((test) => [...metricKinds(test)]))} />
    {bundle.provenance && Object.keys(bundle.provenance).length > 0 && <details><summary>Tested system provenance</summary><pre>{JSON.stringify(bundle.provenance, null, 2)}</pre></details>}
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
  const sides = (["baseline", "candidate"] as const).map((side) => {
    const subject = bundle.subjects[side];
    const selection = selected[side];
    return { side, subject, selection, test: subject.bundle?.tests.find((item) => item.id === selection.test), label: subject.label ?? subject.bundle?.label ?? (side === "baseline" ? "Baseline" : "Candidate") };
  });
  const kinds = new Set(sides.flatMap(({ test }) => test ? [...metricKinds(test)] : []));
  return <>
    <div className="run-summary"><Status outcome={bundle.ok ? "passed" : "failed"} /><span>{bundle.ok ? "Both subjects passed" : "Contains failed or incomplete executions"}</span><time dateTime={bundle.generatedAt}>Generated {bundle.generatedAt}</time></div>
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
      <div className="subjects" aria-label="Baseline and candidate journey maps">{sides.map(({ side, subject, selection, test, label }) => {
        const root = `${subjectDirectory(side)}/`;
        return <article className="subject" key={side} data-subject={side} data-test={selection.test} data-profile={selection.profile}>
          <div className="subject-heading">
            <div><p className="subject-meta">{side === "baseline" ? "Baseline" : "Candidate"} · {selection.profile || "No execution"}</p><h2>{label}</h2></div>
            <Status outcome={executionOutcome(test, selection.profile)} />
          </div>
          <Errors items={[...subject.errors, ...(subject.bundle?.errors ?? [])]} />
          {test ? <>
            <JourneyMap test={test} profile={selection.profile} base={testBase(test.id, root)} label={label} />
            <ReportLinks test={test} base={testBase(test.id, root)}>
              <a className="details-link" href={`${root}index.html${profileHash(test.id, selection.profile)}`}>Open {label} details</a>
            </ReportLinks>
          </> : <p className="empty">The subject did not produce an execution bundle.</p>}
        </article>;
      })}</div>
      <MetricsLegend kinds={kinds} />
      <h2>Measurement comparison</h2>
      <p className="note">Automated journey measurements. Numeric changes use candidate minus baseline. Only complete, compatible values receive a calculated change.</p>
      {rows.length ? <table className="comparison-table"><thead><tr><th scope="col">Measurement</th><th scope="col">Baseline</th><th scope="col">Candidate</th><th scope="col">Change</th></tr></thead><tbody>{rows.map((row, index) => <tr key={index}>
        <th scope="row">{row.label}<small>{row.unit}</small></th>
        {[row.baseline, row.candidate].map((metric, side) => <td key={side}><span className="value">{display(metric?.value)}</span>{metric && metric.status !== "available" && <small>{metric.status}</small>}</td>)}
        <td>{row.delta !== null ? row.delta > 0 ? `+${row.delta}` : row.delta : row.changed !== null ? row.changed ? "Changed" : "Unchanged" : <abbr title={row.reason ?? row.status}>{row.status === "partial" ? "Partial" : row.status === "missing" ? "Missing" : "Incompatible"}</abbr>}</td>
      </tr>)}</tbody></table> : <p>No paired observer measurements are available.</p>}
      <details><summary>Tested system provenance</summary>{sides.map(({ side, subject, label }) => <div key={side}><h3>{label}</h3><pre>{JSON.stringify(subject.bundle?.provenance ?? {}, null, 2)}</pre></div>)}</details>
    </section>
  </>;
}

export function Report({ bundle }: { bundle: ViewerBundle }) {
  const title = bundle.kind === "comparison" ? bundle.title : bundle.label ?? "Journey Mesh results";
  useEffect(() => { document.title = title; }, [title]);
  return <>
    <header className="page-header"><strong>Journey Mesh</strong><a href="bundle.json" download>Download result bundle</a></header>
    <main className="page"><p className="section-label">{bundle.kind === "comparison" ? "Journey comparison" : "Journey run"}</p><h1>{title}</h1>
      {bundle.kind === "comparison" ? <Comparison bundle={bundle} /> : <Suite bundle={bundle} />}
    </main>
    <footer className="page-footer">Execution outcomes and observer evidence · Journey Mesh</footer>
  </>;
}
