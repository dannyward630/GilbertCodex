export type PrimaryRoute = "chat" | "radar" | "settings";

export interface NavigationItem {
  id: PrimaryRoute;
  label: string;
}
