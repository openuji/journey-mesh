import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  JourneyPathYaml,
  ResponsiveJourneyPath,
  type JourneyPathPreviewData,
} from "@openuji/journey-path";
import { parse } from "yaml";
import {
  auditTotals,
  operationStatus,
  operationError,
  profileStatus,
  type ComparisonReportData,
} from "./data";
import "./style.css";

function WebTouchpoint({ label }: { label: string }) {
  return (
    <span className="touchpoint-client" aria-label={`${label}, Web`}>
      <span className="touchpoint-label">
        <svg aria-hidden="true" fill="none" viewBox="0 0 16 16">
          <path d="M4.7 11.5h6.4a2.4 2.4 0 0 0 .3-4.8 3.7 3.7 0 0 0-7.1-1.1A3 3 0 0 0 4.7 11.5Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
        </svg>
        {label}
      </span>
      <span className="touchpoint-platform">Web</span>
    </span>
  );
}

function graphItems(
  model: string,
): readonly { id: string; label: string; kind: string }[] {
  const document = parse(model);
  function visit(
    states: Record<string, any>,
  ): { id: string; label: string; kind: string }[] {
    return Object.entries(states).flatMap(([id, state]) => {
      if (!state.subjourney) return [{ id, label: state.label, kind: "State" }];
      const journey = state.subjourney;
      const nested = visit(journey.states);
      return nested.flatMap((item) => [
        item,
        ...(journey.transitions ?? [])
          .filter((t: any) => t.from === item.id)
          .map((t: any) => ({ id: t.id, label: t.label, kind: "Action" })),
      ]);
    });
  }
  return visit(document.states);
}

function Report({ data }: { data: ComparisonReportData }) {
  const query = new URLSearchParams(location.search);
  const [version, setVersion] = useState(
    query.get("version") ?? data.variants.at(-1)!.variant.id,
  );
  const [profile, setProfile] = useState(query.get("profile") ?? "default");
  const selected =
    data.variants.find((v) => v.variant.id === version) ?? data.variants[0];
  const profiles = [
    ...new Set([
      "default",
      "keyboard-only",
      ...data.variants.flatMap(
        (v) => v.result?.executions.map((e) => e.profileId) ?? [],
      ),
    ]),
  ];
  const audit = selected.audits[profile];
  const path = graphItems(selected.model);
  function select(nextVersion: string, nextProfile: string) {
    setVersion(nextVersion);
    setProfile(nextProfile);
    const url = new URL(location.href);
    url.searchParams.set("version", nextVersion);
    url.searchParams.set("profile", nextProfile);
    history.replaceState(null, "", url);
  }
  const display = (value: number | boolean | null | undefined) =>
    value == null
      ? "Not measured"
      : typeof value === "boolean"
        ? value
          ? "Yes"
          : "No"
        : String(value);
  const rows: readonly [
    string,
    (v: typeof selected) => number | boolean | null | undefined,
    boolean?,
  ][] = [
    [
      "Input actions to verified acceptance",
      (v: typeof selected) =>
        v.metrics.find((m) => m.profileId === profile)
          ?.inputActionsToAcceptance,
    ],
    [
      "Acceptance and mount verified",
      (v: typeof selected) =>
        v.metrics.find((m) => m.profileId === profile)?.acceptanceVerified,
    ],
    [
      "Recipient input actions",
      (v: typeof selected) =>
        v.metrics.find((m) => m.profileId === profile)?.inputActions,
    ],
    [
      "Navigation before acceptance",
      (v: typeof selected) =>
        v.metrics.find((m) => m.profileId === profile)
          ?.navigationBeforeAcceptance,
    ],
    [
      "Navigation after acceptance",
      (v: typeof selected) =>
        v.metrics.find((m) => m.profileId === profile)
          ?.navigationAfterAcceptance,
    ],
    [
      "Acceptance visible on arrival",
      (v: typeof selected) =>
        v.metrics
          .find((m) => m.profileId === profile)
          ?.observations.find((o) => o.probeId === "acceptance-at-arrival")
          ?.visible,
    ],
    [
      "Acceptance fully in initial viewport",
      (v: typeof selected) =>
        v.metrics
          .find((m) => m.profileId === profile)
          ?.observations.find((o) => o.probeId === "acceptance-at-arrival")
          ?.inViewport,
    ],
    [
      "File revealed without further input",
      (v: typeof selected) =>
        v.metrics.find((m) => m.profileId === profile)?.automaticReveal,
    ],
    [
      "Audited states",
      (v) =>
        v.audits[profile]
          ? Object.values(v.audits[profile].states).filter(
              (entry) => entry.status === "audited",
            ).length
          : null,
      false,
    ],
    [
      "Page axe violations across state scans",
      (v) => auditTotals(v.audits[profile])?.violations,
      false,
    ],
    [
      "Page axe incomplete checks across state scans",
      (v) => auditTotals(v.audits[profile])?.incomplete,
      false,
    ],
  ];
  return (
    <>
      <header className="report-header">
        <a href="https://github.com/openuji/journey-mesh">Journey Mesh</a>
        <span>Nextcloud file acceptance report</span>
        <a href="./comparison.json" download>
          Download evidence JSON
        </a>
      </header>
      <main>
        <section className="intro">
          <h1>{data.title}</h1>
          <p>
            Alice shares <strong>report.pdf</strong> across two Nextcloud
            instances. Bob starts at <strong>All files</strong>. Compare the
            navigation needed to find, accept, and reach the file.
          </p>
          <p className="context">
            This compares Nextcloud 34.0.2 with a pinned Nextcloud 36
            development build. Direct UI checks establish the observed behavior;
            other differences can include changes between versions.{" "}
            <a href={data.contextUrl}>PR #66147 and motivation</a>.
          </p>
          <div className="provenance">
            <span>
              Generated{" "}
              <time dateTime={data.generatedAt}>{data.generatedAt}</time>
            </span>
            {data.workflowUrl && (
              <a href={data.workflowUrl}>Open workflow run</a>
            )}
          </div>
        </section>
        <section aria-labelledby="comparison-title">
          <div className="section-heading">
            <h2 id="comparison-title">Acceptance comparison</h2>
            <label>
              Interaction profile
              <select
                aria-label="Interaction profile"
                value={profile}
                onChange={(event) => select(version, event.target.value)}
              >
                {profiles.map((id) => (
                  <option key={id} value={id}>
                    {id === "default"
                      ? "Default"
                      : id === "keyboard-only"
                        ? "Keyboard only"
                        : id}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="table-scroll">
            <table>
              <caption>Automated journey measurements · {profile}</caption>
              <thead>
                <tr>
                  <th scope="col">Measurement</th>
                  {data.variants.map((v) => (
                    <th scope="col" key={v.variant.id}>
                      {v.variant.label}
                      <span className={`status ${profileStatus(v, profile)}`}>
                        {profileStatus(v, profile)}
                      </span>
                    </th>
                  ))}
                  <th scope="col">Change</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(([label, get, compare]) => {
                  const values = data.variants.map((v) => get(v));
                  const [before, after] = values;
                  return (
                    <tr key={label}>
                      <th scope="row">{label}</th>
                      {values.map((value, index) => (
                        <td key={data.variants[index].variant.id}>
                          {display(value)}
                        </td>
                      ))}
                      <td>
                        {compare === false
                          ? "Different scan coverage"
                          : typeof before === "number" &&
                              typeof after === "number"
                            ? `${after - before > 0 ? "+" : ""}${after - before}`
                            : before != null && after != null
                              ? before === after
                                ? "Unchanged"
                                : `${display(before)} → ${display(after)}`
                              : "Not measured"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="note">
            Counts cover the recipient’s executed journey. Acceptance and
            completion are measured separately: a verified acceptance can
            precede a failed UI continuation. Setup, assertions, audits, and
            automatic continuations are excluded. Missing or incomplete
            measurements stay “Not measured.” Axe totals include repeated
            findings across scans.
          </p>
        </section>
        <section aria-labelledby="journey-title">
          <div className="section-heading">
            <h2 id="journey-title">Inspect the journey</h2>
            <label>
              Nextcloud version
              <select
                aria-label="Nextcloud version"
                value={selected.variant.id}
                onChange={(event) => select(event.target.value, profile)}
              >
                {data.variants.map((v) => (
                  <option key={v.variant.id} value={v.variant.id}>
                    {v.variant.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p
            className={`run-status ${profileStatus(selected, profile)}`}
            role="status"
          >
            {selected.variant.label} · {profile}:{" "}
            {profileStatus(selected, profile)}. Overall run: {selected.status}.{" "}
            {selected.run?.error ??
              selected.reportingErrors.map((e) => e.message).join("; ")}
          </p>
          <p className="note">
            The diagram shows the planned journey and recorded accessibility
            scans. The operation log below distinguishes passed, failed, and
            unexecuted steps. Select a state’s preview to inspect its
            screenshot.
          </p>
          <div className="path" key={`${selected.variant.id}/${profile}`}>
            <ResponsiveJourneyPath breakpoint={900}>
              <JourneyPathYaml
                source={selected.model}
                ariaLabel={`${selected.variant.label}, ${profile}, planned acceptance journey`}
                accessibilityDocument={
                  audit as JourneyPathPreviewData | undefined
                }
                touchpointControls={{
                  "urn:touchpoint:nextcloud-a": <WebTouchpoint label="Nextcloud A" />,
                  "urn:touchpoint:nextcloud-b": <WebTouchpoint label="Nextcloud B" />,
                }}
              />
            </ResponsiveJourneyPath>
          </div>
          <p className="note">
            Diagram legend: P = page scan; S = matched-surface scan; V =
            violations; I = incomplete checks. CLEAN means zero violations and
            incomplete checks in that scan.
          </p>
          <details className="operation-log" open>
            <summary>Operation outcomes and screenshots</summary>
            <ol>
              {path.map((item) => {
                const stateAudit = audit?.states[item.id];
                const status = operationStatus(
                  selected.result,
                  profile,
                  item.id,
                );
                return (
                  <li key={item.id}>
                    <div>
                      <span className="kind">{item.kind}</span>
                      <strong>{item.label}</strong>
                      <span className={`status ${status}`}>{status}</span>
                    </div>
                    {status === "failed" && (
                      <p className="failure">
                        {operationError(selected.result, profile, item.id)}
                      </p>
                    )}
                    {stateAudit?.sourceScreenshotHref && (
                      <details>
                        <summary>Screenshot and audit</summary>
                        <a href={stateAudit.sourceScreenshotHref}>
                          <img
                            src={stateAudit.sourceScreenshotHref}
                            loading="lazy"
                            alt={`Captured interface: ${item.label}`}
                          />
                        </a>
                        {stateAudit.sourceHtmlHref && (
                          <a href={stateAudit.sourceHtmlHref}>
                            Open state audit
                          </a>
                        )}
                      </details>
                    )}
                  </li>
                );
              })}
            </ol>
          </details>
        </section>
        <section aria-labelledby="source-title">
          <h2 id="source-title">Deployment and evidence</h2>
          <dl className="deployment">
            <div>
              <dt>Image</dt>
              <dd>
                <code>{selected.variant.image}</code>
              </dd>
            </div>
            {selected.variant.sourceSha && (
              <div>
                <dt>Source commit</dt>
                <dd>
                  <a
                    href={`https://github.com/nextcloud/server/commit/${selected.variant.sourceSha}`}
                  >
                    <code>{selected.variant.sourceSha}</code>
                  </a>
                </dd>
              </div>
            )}
            <div>
              <dt>Verified services</dt>
              <dd>
                {selected.deployment?.services.map((service) => (
                  <p key={service.service}>
                    {service.service}: {service.version} ·{" "}
                    <code>{service.imageId}</code>
                  </p>
                )) ?? "Deployment was not verified."}
              </dd>
            </div>
            <div>
              <dt>Run time</dt>
              <dd>{selected.run?.startedAt ?? "No run recorded"}</dd>
            </div>
          </dl>
          {selected.result && (
            <p>
              <a href={`./evidence/${selected.variant.id}/ujg-evidence.json`}>
                Functional evidence
              </a>{" "}
              ·{" "}
              <a href={`./evidence/${selected.variant.id}/ux-metrics.json`}>
                UX metrics
              </a>{" "}
              ·{" "}
              <a
                href={`./evidence/${selected.variant.id}/nextcloud-filesharing.axe-path.html`}
              >
                Browser axe report
              </a>
            </p>
          )}
          <p className="note">
            Automated observations support journey review. Accessibility
            findings require review. This report covers browser file acceptance
            with default and keyboard activation profiles.
          </p>
        </section>
      </main>
      <footer>
        <a href="https://github.com/openuji/journey-mesh">
          Source and methodology
        </a>
        <a href="./comparison.json">Report data</a>
      </footer>
    </>
  );
}

function App() {
  const [data, setData] = useState<ComparisonReportData>();
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    fetch("./comparison.json", { signal: abort.signal })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            `Report data could not be loaded (${response.status}).`,
          );
        const document = await response.json();
        if (
          document.format !== "journey-mesh/comparison-report/v1" ||
          !document.variants?.length
        )
          throw new Error("Report data has an unsupported format.");
        setData(document);
      })
      .catch((reason) => {
        if (!abort.signal.aborted) setError(reason.message);
      });
    return () => abort.abort();
  }, [attempt]);
  return data ? (
    <Report data={data} />
  ) : (
    <main>
      <h1>Nextcloud acceptance comparison</h1>
      <p role="status">{error ?? "Loading report data…"}</p>
      {error && (
        <button
          onClick={() => {
            setError(undefined);
            setAttempt(attempt + 1);
          }}
        >
          Retry loading report
        </button>
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
