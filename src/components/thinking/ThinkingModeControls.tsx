import { BrainCircuit, Check, ChevronDown } from "lucide-react";
import { useRef, useState } from "react";
import { useDismissableLayer } from "../../lib/useDismissableLayer";
import { formatReasoningEffort } from "../../types/settings";
import type { ReasoningEffort, ThinkingSettings } from "../../types/settings";

interface ThinkingModeControlsProps {
  disabledReason?: string;
  onChange: (settings: ThinkingSettings) => void;
  settings: ThinkingSettings;
  variant?: "chip" | "panel";
}

const effortOptions: Array<{ detail: string; label: string; value: ReasoningEffort }> = [
  { detail: "Quick passes", label: "Low", value: "low" },
  { detail: "Default Codex", label: "Medium", value: "medium" },
  { detail: "Hard tasks", label: "High", value: "high" },
];

function formatThinkingChipLabel(settings: ThinkingSettings) {
  if (!settings.enabled) {
    return "Reasoning";
  }

  return formatEffortOptionLabel(settings.effort);
}

function formatThinkingStatus(settings: ThinkingSettings) {
  return settings.enabled ? `${formatEffortOptionLabel(settings.effort)} reasoning` : "Reasoning off";
}

function formatEffortOptionLabel(effort: ReasoningEffort) {
  return effortOptions.find((option) => option.value === effort)?.label ?? formatReasoningEffort(effort);
}

export function ThinkingModeControls({ disabledReason, onChange, settings, variant = "chip" }: ThinkingModeControlsProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);

  useDismissableLayer({
    active: open,
    onDismiss: () => setOpen(false),
    refs: [rootRef],
  });

  function updateSettings(nextSettings: Partial<ThinkingSettings>) {
    if (disabledReason) {
      return;
    }

    onChange({
      ...settings,
      ...nextSettings,
    });
  }

  if (variant === "panel") {
    return (
      <div className="thinking-panel">
        <ThinkingOptions disabledReason={disabledReason} onChange={updateSettings} settings={settings} />
      </div>
    );
  }

  const chipFullLabel = formatThinkingStatus(settings);
  const chipLabel = formatThinkingChipLabel(settings);

  return (
    <div ref={rootRef} className="composer-menu-anchor thinking-mode-root">
      <button
        className="mode-chip mode-chip-thinking"
        type="button"
        aria-label={`Reasoning: ${chipFullLabel}`}
        aria-haspopup="menu"
        aria-expanded={open}
        data-active={open || settings.enabled}
        title={chipFullLabel}
        onClick={() => setOpen((current) => !current)}
      >
        <BrainCircuit size={16} aria-hidden="true" />
        <span>{chipLabel}</span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      {open ? (
        <div className="composer-popover thinking-popover" role="menu" aria-label="Reasoning">
          <ThinkingOptions
            disabledReason={disabledReason}
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
  disabledReason?: string;
  onChange: (settings: Partial<ThinkingSettings>) => void;
  settings: ThinkingSettings;
}

function ThinkingOptions({ disabledReason, onChange, settings }: ThinkingOptionsProps) {
  const disabled = Boolean(disabledReason);
  const status = disabledReason ?? formatThinkingStatus(settings);

  return (
    <div className="thinking-options" data-disabled={disabled || undefined} data-enabled={settings.enabled ? "true" : "false"}>
      <div className="thinking-popover-header">
        <span className="thinking-popover-orb" data-on={settings.enabled && !disabled ? "true" : undefined} aria-hidden="true">
          <BrainCircuit size={17} />
        </span>
        <span>
          <strong>Reasoning</strong>
          <small>{status}</small>
        </span>
        <button
          className="thinking-power"
          type="button"
          role="switch"
          aria-checked={settings.enabled}
          aria-label={disabledReason ?? (settings.enabled ? "Turn reasoning off" : "Turn reasoning on")}
          data-on={settings.enabled && !disabled}
          disabled={disabled}
          onClick={() => onChange({ enabled: !settings.enabled })}
        >
          <span>{settings.enabled ? "On" : "Off"}</span>
        </button>
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
              disabled={disabled}
              onClick={() => onChange({ enabled: true, effort: option.value })}
            >
              <span>
                <strong>{option.label}</strong>
                <small>{option.detail}</small>
              </span>
              {selected ? <Check size={14} aria-hidden="true" /> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
