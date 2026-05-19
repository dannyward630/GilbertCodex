export type PrimaryRoute = "chat" | "apps" | "radar" | "settings" | "support";

export interface NavigationItem {
  id: PrimaryRoute;
  label: string;
}
