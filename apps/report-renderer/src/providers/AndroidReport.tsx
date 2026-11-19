import type { AndroidAccessibilityReport } from "@openuji/journey-report-android";
import type { LoadedReport } from "@openuji/journey-reporter/model";
import { fileUrl } from "../ui.js";

/** Native hierarchy evidence per operation (format `journey-mesh/android-accessibility`). */
export function AndroidReport({ value, report }: { value: unknown; report: LoadedReport }) {
  const android = value as AndroidAccessibilityReport;
  return <article className="provider-report android">
    <h1>Android accessibility evidence</h1>
    <p>{android.runId} · {android.createdAt}</p>
    <ul>{android.limits.map((limit) => <li key={limit}>{limit}</li>)}</ul>
    <p>{android.summary.findings} potential findings; {android.summary.unassessed} unassessed checks.</p>
    <table><thead><tr><th scope="col">Profile / operation</th><th scope="col">Status</th><th scope="col">Evidence and checks</th></tr></thead><tbody>
      {android.items.map((item, index) => {
        const hierarchy = item.observation?.hierarchy?.kind === "captured" ? item.observation.hierarchy.value.artifact.href : undefined;
        const screenshot = item.observation?.screenshot?.kind === "captured" ? item.observation.screenshot.value.href : undefined;
        return <tr key={index}>
          <td>{item.profileId}<br /><code>{item.operationId}</code></td>
          <td>{item.status}{item.outcome?.kind === "failed" && <><br />Functional failure: {item.outcome.error.message}</>}</td>
          <td>{item.reason}
            {hierarchy && <> <a href={fileUrl(report, hierarchy)}>Hierarchy</a></>}
            {screenshot && <> · <a href={fileUrl(report, screenshot)}>Screenshot</a></>}
            <ul>{item.checks.filter((check) => check.status !== "passed").map((check, position) => <li key={position}>{check.rule} ({check.status}): {check.message}</li>)}</ul>
          </td>
        </tr>;
      })}
    </tbody></table>
  </article>;
}
