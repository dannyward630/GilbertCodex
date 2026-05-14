import { Brain, ChevronDown, Eye, Gauge, Power, Sparkles } from "lucide-react";
import { useRef, useState } from "react";
import { useDismissableLayer } from "../../lib/useDismissableLayer";
import { DEEP_RESEARCH_REASONING_EFFORT, formatReasoningEffort } from "../../types/settings";
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
  { detail: "Broad research", label: "Deep Research", value: "xhigh" },
];

function formatThinkingChipLabel(settings: ThinkingSettings) {
  if (!settings.enabled) {
    return "Think";
  }

  if (settings.effort === DEEP_RESEARCH_REASONING_EFFORT) {
    return "Research";
  }

  return formatReasoningEffort(settings.effort);
}

export function ThinkingModeControls({ onChange, settings, variant = "chip" }: ThinkingModeControlsProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);

  useDismissableLayer({
    active: open,
    onDismiss: () => setOpen(false),
    refs: [rootRef],
  });

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

  const chipFullLabel = settings.enabled ? formatReasoningEffort(settings.effort) : "Thinking off";
  const chipLabel = formatThinkingChipLabel(settings);

  return (
    <div ref={rootRef} className="composer-menu-anchor thinking-mode-root">
      <button
        className="mode-chip mode-chip-thinking"
        type="button"
        aria-label={`Thinking mode: ${chipFullLabel}`}
        aria-haspopup="menu"
        aria-expanded={open}
        data-active={open || settings.enabled}
        title={chipFullLabel}
        onClick={() => setOpen((current) => !current)}
      >
        <Sparkles size={16} aria-hidden="true" />
        <span>{chipLabel}</span>
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
          <small>{settings.enabled ? `${formatReasoningEffort(settings.effort)} depth selected` : "Off for the next message"}</small>
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
        <small>{settings.enabled ? "Adaptive depth" : "Paused"}</small>
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

      <div className="thinking-trace-note" role="note">
        <Eye size={18} aria-hidden="true" />
        <span>
          <strong>Trace when available</strong>
          <small>Gilbert requests provider reasoning and shows it when the provider streams or returns it.</small>
        </span>
      </div>
    </div>
  );
}
