import { Brain, Check, ChevronDown, Eye, Gauge, LockKeyhole, Power, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ReasoningEffort, ThinkingSettings } from "../../types/settings";

interface ThinkingModeControlsProps {
  onChange: (settings: ThinkingSettings) => void;
  settings: ThinkingSettings;
  variant?: "chip" | "panel";
}

const effortOptions: Array<{ detail: string; label: string; value: ReasoningEffort }> = [
  { detail: "Fast passes", label: "Low", value: "low" },
  { detail: "Adaptive", label: "Medium", value: "medium" },
  { detail: "Deep work", label: "High", value: "high" },
];

function formatEffort(effort: ReasoningEffort) {
  return effort.charAt(0).toUpperCase() + effort.slice(1);
}

export function ThinkingModeControls({ onChange, settings, variant = "chip" }: ThinkingModeControlsProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function updateSettings(nextSettings: Partial<ThinkingSettings>) {
    onChange({
      ...settings,
      ...nextSettings,
    });
  }

  if (variant === "panel") {
    return (
      <div className="thinking-panel">
        <ThinkingOptions onChange={updateSettings} settings={settings} />
      </div>
    );
  }

  return (
    <div ref={rootRef} className="composer-menu-anchor thinking-mode-root">
      <button
        className="mode-chip mode-chip-thinking"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        data-active={open || settings.enabled}
        onClick={() => setOpen((current) => !current)}
      >
        <Sparkles size={16} aria-hidden="true" />
        <span>{settings.enabled ? "Thinking" : "Thinking off"}</span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      {open ? (
        <div className="composer-popover thinking-popover" role="menu" aria-label="Thinking mode">
          <ThinkingOptions
            onChange={(nextSettings) => {
              updateSettings(nextSettings);
            }}
            settings={settings}
          />
        </div>
      ) : null}
    </div>
  );
}

interface ThinkingOptionsProps {
  onChange: (settings: Partial<ThinkingSettings>) => void;
  settings: ThinkingSettings;
}

function ThinkingOptions({ onChange, settings }: ThinkingOptionsProps) {
  return (
    <div className="thinking-options">
      <div className="thinking-popover-header">
        <span className="thinking-popover-orb" aria-hidden="true">
          <Brain size={18} />
        </span>
        <span>
          <strong>Thinking</strong>
          <small>{settings.enabled ? `${formatEffort(settings.effort)} depth selected` : "Off for the next message"}</small>
        </span>
        <button
          className="thinking-power"
          type="button"
          role="switch"
          aria-checked={settings.enabled}
          aria-label={settings.enabled ? "Turn thinking off" : "Turn thinking on"}
          data-on={settings.enabled}
          onClick={() => onChange({ enabled: !settings.enabled })}
        >
          <Power size={15} aria-hidden="true" />
        </button>
      </div>

      <div className="thinking-field-row">
        <span>
          <Gauge size={14} aria-hidden="true" />
          Depth
        </span>
        <small>{settings.enabled ? "Dynamic budget" : "Paused"}</small>
      </div>

      <div className="thinking-effort-grid" role="radiogroup" aria-label="Reasoning effort">
        {effortOptions.map((option) => {
          const selected = settings.enabled && settings.effort === option.value;

          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              data-selected={selected}
              onClick={() => onChange({ enabled: true, effort: option.value })}
            >
              <strong>{option.label}</strong>
              <small>{option.detail}</small>
            </button>
          );
        })}
      </div>

      <button
        className="thinking-trace-toggle"
        type="button"
        role="menuitemcheckbox"
        aria-checked={settings.showReasoning}
        onClick={() => onChange({ showReasoning: !settings.showReasoning })}
      >
        {settings.showReasoning ? <Eye size={18} aria-hidden="true" /> : <LockKeyhole size={18} aria-hidden="true" />}
        <span>
          <strong>{settings.showReasoning ? "Trace visible" : "Trace private"}</strong>
          <small>{settings.showReasoning ? "Show reasoning under responses." : "Keep reasoning out of the thread."}</small>
        </span>
        {settings.showReasoning ? <Check size={18} aria-hidden="true" /> : null}
      </button>
    </div>
  );
}
