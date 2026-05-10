export type DiscordBridgeMode = "bot-gateway" | "interactions" | "webhook-relay";
export type DiscordBridgeResponseStyle = "channel" | "ephemeral" | "thread";
export type DiscordTunnelProvider = "local" | "ngrok";
export type DiscordGithubEvent = "issues" | "issue_comment" | "pull_request" | "push" | "release";

export const DISCORD_BRIDGE_MODE_LABELS: Record<DiscordBridgeMode, string> = {
  "bot-gateway": "Bot gateway",
  interactions: "Slash chat",
  "webhook-relay": "Notify only",
};

export const DISCORD_BRIDGE_RESPONSE_STYLE_LABELS: Record<DiscordBridgeResponseStyle, string> = {
  channel: "Channel",
  ephemeral: "Ephemeral",
  thread: "Thread",
};

export const DISCORD_TUNNEL_PROVIDER_LABELS: Record<DiscordTunnelProvider, string> = {
  local: "Local only",
  ngrok: "ngrok",
};

export const DISCORD_GITHUB_WEBHOOK_EVENTS: DiscordGithubEvent[] = ["push", "pull_request", "issues", "issue_comment", "release"];

export interface DiscordBridgeSettings {
  allowedChannelIds: string;
  allowedGuildIds: string;
  applicationId: string;
  autoStartBridge: boolean;
  bridgePort: number;
  botToken: string;
  enabled: boolean;
  githubEvents: DiscordGithubEvent[];
  githubRepository: string;
  githubWebhookSecret: string;
  incomingWebhookUrl: string;
  interactionsEndpointUrl: string;
  mode: DiscordBridgeMode;
  ngrokAuthToken: string;
  ngrokPath: string;
  publicKey: string;
  publicInteractionsUrl: string;
  responseStyle: DiscordBridgeResponseStyle;
  tunnelProvider: DiscordTunnelProvider;
}

export const DEFAULT_DISCORD_BRIDGE_SETTINGS: DiscordBridgeSettings = {
  allowedChannelIds: "",
  allowedGuildIds: "",
  applicationId: "",
  autoStartBridge: true,
  bridgePort: 8787,
  botToken: "",
  enabled: false,
  githubEvents: ["push", "pull_request", "issues"],
  githubRepository: "",
  githubWebhookSecret: "",
  incomingWebhookUrl: "",
  interactionsEndpointUrl: "",
  mode: "interactions",
  ngrokAuthToken: "",
  ngrokPath: "ngrok",
  publicKey: "",
  publicInteractionsUrl: "",
  responseStyle: "channel",
  tunnelProvider: "ngrok",
};

export function normalizeDiscordBridgeSettings(value: unknown): DiscordBridgeSettings {
  const storedSettings = typeof value === "object" && value ? (value as Partial<DiscordBridgeSettings>) : {};
  const mode = normalizeDiscordBridgeMode(storedSettings.mode);
  const responseStyle = normalizeDiscordBridgeResponseStyle(storedSettings.responseStyle);
  const tunnelProvider = normalizeDiscordTunnelProvider(storedSettings.tunnelProvider);
  const githubEvents = normalizeDiscordGithubEvents(storedSettings.githubEvents);

  return {
    ...DEFAULT_DISCORD_BRIDGE_SETTINGS,
    ...storedSettings,
    allowedChannelIds: normalizeText(storedSettings.allowedChannelIds),
    allowedGuildIds: normalizeText(storedSettings.allowedGuildIds),
    applicationId: normalizeText(storedSettings.applicationId),
    autoStartBridge: typeof storedSettings.autoStartBridge === "boolean" ? storedSettings.autoStartBridge : DEFAULT_DISCORD_BRIDGE_SETTINGS.autoStartBridge,
    bridgePort: normalizeBridgePort(storedSettings.bridgePort),
    botToken: normalizeText(storedSettings.botToken),
    enabled: typeof storedSettings.enabled === "boolean" ? storedSettings.enabled : DEFAULT_DISCORD_BRIDGE_SETTINGS.enabled,
    githubEvents,
    githubRepository: normalizeText(storedSettings.githubRepository),
    githubWebhookSecret: normalizeText(storedSettings.githubWebhookSecret),
    incomingWebhookUrl: normalizeText(storedSettings.incomingWebhookUrl),
    interactionsEndpointUrl: normalizeText(storedSettings.interactionsEndpointUrl),
    mode,
    ngrokAuthToken: normalizeText(storedSettings.ngrokAuthToken),
    ngrokPath: normalizeText(storedSettings.ngrokPath) || DEFAULT_DISCORD_BRIDGE_SETTINGS.ngrokPath,
    publicKey: normalizeText(storedSettings.publicKey),
    publicInteractionsUrl: normalizeText(storedSettings.publicInteractionsUrl),
    responseStyle,
    tunnelProvider,
  };
}

function normalizeDiscordBridgeMode(value: unknown): DiscordBridgeMode {
  if (value === "bot-gateway" || value === "interactions" || value === "webhook-relay") {
    return value;
  }

  return DEFAULT_DISCORD_BRIDGE_SETTINGS.mode;
}

function normalizeDiscordBridgeResponseStyle(value: unknown): DiscordBridgeResponseStyle {
  if (value === "channel" || value === "ephemeral" || value === "thread") {
    return value;
  }

  return DEFAULT_DISCORD_BRIDGE_SETTINGS.responseStyle;
}

function normalizeDiscordTunnelProvider(value: unknown): DiscordTunnelProvider {
  if (value === "local" || value === "ngrok") {
    return value;
  }

  return DEFAULT_DISCORD_BRIDGE_SETTINGS.tunnelProvider;
}

function normalizeBridgePort(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : Number.NaN;

  if (Number.isInteger(parsed) && parsed >= 1024 && parsed <= 65535) {
    return parsed;
  }

  return DEFAULT_DISCORD_BRIDGE_SETTINGS.bridgePort;
}

function normalizeDiscordGithubEvents(value: unknown): DiscordGithubEvent[] {
  const events = Array.isArray(value)
    ? value.filter((event): event is DiscordGithubEvent => DISCORD_GITHUB_WEBHOOK_EVENTS.includes(event as DiscordGithubEvent))
    : DEFAULT_DISCORD_BRIDGE_SETTINGS.githubEvents;

  return Array.from(new Set(events.length > 0 ? events : DEFAULT_DISCORD_BRIDGE_SETTINGS.githubEvents));
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
