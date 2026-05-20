import { Pencil, SendHorizontal, Trash2 } from "lucide-react";
import type { ChatMessage } from "../../../types/chat";

interface MessageSteeringQueueProps {
  heldMessageIds: ReadonlySet<string>;
  isGenerating: boolean;
  messages: ChatMessage[];
  onDeleteMessage: (messageId: string) => void;
  onEditMessage: (message: ChatMessage) => void;
  onHoldMessage: (messageId: string, held: boolean) => void;
  onSteerMessage: (messageId: string) => void;
}

export function MessageSteeringQueue({
  heldMessageIds,
  isGenerating,
  messages,
  onDeleteMessage,
  onEditMessage,
  onHoldMessage,
  onSteerMessage,
}: MessageSteeringQueueProps) {
  if (messages.length === 0) {
    return null;
  }

  function handleEdit(message: ChatMessage) {
    onHoldMessage(message.id, false);
    onEditMessage(message);
  }

  function handleDelete(messageId: string) {
    onHoldMessage(messageId, false);
    onDeleteMessage(messageId);
  }

  function handleSteer(messageId: string) {
    onHoldMessage(messageId, false);
    onSteerMessage(messageId);
  }

  return (
    <div className="composer-steering-tray" aria-label="Queued follow-up messages">
      {messages.map((message) => {
        const preview = formatQueuedMessagePreview(message);
        const held = heldMessageIds.has(message.id);
        const canSteer = isGenerating && message.content.trim().length > 0;

        return (
          <article className="composer-steering-row" data-held={held || undefined} key={message.id}>
            <span className="composer-steering-copy" title={preview}>
              <strong>{isGenerating ? "Ready to steer" : "Queued next"}</strong>
              <small>{preview}</small>
            </span>
            <span className="composer-steering-actions">
              {isGenerating ? (
                <button type="button" className="composer-steering-action composer-steering-action-primary" disabled={!canSteer} onClick={() => handleSteer(message.id)}>
                  <SendHorizontal size={13} aria-hidden="true" />
                  <span>Steer</span>
                </button>
              ) : null}
              <button type="button" className="composer-steering-icon" aria-label="Edit queued message in composer" title="Edit in composer" onClick={() => handleEdit(message)}>
                <Pencil size={13} aria-hidden="true" />
              </button>
              <button type="button" className="composer-steering-icon" aria-label="Remove queued message" title="Remove queued message" onClick={() => handleDelete(message.id)}>
                <Trash2 size={13} aria-hidden="true" />
              </button>
            </span>
          </article>
        );
      })}
    </div>
  );
}

function formatQueuedMessagePreview(message: ChatMessage) {
  const content = message.content.trim();

  if (content) {
    return content;
  }

  const attachmentCount = message.attachments?.length ?? 0;

  if (attachmentCount === 1) {
    return message.attachments?.[0]?.name || "1 attachment";
  }

  return `${attachmentCount} attachments`;
}
