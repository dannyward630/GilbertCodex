import { useEffect, useId, useRef, type FormEvent, type ReactNode } from "react";
import { AlertTriangle, Info, X, type LucideIcon } from "lucide-react";

type DialogTone = "default" | "danger";

interface DialogShellProps {
  actions?: ReactNode;
  children?: ReactNode;
  description?: string;
  icon?: LucideIcon;
  onClose: () => void;
  open: boolean;
  title: string;
  tone?: DialogTone;
}

export function DialogShell({ actions, children, description, icon: Icon = Info, onClose, open, title, tone = "default" }: DialogShellProps) {
  const titleId = useId();
  const descriptionId = description ? `${titleId}-description` : undefined;
  const dialogRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  useEffect(() => {
    if (open) {
      const activeElement = document.activeElement;

      if (activeElement instanceof HTMLElement && dialogRef.current?.contains(activeElement)) {
        return;
      }

      dialogRef.current?.focus();
    }
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        className="app-dialog"
        data-tone={tone}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="dialog-header">
          <span className="dialog-icon" aria-hidden="true">
            <Icon size={20} />
          </span>
          <div>
            <h2 id={titleId}>{title}</h2>
            {description ? <p id={descriptionId}>{description}</p> : null}
          </div>
          <button className="dialog-close" type="button" aria-label="Close dialog" onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        {children ? <div className="dialog-content">{children}</div> : null}
        {actions ? <div className="dialog-actions">{actions}</div> : null}
      </section>
    </div>
  );
}

interface ConfirmDialogProps {
  cancelLabel?: string;
  children?: ReactNode;
  confirmLabel: string;
  description?: string;
  icon?: LucideIcon;
  onClose: () => void;
  onConfirm: () => void;
  open: boolean;
  title: string;
  tone?: DialogTone;
}

export function ConfirmDialog({
  cancelLabel = "Cancel",
  children,
  confirmLabel,
  description,
  icon,
  onClose,
  onConfirm,
  open,
  title,
  tone = "default",
}: ConfirmDialogProps) {
  const DialogIcon = icon ?? (tone === "danger" ? AlertTriangle : Info);

  return (
    <DialogShell
      description={description}
      icon={DialogIcon}
      onClose={onClose}
      open={open}
      title={title}
      tone={tone}
      actions={
        <>
          <button className="dialog-button" type="button" onClick={onClose}>
            {cancelLabel}
          </button>
          <button className="dialog-button dialog-button-primary" data-tone={tone} type="button" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </>
      }
    >
      {children}
    </DialogShell>
  );
}

interface NoticeDialogProps {
  buttonLabel?: string;
  children?: ReactNode;
  description?: string;
  icon?: LucideIcon;
  onClose: () => void;
  open: boolean;
  title: string;
}

export function NoticeDialog({ buttonLabel = "Got it", children, description, icon, onClose, open, title }: NoticeDialogProps) {
  return (
    <DialogShell
      description={description}
      icon={icon}
      onClose={onClose}
      open={open}
      title={title}
      actions={
        <button className="dialog-button dialog-button-primary" type="button" onClick={onClose}>
          {buttonLabel}
        </button>
      }
    >
      {children}
    </DialogShell>
  );
}

interface TextInputDialogProps {
  confirmLabel: string;
  description?: string;
  error?: string | null;
  label: string;
  onChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
  open: boolean;
  placeholder?: string;
  title: string;
  value: string;
}

export function TextInputDialog({
  confirmLabel,
  description,
  error,
  label,
  onChange,
  onClose,
  onSubmit,
  open,
  placeholder,
  title,
  value,
}: TextInputDialogProps) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit();
  }

  return (
    <DialogShell
      description={description}
      onClose={onClose}
      open={open}
      title={title}
      actions={
        <>
          <button className="dialog-button" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="dialog-button dialog-button-primary" type="submit" form="text-input-dialog-form">
            {confirmLabel}
          </button>
        </>
      }
    >
      <form id="text-input-dialog-form" className="dialog-form" onSubmit={handleSubmit}>
        <label>
          <span>{label}</span>
          <input autoFocus value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
        </label>
        {error ? <p className="dialog-error">{error}</p> : null}
      </form>
    </DialogShell>
  );
}
