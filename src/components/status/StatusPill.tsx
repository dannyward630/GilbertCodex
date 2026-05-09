import type { LucideIcon } from "lucide-react";

interface StatusPillProps {
  icon: LucideIcon;
  label: string;
  tone: "neutral" | "ready";
}

export function StatusPill({ icon: Icon, label, tone }: StatusPillProps) {
  return (
    <span className="status-pill" data-tone={tone}>
      <Icon size={15} aria-hidden="true" />
      {label}
    </span>
  );
}
