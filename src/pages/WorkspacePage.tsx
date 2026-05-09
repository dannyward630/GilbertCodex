import { ConversationPanel } from "../components/panels/ConversationPanel";
import { InspectorPanel } from "../components/panels/InspectorPanel";
import { ProjectPanel } from "../components/panels/ProjectPanel";
import type { AppInfo } from "../types/app";

interface WorkspacePageProps {
  appInfo: AppInfo;
}

export function WorkspacePage({ appInfo }: WorkspacePageProps) {
  return (
    <div className="workspace-grid">
      <ProjectPanel />
      <ConversationPanel appInfo={appInfo} />
      <InspectorPanel />
    </div>
  );
}
