import type { IosAccessibilityReport } from "@openuji/journey-report-ios";
import type { LoadedReport } from "@openuji/journey-reporter/model";
import { fileUrl } from "../ui.js";

/** Native iOS hierarchy evidence per operation (format `journey-mesh/ios-accessibility`). */
export function IosReport({ value, report }: { value: unknown; report: LoadedReport }) {
  const ios = value as IosAccessibilityReport;
  return (
    <article className="provider-report ios">
      <h1>iOS accessibility evidence</h1>
      <p>
        {ios.runId} · {ios.createdAt}
      </p>
      <ul>
        {ios.limits.map((limit) => (
          <li key={limit}>{limit}</li>
        ))}
      </ul>
      <p>
        {ios.summary.findings} potential findings; {ios.summary.unassessed} unassessed checks.
      </p>
      <table>
        <thead>
          <tr>
            <th scope="col">Profile / operation</th>
            <th scope="col">Status</th>
            <th scope="col">Evidence and checks</th>
          </tr>
        </thead>
        <tbody>
          {ios.items.map((item, index) => {
            const hierarchy =
              item.observation?.hierarchy?.kind === "captured" ? item.observation.hierarchy.value.artifact.href : undefined;
            const screenshot =
              item.observation?.screenshot?.kind === "captured" ? item.observation.screenshot.value.href : undefined;
            return (
              <tr key={index}>
                <td>
                  {item.profileId}
                  <br />
                  <code>{item.operationId}</code>
                </td>
                <td>
                  {item.status}
                  {item.outcome?.kind === "failed" && (
                    <>
                      <br />
                      Functional failure: {item.outcome.error.message}
                    </>
                  )}
                </td>
                <td>
                  {item.reason}
                  {hierarchy && (
                    <>
                      {" "}
                      <a href={fileUrl(report, hierarchy)}>Hierarchy</a>
                    </>
                  )}
                  {screenshot && (
                    <>
                      {" "}
                      · <a href={fileUrl(report, screenshot)}>Screenshot</a>
                    </>
                  )}
                  <ul>
                    {item.checks
                      .filter((check) => check.status !== "passed")
                      .map((check, position) => (
                        <li key={position}>
                          {check.rule} ({check.status}): {check.message}
                        </li>
                      ))}
                  </ul>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </article>
  );
}
