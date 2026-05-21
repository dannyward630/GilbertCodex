export type PrimaryRoute = "chat" | "apps" | "tasks" | "radar" | "settings" | "support";

export interface NavigationItem {
  id: PrimaryRoute;
  label: string;
}
