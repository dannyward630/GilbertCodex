export type PrimaryRoute = "chat" | "toolbox" | "mcp" | "workflows" | "radar" | "settings";

export interface NavigationItem {
  id: PrimaryRoute;
  label: string;
}
