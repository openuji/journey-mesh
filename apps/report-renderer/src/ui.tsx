import type { ReactNode } from "react";
import type { LoadedReport, Outcome } from "@openuji/journey-reporter/model";

/** Hrefs are file paths: every segment is percent-encoded to form a URL path. */
export const hrefToUrl = (href: string) => href.split("/").map(encodeURIComponent).join("/");
/** URL of a run-relative `href` of `report` (comparison subjects live below `subjects/<side>/`). */
export const fileUrl = (report: Pick<LoadedReport, "base">, href: string) => `./${hrefToUrl(report.base + href)}`;

export const display = (value: unknown) => value == null ? "Unavailable" : typeof value === "boolean" ? value ? "Yes" : "No" : String(value);

export function Errors({ items }: { items: readonly { message: string }[] }) {
  return items.length ? <ul className="errors">{items.map((item, index) => <li key={index}>{item.message}</li>)}</ul> : null;
}

const outcomeLabels: Record<Outcome, string> = { passed: "Passed", failed: "Failed", "not-executed": "Not executed", "not-applicable": "Not applicable" };
export function Status({ outcome }: { outcome: Outcome }) {
  return <span className={`status ${outcome}`}>{outcomeLabels[outcome]}</span>;
}

export function MetadataTable({ rows }: { rows: readonly (readonly [string, ReactNode])[] }) {
  return <table className="metadata"><tbody>{rows.map(([label, value]) => <tr key={label}><th scope="row">{label}</th><td>{value}</td></tr>)}</tbody></table>;
}

/**
 * Hash routing: `#test=…&profile=…` selects a test, `#data=…&format=…` opens one data document, and
 * `subject=baseline|candidate` scopes either to a comparison subject.
 */
export function hashParams(): URLSearchParams {
  return new URLSearchParams(location.hash.slice(1));
}
export const subjectOf = (report: Pick<LoadedReport, "base">) => /^subjects\/(baseline|candidate)\/$/.exec(report.base)?.[1];
const hash = (report: Pick<LoadedReport, "base">, params: Record<string, string | undefined>) => {
  const subject = subjectOf(report);
  return `#${new URLSearchParams(Object.entries({ ...(subject ? { subject } : {}), ...params }).filter((entry): entry is [string, string] => !!entry[1]))}`;
};
export const testHash = (report: Pick<LoadedReport, "base">, test: string, profile?: string) => hash(report, { test, profile });
export const dataHash = (report: Pick<LoadedReport, "base">, href: string, format?: string, label?: string) => hash(report, { data: href, format, label });
