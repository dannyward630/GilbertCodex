import type { CodingRiskLevel, VerificationPlanItem } from "../../types/coding";

export function RiskPill({ level }: { level?: CodingRiskLevel }) {
  return <span className="coding-risk-pill" data-risk={level ?? "low"}>{level ?? "low"}</span>;
}

export function StatusPill({ status }: { status?: string }) {
  return <span className="coding-status-pill" data-status={status ?? "unknown"}>{status ?? "unknown"}</span>;
}

export function EmptyCodingState({ detail, title }: { detail: string; title: string }) {
  return (
    <div className="coding-empty-state">
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}

export function formatCount(value?: number) {
  return new Intl.NumberFormat().format(value ?? 0);
}

export function formatRelativeTime(value?: string) {
  if (!value) return "not captured";

  const then = Date.parse(value);
  if (!Number.isFinite(then)) return value;

  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return "just now";

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;

  return `${Math.round(hours / 24)}d ago`;
}

export function verificationStatusTone(status: VerificationPlanItem["status"]) {
  if (status === "passed") return "passed";
  if (status === "failed") return "failed";
  if (status === "recommended") return "recommended";
  return "unknown";
}
