export type PrimaryRoute = "chat" | "toolbox" | "workflows" | "settings";

export interface NavigationItem {
  id: PrimaryRoute;
  label: string;
}
