import { MessageSquareText, Sparkles } from "lucide-react";
import type { AppInfo } from "../../types/app";

interface ConversationPanelProps {
  appInfo: AppInfo;
}

export function ConversationPanel({ appInfo }: ConversationPanelProps) {
  return (
    <section className="workspace-panel conversation-panel" aria-labelledby="conversation-panel-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Agent Thread</p>
          <h2 id="conversation-panel-title">Collaboration canvas</h2>
        </div>
        <Sparkles size={20} aria-hidden="true" />
      </div>
      <div className="thread-preview">
        <div className="assistant-avatar">
          <MessageSquareText size={20} aria-hidden="true" />
        </div>
        <div className="message-surface">
          <strong>{appInfo.name} is ready for phase 1.</strong>
          <p>
            The first build proves the GUI shell, modular file layout, and Rust bridge before agent
            execution begins.
          </p>
        </div>
      </div>
      <form className="composer" aria-label="Message composer">
        <input placeholder="Agent chat activates in phase 2" disabled />
        <button type="button" disabled>
          Send
        </button>
      </form>
    </section>
  );
}
