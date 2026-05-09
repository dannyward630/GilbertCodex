import { Globe2, MoreHorizontal, PanelRight, Pin, Terminal } from "lucide-react";
import { IconButton } from "../common/IconButton";

interface ConversationHeaderProps {
  browserPreviewOpen: boolean;
  inspectorOpen: boolean;
  onToggleBrowserPreview: () => void;
  onToggleInspector: () => void;
  onTogglePin: () => void;
  pinned: boolean;
  title: string;
}

export function ConversationHeader({
  browserPreviewOpen,
  inspectorOpen,
  onToggleBrowserPreview,
  onToggleInspector,
  onTogglePin,
  pinned,
  title,
}: ConversationHeaderProps) {
  return (
    <header className="conversation-header">
      <div className="conversation-title">
        <h1>{title}</h1>
        <IconButton ariaLabel="Conversation options" icon={MoreHorizontal} />
      </div>
      <div className="conversation-tools">
        <IconButton ariaLabel={pinned ? "Unpin chat" : "Pin chat"} icon={Pin} pressed={pinned} onClick={onTogglePin} />
        <IconButton ariaLabel="Terminal" icon={Terminal} />
        <IconButton
          ariaLabel={browserPreviewOpen ? "Close browser preview" : "Open browser preview"}
          className="conversation-tool-desktop-only"
          icon={Globe2}
          pressed={browserPreviewOpen}
          onClick={onToggleBrowserPreview}
        />
        <IconButton
          ariaLabel={inspectorOpen ? "Collapse inspector" : "Open inspector"}
          className="conversation-tool-desktop-only"
          icon={PanelRight}
          pressed={inspectorOpen}
          onClick={onToggleInspector}
        />
      </div>
    </header>
  );
}
