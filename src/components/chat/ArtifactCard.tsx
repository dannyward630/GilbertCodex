import { ExternalLink, Globe2 } from "lucide-react";

export function ArtifactCard() {
  return (
    <div className="artifact-card">
      <div className="artifact-icon">
        <Globe2 size={20} aria-hidden="true" />
      </div>
      <div>
        <strong>Web preview</strong>
        <span>http://127.0.0.1:1420</span>
      </div>
      <button type="button" aria-label="Open preview">
        <ExternalLink size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
