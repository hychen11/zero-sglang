import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { Legend } from "./CodeBlock";
import "./styles.css";
import { trace } from "./types";
import { ArchitectureView } from "./views/ArchitectureView";
import { PipelineView } from "./views/PipelineView";
import { PlayerView } from "./views/PlayerView";
import { SourceView } from "./views/SourceView";
import { TimelineView } from "./views/TimelineView";

const VIEWS = {
  player: { label: "Request Player", render: () => <PlayerView /> },
  architecture: { label: "Architecture", render: () => <ArchitectureView /> },
  pipeline: { label: "Pipeline DAG", render: () => <PipelineView /> },
  timeline: { label: "Timeline", render: () => <TimelineView /> },
  source: { label: "Source", render: () => <SourceView /> },
} as const;
type ViewId = keyof typeof VIEWS;

function App() {
  const initial = window.location.hash.slice(1).split(":")[0];
  const [view, setViewState] = useState<ViewId>(initial in VIEWS ? (initial as ViewId) : "player");
  const setView = (id: ViewId) => {
    window.location.hash = id;
    setViewState(id);
  };
  return (
    <div className="app">
      <header className="topbar">
        <h1>SGLang-Omni · Qwen3-Omni core path</h1>
        <span className="meta">
          {trace.subject.request} · commit {trace.provenance.commit.slice(0, 10)}
        </span>
        <nav className="tabs">
          {(Object.keys(VIEWS) as ViewId[]).map((id) => (
            <button key={id} className={id === view ? "active" : ""} onClick={() => setView(id)}>
              {VIEWS[id].label}
            </button>
          ))}
        </nav>
        <Legend />
      </header>
      <main className="main">{VIEWS[view].render()}</main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
