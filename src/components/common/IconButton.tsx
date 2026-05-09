import type { LucideIcon } from "lucide-react";

interface IconButtonProps {
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  icon: LucideIcon;
  muted?: boolean;
  onClick?: () => void;
  pressed?: boolean;
}

export function IconButton({ ariaLabel, className, disabled = false, icon: Icon, muted = false, onClick, pressed }: IconButtonProps) {
  const isDisabled = disabled || !onClick;

  return (
    <button
      className={className ? `icon-button ${className}` : "icon-button"}
      data-muted={muted || isDisabled}
      data-pressed={pressed}
      type="button"
      aria-label={ariaLabel}
      aria-pressed={pressed}
      disabled={isDisabled}
      title={ariaLabel}
      onClick={onClick}
    >
      <Icon size={17} aria-hidden="true" />
    </button>
  );
}
