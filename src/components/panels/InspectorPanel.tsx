import { Database, Layers3, Network } from "lucide-react";

export function InspectorPanel() {
  return (
    <section className="workspace-panel inspector-panel" aria-labelledby="inspector-panel-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Inspector</p>
          <h2 id="inspector-panel-title">Phase map</h2>
        </div>
      </div>
      <div className="roadmap-list">
        <span>
          <Network size={16} aria-hidden="true" />
          OpenRouter provider
        </span>
        <span>
          <Layers3 size={16} aria-hidden="true" />
          In-house job runtime
        </span>
        <span>
          <Database size={16} aria-hidden="true" />
          Docker-backed storage
        </span>
      </div>
    </section>
  );
}
