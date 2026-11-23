import { useEffect, useState, type ComponentType } from "react";
import type { LoadedReport } from "@openuji/journey-reporter/model";
import { fileUrl, subjectOf } from "../ui.js";
import { AndroidReport } from "./AndroidReport.js";
import { AxeAuditReport } from "./AxeAuditReport.js";
import { AxePathReport } from "./AxePathReport.js";
import { OperabilityReport } from "./OperabilityReport.js";

export type DataView = ComponentType<{ value: unknown; report: LoadedReport }>;

/** Renderers by data `format`. Add an entry to render a new observer's data; unknown formats get a JSON view. */
export const dataViews: Readonly<Record<string, DataView>> = {
  "journey-mesh/axe-path": AxePathReport,
  "journey-mesh/axe-audit": AxeAuditReport,
  "journey-mesh/android-accessibility": AndroidReport,
  "journey-mesh/operability": OperabilityReport
};

/** One data document of the report or of the run's evidence, rendered by its format. */
export function DataPage({ report, href, format, label }: { report: LoadedReport; href: string; format?: string; label?: string }) {
  const [value, setValue] = useState<unknown>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let cancelled = false;
    setValue(undefined); setError(undefined);
    report.readJson(href).then((data) => { if (!cancelled) setValue(data); }).catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { cancelled = true; };
  }, [report, href]);
  useEffect(() => {
    const node = new URLSearchParams(location.hash.slice(1)).get("node");
    if (value !== undefined && node) { const element = document.getElementById(node); if (element instanceof HTMLDetailsElement) element.open = true; element?.scrollIntoView(); }
  }, [value]);
  const resolved = format ?? (value && typeof value === "object" && typeof (value as { format?: unknown }).format === "string" ? (value as { format: string }).format : undefined);
  const View = resolved ? dataViews[resolved] : undefined;
  return <section className="data-page" data-format={resolved}>
    <p><a href={subjectOf(report) ? `#subject=${subjectOf(report)}` : "#"}>Back to report</a> · <a href={fileUrl(report, href)} download>Download JSON</a></p>
    {error ? <p role="alert">{error}</p> : value === undefined ? <p role="status">Loading {label ?? href}…</p>
      : View ? <View value={value} report={report} /> : <><h1>{label ?? href}</h1><pre>{JSON.stringify(value, null, 2)}</pre></>}
  </section>;
}
