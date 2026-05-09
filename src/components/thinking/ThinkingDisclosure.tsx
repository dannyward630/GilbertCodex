import { ChevronRight, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { formatThinkingDuration } from "../../lib/thinkingActivity";

interface ThinkingDisclosureProps {
  activityMode?: "planning" | "thinking";
  completedAt?: string;
  content?: string;
  isPrivate?: boolean;
  isThinking?: boolean;
  onOpenActivity?: () => void;
  progressLabel?: string;
  startedAt?: string;
}

export function ThinkingDisclosure({
  activityMode = "thinking",
  completedAt,
  content,
  isPrivate = false,
  isThinking = false,
  onOpenActivity,
  progressLabel,
  startedAt,
}: ThinkingDisclosureProps) {
  const [now, setNow] = useState(Date.now());
  const hasTrace = Boolean(content?.trim());
  const hasThinkingRecord = Boolean(startedAt || completedAt || hasTrace || isThinking || isPrivate);

  useEffect(() => {
    if (!isThinking) {
      return;
    }

    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isThinking]);

  if (!hasThinkingRecord) {
    return null;
  }

  const liveLabel = activityMode === "planning" ? "Planning..." : "Thinking...";
  const doneLabel =
    activityMode === "planning" ? `Planned for ${formatThinkingDuration(startedAt, completedAt, now)}` : `Thought for ${formatThinkingDuration(startedAt, completedAt, now)}`;
  const summary = isThinking ? liveLabel : doneLabel;
  const traceLabel = "Open activity";

  function handleSummaryClick() {
    onOpenActivity?.();
  }

  return (
    <section className="thinking-disclosure" data-live={isThinking} data-private={isPrivate && !hasTrace}>
      <button
        className="thinking-compact-summary"
        type="button"
        aria-label={`${summary}. ${traceLabel}`}
        onClick={handleSummaryClick}
      >
        {isThinking ? (
          <span className="thinking-inline-status" aria-hidden="true">
            <LoaderCircle size={15} />
          </span>
        ) : null}
        <span className="thinking-inline-title">{progressLabel && isThinking ? `${summary} ${progressLabel}` : summary}</span>
        <ChevronRight className="thinking-inline-chevron" size={15} aria-hidden="true" />
      </button>
    </section>
  );
}
