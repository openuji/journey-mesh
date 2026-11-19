import { useEffect, useRef, useState, type ReactNode } from "react";
import type { LoadedReport, ProfileModel, TestModel, TestSummary } from "@openuji/journey-reporter/model";
import { JourneyMap, MetricsLegend } from "./JourneyMap.js";
import { DataPage } from "./providers/index.js";
import { dataHash, display, Errors, fileUrl, hashParams, Status, testHash } from "./ui.js";

const testAnchor = (id: string) => `test-${encodeURIComponent(id).replace(/[%.]/g, "_")}`;

/** Data documents interpreters derived for a test, e.g. accessibility reports. */
function DataLinks({ test, report, children }: { test: TestModel; report: LoadedReport; children?: ReactNode }) {
  const labelled = test.data.filter((item) => item.label);
  return labelled.length || children ? <div className="report-links">
    {children}
    {labelled.map((item) => <a key={item.href} href={dataHash(report, item.href, item.format, item.label)}>Open {item.label}</a>)}
  </div> : null;
}

function ProfileSwitch({ profiles, value, onChange }: { profiles: readonly string[]; value: string; onChange: (profile: string) => void }) {
  if (profiles.length < 2) return null;
  return <div className="profile-switch" role="group" aria-label="Interaction profile">
    {profiles.map((profile) => <button type="button" key={profile} aria-pressed={profile === value} onClick={() => onChange(profile)}>{profile}</button>)}
  </div>;
}

/** Everything below the map: steps, evidence, measurements. Collapsed, for people who need to dig. */
function TestDetails({ test, profile, report }: { test: TestModel; profile: ProfileModel; report: LoadedReport }) {
  const screenshots = profile.steps.flatMap((step) => step.screenshots.map((file) => ({ file, label: step.label })));
  const downloads = [...profile.steps.flatMap((step) => step.files), ...profile.files, ...test.files];
  const observerFailures = test.failures.filter((item) => item.source === "observer");
  return <div className="details">
    {observerFailures.length > 0 && <details><summary>Observer policy findings</summary><Errors items={observerFailures} /></details>}
    <details><summary>Executed steps and outcomes</summary>
      {profile.executionId ? <table className="operation-table"><thead><tr><th scope="col">Planned step</th><th scope="col">Outcome</th></tr></thead><tbody>
        {profile.steps.map((step) => <tr key={step.id}><th scope="row" title={step.id}><small>{step.segment ? `${step.segment} · ${step.kind}` : step.kind}</small>{step.label}</th><td>{step.outcome}</td></tr>)}
      </tbody></table> : <p>No execution was started.</p>}
    </details>
    <details><summary>Evidence and screenshots</summary>
      <div className="evidence-gallery">{screenshots.map(({ file, label }) => <figure key={file.href}>
        <a href={fileUrl(report, file.href)}><img loading="lazy" src={fileUrl(report, file.href)} alt={label} /></a><figcaption>{label}</figcaption>
      </figure>)}</div>
      <ul className="artifact-links">{downloads.map((file) => <li key={file.href}>
        <a href={file.format ? dataHash(report, file.href, file.format, file.name) : fileUrl(report, file.href)}>{file.name}</a>{!file.scope && <small>All profiles</small>}
      </li>)}</ul>
      {!screenshots.length && !downloads.length && <p>No evidence was captured.</p>}
    </details>
    <details><summary>Observer measurements</summary>
      {profile.measurements.length ? <table className="measurement-table"><thead><tr><th scope="col">Measurement</th><th scope="col">Value</th><th scope="col">Status</th></tr></thead><tbody>
        {profile.measurements.map((metric, index) => <tr key={index}><th scope="row">{metric.label}<small>{metric.unit}</small></th><td>{display(metric.value)}</td><td>{metric.status}{metric.reason && <small>{metric.reason}</small>}</td></tr>)}
      </tbody></table> : <p>No measurements were provided.</p>}
    </details>
  </div>;
}

/** One test: the journey map with node metrics first, then links and collapsed details. */
function TestSection({ test, profileId, select, report }: { test: TestModel; profileId: string; select: (profile: string) => void; report: LoadedReport }) {
  const profile = test.profiles.find((item) => item.id === profileId) ?? test.profiles[0];
  return <section className="test-page" id={testAnchor(test.id)} data-test={test.id}>
    <div className="test-heading"><h2>{test.id}</h2>{profile && <Status outcome={profile.outcome} />}</div>
    <ProfileSwitch profiles={test.profiles.map((item) => item.id)} value={profile?.id ?? ""} onChange={select} />
    <Errors items={[...(profile?.error ? [profile.error] : []), ...test.failures.filter((item) => item.source === "execution" && item.message !== profile?.error?.message)]} />
    {profile?.reason && <p className="empty">{profile.reason}</p>}
    {profile?.executionId ? <JourneyMap test={test} profile={profile} report={report} label={test.id} /> : <p className="empty">This profile was not executed.</p>}
    <DataLinks test={test} report={report} />
    {profile && <TestDetails test={test} profile={profile} report={report} />}
  </section>;
}

function useTest(report: LoadedReport | null, id: string, enabled = true) {
  const [test, setTest] = useState<TestModel>();
  const [error, setError] = useState<string>();
  const [attempt, retry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setTest(undefined); setError(undefined);
    if (enabled && report && id) report.loadTest(id).then((loaded) => { if (!cancelled) setTest(loaded); })
      .catch((reason) => { if (!cancelled) setError(reason.message); });
    return () => { cancelled = true; };
  }, [report, id, enabled, attempt]);
  return { test, error, retry: () => retry(attempt + 1) };
}

function LazyTestSection({ report, entry, params }: { report: LoadedReport; entry: TestSummary; params: URLSearchParams }) {
  const root = useRef<HTMLDivElement>(null);
  const profiles = entry.profiles.map((profile) => profile.id);
  const requested = params.get("test") === entry.id ? params.get("profile") : null;
  const [visible, setVisible] = useState(params.get("test") === entry.id);
  const [profile, setProfile] = useState(profiles.find((id) => id === requested) ?? profiles[0] ?? "");
  useEffect(() => { if (requested && profiles.includes(requested)) setProfile(requested); }, [requested]);
  useEffect(() => {
    const observer = new IntersectionObserver((items) => { if (items.some((item) => item.isIntersecting)) setVisible(true); }, { rootMargin: "300px" });
    if (root.current) observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  const { test, error, retry } = useTest(report, entry.id, visible);
  const select = (next: string) => { setProfile(next); history.replaceState(null, "", testHash(report, entry.id, next)); };
  return <div ref={root}>
    {test ? <TestSection test={test} profileId={profile} select={select} report={report} /> : <section className="test-page" id={testAnchor(entry.id)} data-test={entry.id}>
      <h2>{entry.id}</h2><p role="status">{error ?? "Loading test data…"}</p>{error && <button onClick={retry}>Retry loading test</button>}
    </section>}
  </div>;
}

function Suite({ report, params }: { report: LoadedReport; params: URLSearchParams }) {
  const { model } = report;
  const target = params.get("test");
  useEffect(() => { if (target) document.getElementById(testAnchor(target))?.scrollIntoView(); }, [target]);
  return <>
    <div className="run-summary"><Status outcome={model.ok ? "passed" : "failed"} /><time dateTime={model.finishedAt ?? model.generatedAt}>Finished {model.finishedAt ?? model.generatedAt}</time></div>
    <Errors items={model.runErrors} />
    {model.errors.length > 0 && <details className="report-errors"><summary>Report warnings ({model.errors.length})</summary><Errors items={model.errors} /></details>}
    {model.tests.length > 1 && <nav className="test-index" aria-label="Tests">{model.tests.map((item) => <a key={item.id} href={testHash(report, item.id)}>{item.id} <Status outcome={item.ok ? "passed" : "failed"} /></a>)}</nav>}
    {model.tests.map((entry) => <LazyTestSection key={entry.id} report={report} entry={entry} params={params} />)}
    <MetricsLegend kinds={new Set(model.tests.flatMap((entry) => entry.metricKinds))} />
    {model.provenance && Object.keys(model.provenance).length > 0 && <details><summary>Tested system provenance</summary><pre>{JSON.stringify(model.provenance, null, 2)}</pre></details>}
  </>;
}

function useSubject(report: LoadedReport, side: "baseline" | "candidate") {
  const [subject, setSubject] = useState<LoadedReport | null>();
  useEffect(() => { report.loadSubject(side).then(setSubject, () => setSubject(null)); }, [report, side]);
  return subject;
}

function Comparison({ report }: { report: LoadedReport }) {
  const comparison = report.model.comparison!;
  const pairings = comparison.pairings.length ? comparison.pairings : [{ id: "unavailable", baseline: { test: "", profile: "" }, candidate: { test: "", profile: "" } }];
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
  const subjects = { baseline: useSubject(report, "baseline"), candidate: useSubject(report, "candidate") };
  const loaded = { baseline: useTest(subjects.baseline ?? null, selected.baseline.test), candidate: useTest(subjects.candidate ?? null, selected.candidate.test) };
  const rows = comparison.differences.filter((row) => row.pairing === selected.id);
  const sides = (["baseline", "candidate"] as const).map((side) => {
    const subject = comparison.subjects[side];
    const test = loaded[side].test;
    return { side, subject, loadedReport: subjects[side], selection: selected[side], test, profile: test?.profiles.find((item) => item.id === selected[side].profile),
      error: loaded[side].error, retry: loaded[side].retry, label: subject.label ?? (side === "baseline" ? "Baseline" : "Candidate") };
  });
  const kinds = new Set(sides.flatMap(({ profile }) => profile?.steps.flatMap((step) => step.metrics ? [step.metrics.kind] : []) ?? []));
  return <>
    <div className="run-summary"><Status outcome={report.model.ok ? "passed" : "failed"} /><span>{report.model.ok ? "Both subjects passed" : "Contains failed or incomplete executions"}</span><time dateTime={report.model.generatedAt}>Generated {report.model.generatedAt}</time></div>
    <div className="controls">
      <div><label htmlFor="scenario">Scenario</label><select id="scenario" value={selected.scenario} onChange={(event) => {
        const available = selections.filter((pair) => pair.scenario === event.target.value);
        setSelectedId((available.find((pair) => pair.profileLabel === selected.profileLabel) ?? available[0]).id);
      }}>{scenarios.map((pair) => <option key={pair.scenario} value={pair.scenario}>{pair.scenarioLabel}</option>)}</select></div>
      <div><label htmlFor="profile">Profile</label><select id="profile" value={selected.id} onChange={(event) => setSelectedId(event.target.value)}>{profiles.map((pair) => <option key={pair.id} value={pair.id}>{pair.profileLabel}</option>)}</select></div>
    </div>
    <p id="selection-status" role="status">{selected.scenarioLabel} / {selected.profileLabel} · baseline and candidate</p>
    <section data-comparison-pair={selected.id} key={selected.id}>
      <div className="subjects" aria-label="Baseline and candidate journey maps">{sides.map(({ side, subject, loadedReport, selection, test, profile, label, error, retry }) =>
        <article className="subject" key={side} data-subject={side} data-test={selection.test} data-profile={selection.profile}>
          <div className="subject-heading">
            <div><p className="subject-meta">{side === "baseline" ? "Baseline" : "Candidate"} · {selection.profile || "No execution"}</p><h2>{label}</h2></div>
            <Status outcome={profile?.outcome ?? "not-executed"} />
          </div>
          <Errors items={subject.errors} />
          {test && profile && loadedReport ? <>
            {profile.executionId ? <JourneyMap test={test} profile={profile} report={loadedReport} label={label} /> : <p className="empty">This profile was not executed.</p>}
            <DataLinks test={test} report={loadedReport}>
              <a className="details-link" href={testHash(loadedReport, test.id, selection.profile)}>Open {label} details</a>
            </DataLinks>
          </> : <><p className="empty" role="status">{error ?? (subject.directory ? "Loading execution data…" : "The subject did not produce a run record.")}</p>{error && <button onClick={retry}>Retry loading execution</button>}</>}
        </article>)}</div>
      <MetricsLegend kinds={kinds} />
      <h2>Measurement comparison</h2>
      <p className="note">Automated journey measurements. Numeric changes use candidate minus baseline. Only complete, compatible values receive a calculated change.</p>
      {rows.length ? <table className="comparison-table"><thead><tr><th scope="col">Measurement</th><th scope="col">Baseline</th><th scope="col">Candidate</th><th scope="col">Change</th></tr></thead><tbody>{rows.map((row, index) => <tr key={index}>
        <th scope="row">{row.label}<small>{row.unit}</small></th>
        {[row.baseline, row.candidate].map((metric, side) => <td key={side}><span className="value">{display(metric?.value)}</span>{metric && metric.status !== "available" && <small>{metric.status}</small>}</td>)}
        <td>{row.delta !== null ? row.delta > 0 ? `+${row.delta}` : row.delta : row.changed !== null ? row.changed ? "Changed" : "Unchanged" : <abbr title={row.reason ?? row.status}>{row.status === "partial" ? "Partial" : row.status === "missing" ? "Missing" : "Incompatible"}</abbr>}</td>
      </tr>)}</tbody></table> : <p>No paired observer measurements are available.</p>}
      <details><summary>Tested system provenance</summary>{sides.map(({ side, loadedReport, label }) => <div key={side}><h3>{label}</h3><pre>{JSON.stringify(loadedReport?.model.provenance ?? {}, null, 2)}</pre></div>)}</details>
    </section>
  </>;
}

function useHash(): URLSearchParams {
  const [params, setParams] = useState(hashParams);
  useEffect(() => {
    const update = () => setParams(hashParams());
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  return params;
}

/** A run, a comparison, or (with `#subject=…`) one subject of a comparison. */
export function Report({ report }: { report: LoadedReport }) {
  const params = useHash();
  const side = params.get("subject");
  const [subject, setSubject] = useState<LoadedReport | null>();
  useEffect(() => {
    setSubject(undefined);
    if (side === "baseline" || side === "candidate") report.loadSubject(side).then(setSubject, () => setSubject(null));
  }, [report, side]);
  if (side !== "baseline" && side !== "candidate") return <ReportPage report={report} params={params} />;
  if (subject === undefined) return <main className="page"><p role="status">Loading {side} report…</p></main>;
  if (subject === null) return <main className="page"><p role="alert">The {side} subject has no report.</p><a href="#">Back to comparison</a></main>;
  return <ReportPage report={subject} params={params} comparison />;
}

function ReportPage({ report, params, comparison = false }: { report: LoadedReport; params: URLSearchParams; comparison?: boolean }) {
  const { model } = report;
  const data = params.get("data");
  const title = model.comparison?.title ?? model.label ?? "Journey Mesh results";
  useEffect(() => { document.title = title; }, [title]);
  return <>
    <header className="page-header"><strong>Journey Mesh</strong>{comparison && <a href="#">Back to comparison</a>}<a href={fileUrl(report, "report/report.json")} download>Download report model</a></header>
    <main className="page">
      {data ? <DataPage report={report} href={data} format={params.get("format") ?? undefined} label={params.get("label") ?? undefined} /> : <>
        <p className="section-label">{model.kind === "comparison" ? "Journey comparison" : "Journey run"}</p><h1>{title}</h1>
        {model.kind === "comparison" ? <Comparison report={report} /> : <Suite report={report} params={params} />}
      </>}
    </main>
    <footer className="page-footer">Execution outcomes and observer evidence · Journey Mesh</footer>
  </>;
}
