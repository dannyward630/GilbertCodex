import {
  Database,
  FileCog,
  Github,
  KeyRound,
  MessageCircle,
  Monitor,
  ServerCog,
  Settings2,
  UserRoundCog,
} from "lucide-react";
import type { SettingsNavItem } from "./types";

export const SETTINGS_NAV_ITEMS: SettingsNavItem[] = [
  { icon: Settings2, id: "general", label: "General" },
  { icon: Monitor, id: "appearance", label: "Appearance" },
  { icon: ServerCog, id: "model", label: "Model" },
  { icon: KeyRound, id: "providers", label: "Providers" },
  { icon: UserRoundCog, id: "personalization", label: "Personalization" },
  { icon: FileCog, id: "configuration", label: "Configuration" },
  { icon: Database, id: "database", label: "Database" },
  { icon: Github, id: "github", label: "GitHub" },
  { icon: MessageCircle, id: "discord", label: "Discord" },
];
