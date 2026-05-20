import { Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { isEmptyChat } from "../../lib/chatUtils";
import { formatShortcutForPlatform, type HostPlatform } from "../../lib/hostPlatform";
import type { ChatSummary } from "../../types/chat";

interface SearchDialogProps {
  chats: ChatSummary[];
  hostPlatform: HostPlatform;
  onClose: () => void;
  onSelectChat: (chatId: string) => void;
  open: boolean;
}

export function SearchDialog({ chats, hostPlatform, onClose, onSelectChat, open }: SearchDialogProps) {
  const [query, setQuery] = useState("");

  const filteredChats = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    const visibleChats = chats.filter((chat) => !chat.archived && !isEmptyChat(chat));

    if (!normalizedQuery) {
      return visibleChats;
    }

    return visibleChats.filter((chat) => {
      const searchableText = `${chat.title} ${chat.project}`.toLowerCase();
      return searchableText.includes(normalizedQuery);
    });
  }, [chats, query]);

  const pinnedChats = useMemo(() => filteredChats.filter((chat) => chat.pinned), [filteredChats]);
  const recentChats = useMemo(() => filteredChats.filter((chat) => !chat.pinned), [filteredChats]);
  const shortcutChats = useMemo(() => [...pinnedChats, ...recentChats], [pinnedChats, recentChats]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }

      if (!(event.ctrlKey || event.metaKey) || !/^[1-9]$/.test(event.key)) {
        return;
      }

      const selectedChat = shortcutChats[Number(event.key) - 1];

      if (selectedChat) {
        event.preventDefault();
        onSelectChat(selectedChat.id);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, onSelectChat, open, shortcutChats]);

  if (!open) {
    return null;
  }

  return (
    <div className="search-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="search-dialog" role="dialog" aria-modal="true" aria-labelledby="search-title" onMouseDown={(event) => event.stopPropagation()}>
        <h1 id="search-title" className="sr-only">
          Search chats
        </h1>
        <div className="search-input-row">
          <Search size={22} aria-hidden="true" />
          <label className="sr-only" htmlFor="chat-search-input">
            Search chats
          </label>
          <input
            id="chat-search-input"
            autoFocus
            value={query}
            placeholder="Search chats"
            onChange={(event) => setQuery(event.target.value)}
          />
          <button type="button" aria-label="Close search" onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <SearchGroup title="Pinned chats" chats={pinnedChats} hostPlatform={hostPlatform} offset={1} onSelectChat={onSelectChat} />
        <SearchGroup title="Recent chats" chats={recentChats} hostPlatform={hostPlatform} offset={pinnedChats.length + 1} onSelectChat={onSelectChat} />
      </section>
    </div>
  );
}

interface SearchGroupProps {
  chats: ChatSummary[];
  hostPlatform: HostPlatform;
  offset: number;
  onSelectChat: (chatId: string) => void;
  title: string;
}

function SearchGroup({ chats, hostPlatform, offset, onSelectChat, title }: SearchGroupProps) {
  if (chats.length === 0) {
    return null;
  }

  return (
    <div className="search-group">
      <h2>{title}</h2>
      <div className="search-results">
        {chats.map((chat, index) => (
          <button key={chat.id} type="button" className="search-result" onClick={() => onSelectChat(chat.id)}>
            <span>{chat.title}</span>
            <span className="search-result-meta">
              {chat.project}
              {offset + index <= 9 ? <kbd>{formatShortcutForPlatform(`Ctrl+${offset + index}`, hostPlatform)}</kbd> : null}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
