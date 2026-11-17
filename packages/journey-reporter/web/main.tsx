import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Report, type ViewerBundle } from "./Report.js";
import "./style.css";

function App() {
  const [bundle, setBundle] = useState<ViewerBundle>();
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    // Published reports embed their bundle so they also open from disk; the dev server fetches it.
    const embedded = (window as { __JOURNEY_MESH_BUNDLE__?: ViewerBundle }).__JOURNEY_MESH_BUNDLE__;
    if (embedded && !attempt) { setBundle(embedded); return; }
    const controller = new AbortController();
    fetch("./bundle.json", { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error(`Report data could not be loaded (${response.status}).`);
      const data = await response.json();
      if (!data || !["suite", "comparison"].includes(data.kind)) throw new Error("The file does not contain a Journey Mesh result bundle.");
      setBundle(data);
    }).catch((reason) => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, [attempt]);
  return bundle ? <Report bundle={bundle} /> : <main className="page"><h1>Journey Mesh report</h1><p role="status">{error ?? "Loading report data…"}</p>{error && <button onClick={() => { setError(undefined); setAttempt(attempt + 1); }}>Retry loading report</button>}</main>;
}
createRoot(document.getElementById("root")!).render(<App />);
