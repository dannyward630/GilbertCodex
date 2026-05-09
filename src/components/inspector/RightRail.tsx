import { BookOpenText, CircleCheck, FileCode2, Globe2, LoaderCircle, LockKeyhole, Pin, Sparkles, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { formatThinkingDuration, splitThinkingContent } from "../../lib/thinkingActivity";
import type { ChatMessage, ChatSummary } from "../../types/chat";

const progressItems = [
  "Revamp desktop chrome",
  "Build chat-first layout",
  "Add Codex-style sidebar",
  "Wire right rail surfaces",
];

const artifactItems: RailItem[] = [
  {
    detail: "127.0.0.1:1420",
    icon: Globe2,
    label: "Local preview",
  },
  {
    detail: "Thinking, activity rail, composer",
    icon: FileCode2,
    label: "UI changes",
  },
];

const sourceItems: RailItem[] = [
  {
    detail: "Reference screenshots and current request",
    icon: BookOpenText,
    label: "Conversation brief",
  },
  {
    detail: "React/Tauri chat components",
    icon: FileCode2,
    label: "Workspace code",
  },
];

interface RailItem {
  detail: string;
  icon: LucideIcon;
  label: string;
}

interface RightRailProps {
  chat: ChatSummary;
  hasActivity?: boolean;
  onClose?: () => void;
}

export function RightRail({ chat, hasActivity = false, onClose }: RightRailProps) {
  const activityMessage = getLatestThinkingMessage(chat);
  const isThinkingLive = Boolean(activityMessage?.thinking && !activityMessage.thinking.completedAt);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!isThinkingLive) {
      return;
    }

    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isThinkingLive]);

  return (
    <aside className="right-rail" data-active={hasActivity} data-mode={activityMessage ? "activity" : "inspector"} aria-label="Conversation details">
      {activityMessage ? <ActivityCard message={activityMessage} now={now} onClose={onClose} /> : null}
      {!activityMessage ? (
        <section className="rail-card">
          <div className="rail-heading">
            <h2>Progress</h2>
            <Pin size={16} aria-hidden="true" />
          </div>
          <div className="progress-list rail-card-scroll">
            {progressItems.map((item) => (
              <span key={item}>
                <CircleCheck size={16} aria-hidden="true" />
                {item}
              </span>
            ))}
          </div>
        </section>
      ) : null}
      <RailSection items={artifactItems} title="Artifacts" />
      <RailSection items={sourceItems} title="Sources" />
    </aside>
  );
}

interface ActivityCardProps {
  message: ChatMessage;
  now: number;
  onClose?: () => void;
}

function ActivityCard({ message, now, onClose }: ActivityCardProps) {
  const isThinkingLive = Boolean(message.thinking && !message.thinking.completedAt);
  const isWritingResponse = Boolean(message.isStreaming && !isThinkingLive);
  const startedAt = message.thinking?.startedAt ?? message.createdAt;
  const completedAt = isThinkingLive ? undefined : message.thinking?.completedAt ?? message.createdAt;
  const duration = formatThinkingDuration(startedAt, completedAt, now);
  const traceSegments = splitThinkingContent(message.reasoning);
  const hasTrace = traceSegments.length > 0;
  const statusLabel = isThinkingLive ? "Thinking" : `Thought for ${duration}`;
  const detailLabel = isThinkingLive ? "Working through the response" : message.status === "error" ? "Stopped with an error" : isWritingResponse ? "Writing response" : "Done";

  return (
    <section className="activity-card" aria-labelledby="activity-panel-title">
      <div className="activity-header">
        <h2 id="activity-panel-title">
          Activity <span>{isThinkingLive ? `- ${duration}` : "- Done"}</span>
        </h2>
        <button className="rail-close" type="button" aria-label="Close activity" onClick={onClose}>
          <X size={17} aria-hidden="true" />
        </button>
      </div>

      <div className="activity-section">
        <h3>Thinking</h3>
        <div className="activity-status-row" data-live={isThinkingLive}>
          <span className="activity-status-icon" aria-hidden="true">
            {isThinkingLive ? <LoaderCircle size={16} /> : <CircleCheck size={16} />}
          </span>
          <span>
            <strong>{statusLabel}</strong>
            <small>{detailLabel}</small>
          </span>
        </div>

        {isThinkingLive && !hasTrace ? (
          <div className="activity-live-lines" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        ) : null}

        {!isThinkingLive && !hasTrace ? (
          <div className="activity-private-card">
            <LockKeyhole size={17} aria-hidden="true" />
            <span>
              <strong>Trace hidden</strong>
              <small>Reasoning stayed private for this response.</small>
            </span>
          </div>
        ) : null}

        {hasTrace ? (
          <div className="activity-trace-list">
            {traceSegments.map((segment, index) => (
              <article className="activity-trace-item" key={`${index}-${segment.slice(0, 24)}`}>
                <p>{segment}</p>
              </article>
            ))}
          </div>
        ) : null}
      </div>

      <div className="activity-footer">
        <Sparkles size={14} aria-hidden="true" />
        <span>{message.thinking ? `${formatEffort(message.thinking.effort)} depth` : "Reasoning capture"}</span>
      </div>
    </section>
  );
}

interface RailSectionProps {
  items: RailItem[];
  title: string;
}

function RailSection({ items, title }: RailSectionProps) {
  return (
    <section className="rail-card rail-card-compact">
      <div className="rail-heading">
        <h2>{title}</h2>
      </div>
      <div className="rail-row-list rail-card-scroll">
        {items.map((item) => {
          const Icon = item.icon;

          return (
            <button className="rail-row rail-row-stacked" key={`${title}-${item.label}`} type="button" disabled>
              <Icon size={16} aria-hidden="true" />
              <span>
                <strong>{item.label}</strong>
                <small>{item.detail}</small>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function getLatestThinkingMessage(chat: ChatSummary) {
  return [...chat.messages]
    .reverse()
    .find(
      (message) =>
        message.role === "assistant" &&
        Boolean(message.isStreaming || message.reasoning?.trim() || message.thinking?.startedAt || message.thinking?.completedAt),
    );
}

function formatEffort(effort: string) {
  return effort.charAt(0).toUpperCase() + effort.slice(1);
}
