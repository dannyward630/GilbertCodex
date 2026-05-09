import { Activity, CircleDot } from "lucide-react";
import { StatusPill } from "../status/StatusPill";
import type { AppInfo } from "../../types/app";

interface ShellHeaderProps {
  appInfo: AppInfo;
}

export function ShellHeader({ appInfo }: ShellHeaderProps) {
  return (
    <header className="shell-header">
      <div>
        <p className="eyebrow">{appInfo.phase}</p>
        <h1>{appInfo.name}</h1>
      </div>
      <div className="header-status">
        <StatusPill icon={CircleDot} label={appInfo.version} tone="neutral" />
        <StatusPill icon={Activity} label={appInfo.runtime} tone="ready" />
      </div>
    </header>
  );
}
