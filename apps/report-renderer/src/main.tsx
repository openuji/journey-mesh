import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { loadReportModel, type LoadedReport } from "@openuji/journey-reporter/model";
import { readJson } from "./json-document.js";
import { Report } from "./Report.js";
import { hrefToUrl } from "./ui.js";
import "./style.css";

/** The viewer is served next to a run (or comparison) directory and reads only its report model and evidence. */
function App() {
  const [report, setReport] = useState<LoadedReport>();
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const requests = new Map<string, Promise<Uint8Array>>();
    const read = (href: string) => {
      let request = requests.get(href);
      if (!request) {
        request = fetch(`./${hrefToUrl(href)}`, { signal: controller.signal }).then(async (response) => {
          if (!response.ok) throw new Error(`Report data ${href} could not be loaded (${response.status}).`);
          return new Uint8Array(await response.arrayBuffer());
        }).catch((reason) => { requests.delete(href); throw reason; });
        requests.set(href, request);
      }
      return request;
    };
    loadReportModel((href) => readJson(read, href)).then(setReport).catch((reason) => {
      if (!controller.signal.aborted) setError(location.protocol === "file:" ? "Serve this directory over HTTP (pnpm --filter @openuji/report-renderer serve <run-directory>) to load its data." : reason.message);
    });
    return () => controller.abort();
  }, [attempt]);
  return report ? <Report report={report} /> : <main className="page"><h1>Journey Mesh report</h1><p role="status">{error ?? "Loading report data…"}</p>{error && <button onClick={() => { setError(undefined); setAttempt(attempt + 1); }}>Retry loading report</button>}</main>;
}
createRoot(document.getElementById("root")!).render(<App />);
