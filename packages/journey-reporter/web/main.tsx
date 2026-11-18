import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Report } from "./Report.js";
import { openReport, type ReportHandle } from "../src/report-data.js";
import { artifactHref } from "../src/paths.js";
import "./style.css";

function App() {
  const [report, setReport] = useState<ReportHandle>();
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const requests = new Map<string, Promise<Uint8Array>>();
    openReport((ref) => {
      let request = requests.get(ref.href);
      if (!request) {
        request = fetch(`./${artifactHref(ref.href)}`, { signal: controller.signal }).then(async (response) => {
          if (!response.ok) throw new Error(`Report data ${ref.href} could not be loaded (${response.status}).`);
          return new Uint8Array(await response.arrayBuffer());
        }).catch((error) => { requests.delete(ref.href); throw error; });
        requests.set(ref.href, request);
      }
      return request;
    }).then(setReport).catch((reason) => { if (!controller.signal.aborted) setError(location.protocol === "file:" ? "Serve this report with journey-mesh report <directory> to load its manifest and data." : reason.message); });
    return () => controller.abort();
  }, [attempt]);
  return report ? <Report report={report} /> : <main className="page"><h1>Journey Mesh report</h1><p role="status">{error ?? "Loading report data…"}</p>{error && <button onClick={() => { setError(undefined); setAttempt(attempt + 1); }}>Retry loading report</button>}</main>;
}
createRoot(document.getElementById("root")!).render(<App />);
