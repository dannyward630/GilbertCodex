import { ChevronRight, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { formatThinkingDuration } from "../../lib/thinkingActivity";

interface ThinkingDisclosureProps {
  completedAt?: string;
  content?: string;
  isPrivate?: boolean;
  isThinking?: boolean;
  onOpenActivity?: () => void;
  startedAt?: string;
}

export function ThinkingDisclosure({
  completedAt,
  content,
  isPrivate = false,
  isThinking = false,
  onOpenActivity,
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

  const summary = isThinking ? "Thinking..." : `Thought for ${formatThinkingDuration(startedAt, completedAt, now)}`;
  const traceLabel = hasTrace ? "Open thinking activity" : "Trace private";

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
        <span className="thinking-inline-title">{summary}</span>
        <ChevronRight className="thinking-inline-chevron" size={15} aria-hidden="true" />
      </button>
    </section>
  );
}
