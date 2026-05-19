import { Trash2 } from "lucide-react";

import { DialogShell } from "./AppDialog";
import { formatChatAge, isEmptyChat, normalizeProjectName, sortChatsByUpdatedAt } from "../../lib/chatUtils";
import type { ChatSummary } from "../../types/chat";

interface BulkDeleteChatsDialogProps {
  chats: ChatSummary[];
  onClearSelection: () => void;
  onClose: () => void;
  onConfirm: () => void;
  onSelectAll: () => void;
  onToggleChat: (chatId: string) => void;
  open: boolean;
  selectedChatIds: string[];
  sendingChatIds: string[];
}

export function BulkDeleteChatsDialog({
  chats,
  onClearSelection,
  onClose,
  onConfirm,
  onSelectAll,
  onToggleChat,
  open,
  selectedChatIds,
  sendingChatIds,
}: BulkDeleteChatsDialogProps) {
  const visibleChats = sortChatsByUpdatedAt(chats.filter((chat) => !chat.archived && !isEmptyChat(chat)));
  const selectedIds = new Set(selectedChatIds);
  const sendingIds = new Set(sendingChatIds);
  const selectableCount = visibleChats.filter((chat) => !sendingIds.has(chat.id)).length;
  const selectedCount = visibleChats.filter((chat) => selectedIds.has(chat.id) && !sendingIds.has(chat.id)).length;
  const allSelected = selectableCount > 0 && selectedCount === selectableCount;

  return (
    <DialogShell
      description="Select multiple chats and delete them together from local history."
      icon={Trash2}
      onClose={onClose}
      open={open}
      title="Delete chats"
      tone="danger"
      actions={
        <>
          <button className="dialog-button" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="dialog-button dialog-button-primary" data-tone="danger" type="button" disabled={selectedCount === 0} onClick={onConfirm}>
            {selectedCount === 1 ? "Delete 1 chat" : `Delete ${selectedCount} chats`}
          </button>
        </>
      }
    >
      <div className="bulk-delete-toolbar">
        <span>
          {selectedCount} of {selectableCount} selected
        </span>
        <button type="button" disabled={selectableCount === 0} onClick={allSelected ? onClearSelection : onSelectAll}>
          {allSelected ? "Clear" : "Select all"}
        </button>
      </div>
      <div className="bulk-delete-chat-list" role="list" aria-label="Chats to delete">
        {visibleChats.length > 0 ? (
          visibleChats.map((chat) => {
            const disabled = sendingIds.has(chat.id);
            const selected = selectedIds.has(chat.id) && !disabled;
            const projectName = normalizeProjectName(chat.project);

            return (
              <label className="bulk-delete-chat-row" data-disabled={disabled} key={chat.id}>
                <input type="checkbox" checked={selected} disabled={disabled} onChange={() => onToggleChat(chat.id)} />
                <span>
                  <strong>{chat.title}</strong>
                  <small>
                    {projectName} - {chat.messages.length} {chat.messages.length === 1 ? "message" : "messages"} - {formatChatAge(chat.updatedAt)}
                  </small>
                </span>
                {disabled ? <em>Responding</em> : null}
              </label>
            );
          })
        ) : (
          <div className="bulk-delete-empty">There are no chats to delete.</div>
        )}
      </div>
    </DialogShell>
  );
}
