import { ExternalLink, Globe2 } from "lucide-react";

interface ArtifactCardProps {
  detail: string;
  onOpen?: () => void;
  title: string;
}

export function ArtifactCard({ detail, onOpen, title }: ArtifactCardProps) {
  return (
    <div className="artifact-card">
      <div className="artifact-icon">
        <Globe2 size={20} aria-hidden="true" />
      </div>
      <div>
        <strong>{title}</strong>
        <span>{detail}</span>
      </div>
      <button type="button" aria-label={`Open ${title}`} disabled={!onOpen} onClick={onOpen}>
        <ExternalLink size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
