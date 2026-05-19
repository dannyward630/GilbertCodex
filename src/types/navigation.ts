export type PrimaryRoute = "chat" | "apps" | "radar" | "settings";

export interface NavigationItem {
  id: PrimaryRoute;
  label: string;
}
