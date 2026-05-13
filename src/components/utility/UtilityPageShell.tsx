import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export interface UtilityStatItem {
  count?: ReactNode;
  detail?: ReactNode;
  icon: LucideIcon;
  label: ReactNode;
  status?: ReactNode;
  value?: ReactNode;
}

interface UtilityPageShellProps {
  actions?: ReactNode;
  actionsLabel?: string;
  children: ReactNode;
  className?: string;
  eyebrow: string;
  stats?: UtilityStatItem[];
  statsLabel: string;
  title: string;
  titleId: string;
}

export function UtilityPageShell({
  actions,
  actionsLabel,
  children,
  className,
  eyebrow,
  stats,
  statsLabel,
  title,
  titleId,
}: UtilityPageShellProps) {
  const pageClassName = ["utility-page", className].filter(Boolean).join(" ");

  return (
    <div className={pageClassName}>
      <section className="utility-shell" aria-labelledby={titleId}>
        <header className="utility-header">
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h1 id={titleId}>{title}</h1>
          </div>
          {actions ? (
            <div className="utility-header-actions" aria-label={actionsLabel}>
              {actions}
            </div>
          ) : null}
        </header>

        {stats ? (
          <div className="utility-stat-grid" aria-label={statsLabel}>
            {stats.map((item) => {
              const Icon = item.icon;

              return (
                <article className="utility-stat-card" key={String(item.label)}>
                  <Icon size={18} aria-hidden="true" />
                  <span>{item.label}</span>
                  <strong>{item.value ?? item.count}</strong>
                  <small>{item.detail ?? item.status}</small>
                </article>
              );
            })}
          </div>
        ) : null}

        {children}
      </section>
    </div>
  );
}
