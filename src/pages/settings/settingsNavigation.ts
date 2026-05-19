import {
  CloudSun,
  Database,
  FileCog,
  Github,
  MessageCircle,
  Route,
  Search,
  ServerCog,
  Settings2,
} from "lucide-react";
import type { SettingsNavItem, SettingsSectionId } from "./types";

export const SETTINGS_NAV_ITEMS: SettingsNavItem[] = [
  { icon: Settings2, id: "general", label: "General", meta: "Profile" },
  { icon: ServerCog, id: "model", label: "AI & Providers", meta: "Models" },
  { icon: Route, id: "nineRouter", label: "Subscriptions", meta: "Accounts" },
  { icon: Search, id: "braveSearch", label: "Web Search", meta: "Sources" },
  { icon: CloudSun, id: "weatherSources", label: "Weather & Maps", meta: "Geo" },
  { icon: FileCog, id: "configuration", label: "Workspace", meta: "Runtime" },
  { icon: Database, id: "database", label: "Library & Data", meta: "Local" },
  { icon: Github, id: "github", label: "GitHub", meta: "Code" },
  { icon: MessageCircle, id: "discord", label: "Discord", meta: "Chat" },
];

export function resolveSettingsNavSection(section: SettingsSectionId): SettingsSectionId {
  if (section === "appearance" || section === "personalization") {
    return "general";
  }

  if (section === "providers") {
    return "model";
  }

  if (section === "mapbox") {
    return "weatherSources";
  }

  if (section === "pdf") {
    return "database";
  }

  return section;
}
