import type { LucideIcon } from "lucide-react";
import type { AppInfo } from "../../types/app";
import type { DiscordBridgeSettings } from "../../types/discord";
import type { LocalWorkspaceSettings } from "../../types/localWorkspace";
import type { AppearanceMode, ProviderSettings } from "../../types/settings";

export type SettingsSectionId = "appearance" | "configuration" | "discord" | "general" | "github" | "model" | "personalization" | "providers";

export interface SettingsNavItem {
  icon: LucideIcon;
  id: SettingsSectionId;
  label: string;
  meta?: string;
}

export interface SettingsPageProps {
  activeSection: SettingsSectionId;
  appearanceMode: AppearanceMode;
  appInfo: AppInfo;
  discordBridge: DiscordBridgeSettings;
  localWorkspace: LocalWorkspaceSettings;
  onAppearanceModeChange: (mode: AppearanceMode) => void;
  onDiscordBridgeChange: (settings: DiscordBridgeSettings) => void;
  onLocalWorkspaceChange: (settings: LocalWorkspaceSettings) => void;
  onSettingsChange: (settings: ProviderSettings) => void;
  settings: ProviderSettings;
}

export type LiveModelCatalogStatus = "error" | "idle" | "loading" | "ready";
export type SettingsStatusKind = "error" | "success" | "warning";

export interface SettingsStatusMessage {
  kind: SettingsStatusKind;
  text: string;
}
