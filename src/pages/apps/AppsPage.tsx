import { type ReactNode, useDeferredValue, useEffect, useMemo, useState } from "react";
import { AlertCircle, ArrowLeft, BadgeCheck, CalendarDays, CheckCircle2, ChevronDown, Github, Globe2, KeyRound, LogIn, LogOut, Mail, Plus, PlugZap, Puzzle, RefreshCw, Search, Server, ShieldCheck, Sparkles, TerminalSquare, Trash2, UserCheck, Wrench, X } from "lucide-react";
import {
  connectGmailOAuth,
  disconnectGmailAccount as disconnectGmailAccountByEmail,
  getDefaultGmailOAuthScope,
  getDefaultGoogleOAuthClientId,
  getDefaultGoogleOAuthClientSecret,
  getGmailState,
  gmailDesktopAvailable,
  installGmailPlugin,
  setActiveGmailAccount,
} from "../../app/gmailClient";
import {
  connectGoogleCalendarOAuth,
  disconnectGoogleCalendarAccount as disconnectGoogleCalendarAccountByEmail,
  getDefaultGoogleCalendarOAuthScope,
  getGoogleCalendarState,
  googleCalendarDesktopAvailable,
  installGoogleCalendarPlugin,
  setActiveGoogleCalendarAccount,
} from "../../app/googleCalendarClient";
import {
  getMcpState,
  listMcpServerTools,
  mcpDesktopAvailable,
  removeMcpServer,
  saveMcpServer,
  searchMcpRegistry,
  testMcpServerWithProgress,
} from "../../app/mcpClient";
import {
  getGithubState,
  githubDesktopAvailable,
  installGithubPlugin,
  listGithubRepositories,
} from "../../app/githubClient";
import { DialogShell } from "../../components/dialogs/AppDialog";
import { SkillsManagerPanel } from "./SkillsManagerPanel";
import {
  getOpenAiPluginDescription,
  getOpenAiPluginRouteLabel,
  importOpenAiPluginSkills,
  isOpenAiNativePlugin,
  loadOpenAiCodexMarketplace,
  type OpenAiCodexPluginListing,
} from "../../features/plugins/openAiCodexMarketplace";
import { loadSkillRegistry, subscribeSkillRegistry } from "../../services/skillRegistry";
import type { GithubConnectionState, GithubRepository } from "../../types/github";
import type { CalendarAccountState, CalendarConnectionState } from "../../types/googleCalendar";
import type { GmailAccountState, GmailConnectionState } from "../../types/gmail";
import type { McpConnectionState, McpRegistryInstallHint, McpRegistryServerSummary, McpSaveServerRequest, McpServerProgressEvent, McpServerState, McpTestServerRequest, McpTransport } from "../../types/mcp";
import type { SkillRegistryState } from "../../types/skills";
import "../../styles/apps.css";

interface AppsPageProps {
  locationServicesEnabled: boolean;
  onBackToChat: () => void;
  onOpenGithubSettings: () => void;
  onOpenGoogleSettings: () => void;
  onOpenRadar: () => void;
  onOpenSupport: () => void;
}

type GmailActionState = "connect" | "disconnect" | "idle" | "install" | "refresh";
type CalendarActionState = "connect" | "disconnect" | "idle" | "install" | "refresh";
type GithubActionState = "idle" | "install" | "refresh";
type McpActionState = "idle" | "refresh" | "remove" | "save" | "test" | "test-all";
type AppsStatusMessage = { kind: "error" | "success" | "warning"; text: string };
type AppsCatalogSection = "all" | "mcp" | "plugins" | "skills";
type MarketplaceStatusKind = "connected" | "installed" | "ready" | "setup";
const GMAIL_ACCOUNT_LIMIT = 6;
const GOOGLE_CALENDAR_ACCOUNT_LIMIT = 6;
const MCP_SERVER_LIMIT = 50;
const MCP_PRESET_PAGE_SIZE = 6;
const MCP_REGISTRY_PAGE_SIZE = 5;
const MCP_REGISTRY_RESULT_LIMIT = 18;
const OPENAI_PLUGIN_PAGE_SIZE = 12;

const APP_ICON_URLS = {
  gmail: "https://cdn.simpleicons.org/gmail/EA4335",
  googleCalendar: "https://cdn.simpleicons.org/googlecalendar/4285F4",
  github: "https://cdn.simpleicons.org/github/FFFFFF",
  mcp: "https://modelcontextprotocol.io/favicon.ico",
} as const;

interface McpServerDraft {
  argsText: string;
  authorizationToken: string;
  command: string;
  enabled: boolean;
  environmentText: string;
  endpoint: string;
  id: string;
  name: string;
  transport: McpTransport;
  workingDirectory: string;
}

interface McpProviderPreset {
  args?: string[];
  command?: string;
  description: string;
  endpoint?: string;
  environmentText?: string;
  id: string;
  name: string;
  note: string;
  publisher: string;
  tags: string[];
  transport: McpTransport;
}

interface MarketplacePluginRuntimeState {
  description: string;
  mcpServer?: McpServerState;
  primaryActionLabel: string;
  primaryDisabled: boolean;
  routeLabel: string;
  secondaryActionLabel?: string;
  secondaryDisabled?: boolean;
  skillCount: number;
  statusKind: MarketplaceStatusKind;
  statusLabel: string;
  tags: string[];
}

const APP_SECTION_FILTERS: Array<{ id: AppsCatalogSection; label: string }> = [
  { id: "all", label: "All" },
  { id: "plugins", label: "Plugins" },
  { id: "skills", label: "Skills" },
  { id: "mcp", label: "MCP" },
];

const EMPTY_MCP_DRAFT: McpServerDraft = {
  argsText: "",
  authorizationToken: "",
  command: "",
  enabled: true,
  environmentText: "",
  endpoint: "",
  id: "",
  name: "",
  transport: "http",
  workingDirectory: "",
};

const EMPTY_MCP_SERVERS: McpServerState[] = [];

const mcpRemoteArgs = (endpoint: string) => ["-y", "mcp-remote@latest", endpoint];

const MCP_FEATURED_PRESETS: McpProviderPreset[] = [
  {
    args: ["-y", "firebase-tools@latest", "mcp"],
    command: "npx",
    description: "Official Firebase MCP for projects, Auth, Firestore, Data Connect, rules, docs, and Cloud Messaging.",
    id: "firebase",
    name: "Firebase",
    note: "Gilbert auto-resolves npm/npx shims on Windows. If the MCP login link fails with a Google code-challenge error, close that tab and run `npx.cmd -y firebase-tools@latest login --reauth` in a terminal, then Save and test again.",
    publisher: "Firebase",
    tags: ["Auth", "Firestore", "Hosting"],
    transport: "stdio",
  },
  {
    args: mcpRemoteArgs("https://mcp.figma.com/mcp"),
    command: "npx",
    description: "Preferred Figma remote MCP for design context, components, variables, Make resources, and design-to-code work.",
    id: "figma-remote",
    name: "Figma Remote",
    note: "Uses mcp-remote so Figma OAuth can open in the browser. If your org requires desktop-only access, use the Figma Desktop preset instead.",
    publisher: "Figma",
    tags: ["Design", "OAuth", "Dev Mode"],
    transport: "stdio",
  },
  {
    description: "Figma desktop MCP for selected design context, variables, code guidance, and design-to-code work.",
    endpoint: "http://127.0.0.1:3845/mcp",
    id: "figma-desktop",
    name: "Figma Desktop",
    note: "Open Figma Desktop, switch a file to Dev Mode, and enable the desktop MCP server before testing this localhost endpoint.",
    publisher: "Figma",
    tags: ["Design", "Dev Mode", "Local"],
    transport: "http",
  },
  {
    args: mcpRemoteArgs("https://mcp.supabase.com/mcp?read_only=true"),
    command: "npx",
    description: "Official Supabase MCP for database, logs, docs, Edge Functions, storage, and project management.",
    id: "supabase",
    name: "Supabase",
    note: "Starts in read-only mode and uses mcp-remote for the Supabase OAuth flow. For CI-style PAT auth, switch this draft to HTTP and paste the PAT in the bearer token field.",
    publisher: "Supabase",
    tags: ["Postgres", "Auth", "Storage"],
    transport: "stdio",
  },
  {
    args: ["mcp-proxy-for-aws@latest", "https://aws-mcp.us-east-1.api.aws/mcp", "--metadata", "AWS_REGION=us-east-1"],
    command: "uvx",
    description: "AWS MCP Server through the official SigV4 proxy for current AWS docs, skills, and AWS API operations.",
    id: "aws",
    name: "AWS MCP",
    note: "Requires uv/uvx plus valid AWS CLI credentials on the machine. Change AWS_REGION in Arguments if your default operating region differs.",
    publisher: "AWS",
    tags: ["IAM", "Docs", "Cloud"],
    transport: "stdio",
  },
  {
    args: mcpRemoteArgs("https://gitlab.com/api/v4/mcp"),
    command: "npx",
    description: "Official GitLab MCP for projects, issues, merge requests, repository context, and Duo workflows.",
    id: "gitlab",
    name: "GitLab",
    note: "Uses mcp-remote for GitLab OAuth. For self-managed GitLab, replace gitlab.com in the argument URL with your instance host.",
    publisher: "GitLab",
    tags: ["Repos", "Issues", "OAuth"],
    transport: "stdio",
  },
  {
    description: "Official GitHub MCP for repositories, issues, pull requests, Actions, code search, and security context.",
    endpoint: "https://api.githubcopilot.com/mcp/",
    id: "github-mcp",
    name: "GitHub MCP",
    note: "Paste a GitHub PAT in the HTTP bearer token field for the remote MCP server. Gilbert's native GitHub connector remains available for app-managed GitHub workflows.",
    publisher: "GitHub",
    tags: ["Repos", "PRs", "Bearer"],
    transport: "http",
  },
  {
    args: mcpRemoteArgs("https://mcp.linear.app/mcp"),
    command: "npx",
    description: "Official Linear MCP for issues, projects, comments, and product planning workflows.",
    id: "linear",
    name: "Linear",
    note: "Uses mcp-remote for Linear OAuth. If authentication gets stuck, clear mcp-remote auth for Linear and test again.",
    publisher: "Linear",
    tags: ["Issues", "Projects", "OAuth"],
    transport: "stdio",
  },
  {
    args: ["-y", "@stripe/mcp@latest"],
    command: "npx",
    description: "Official local Stripe MCP for customers, payment links, billing, docs, and API-backed commerce work.",
    environmentText: "STRIPE_SECRET_KEY=",
    id: "stripe",
    name: "Stripe",
    note: "Paste a restricted Stripe secret key into Environment as STRIPE_SECRET_KEY. Gilbert stores stdio env values in secure storage.",
    publisher: "Stripe",
    tags: ["Payments", "Billing", "Secure env"],
    transport: "stdio",
  },
  {
    args: mcpRemoteArgs("https://mcp.atlassian.com/v1/mcp/authv2"),
    command: "npx",
    description: "Official Atlassian Rovo MCP for Jira, Confluence, Compass, and work-management context.",
    id: "atlassian",
    name: "Atlassian",
    note: "Uses Atlassian's current /mcp/authv2 endpoint through mcp-remote so OAuth can complete in the browser.",
    publisher: "Atlassian",
    tags: ["Jira", "Confluence", "OAuth"],
    transport: "stdio",
  },
  {
    args: mcpRemoteArgs("https://mcp.vercel.com"),
    command: "npx",
    description: "Official Vercel MCP for projects, deployments, domains, logs, teams, and platform operations.",
    id: "vercel",
    name: "Vercel",
    note: "Uses mcp-remote for Vercel OAuth. Provider sign-in opens on first test or first tool listing.",
    publisher: "Vercel",
    tags: ["Deployments", "Logs", "OAuth"],
    transport: "stdio",
  },
  {
    args: mcpRemoteArgs("https://mcp.notion.com/mcp"),
    command: "npx",
    description: "Official Notion MCP for pages, databases, workspace search, docs, tasks, and planning content.",
    id: "notion",
    name: "Notion",
    note: "Uses mcp-remote because Notion requires user OAuth and does not support bearer-token auth for its hosted MCP.",
    publisher: "Notion",
    tags: ["Docs", "Tasks", "OAuth"],
    transport: "stdio",
  },
  {
    description: "Cloudflare's API MCP exposes Cloudflare account operations with a compact code-mode tool surface.",
    endpoint: "https://mcp.cloudflare.com/mcp",
    id: "cloudflare-api",
    name: "Cloudflare API",
    note: "Paste a Cloudflare API token in the HTTP bearer token field, or switch to mcp-remote if you want browser OAuth instead.",
    publisher: "Cloudflare",
    tags: ["Workers", "DNS", "Bearer"],
    transport: "http",
  },
  {
    description: "Cloudflare Docs MCP gives agents current Cloudflare reference material without account access.",
    endpoint: "https://docs.mcp.cloudflare.com/mcp",
    id: "cloudflare-docs",
    name: "Cloudflare Docs",
    note: "Public docs-focused endpoint. Save and test directly; no account token should be needed for documentation search.",
    publisher: "Cloudflare",
    tags: ["Docs", "Workers", "Public"],
    transport: "http",
  },
  {
    description: "Cloudflare Browser MCP fetches pages, converts web content to markdown, and can capture screenshots.",
    endpoint: "https://browser.mcp.cloudflare.com/mcp",
    id: "cloudflare-browser",
    name: "Cloudflare Browser",
    note: "Useful for web inspection flows. If Cloudflare asks for account auth, add a bearer token or use mcp-remote for OAuth.",
    publisher: "Cloudflare",
    tags: ["Browser", "Markdown", "Screenshots"],
    transport: "http",
  },
  {
    args: ["-y", "@upstash/context7-mcp@latest"],
    command: "npx",
    description: "Context7 MCP pulls current library and API documentation into coding prompts.",
    id: "context7",
    name: "Context7",
    note: "Runs locally through npm. A Context7 API key is optional for higher limits; add it only if your account requires it.",
    publisher: "Upstash",
    tags: ["Docs", "Libraries", "Coding"],
    transport: "stdio",
  },
  {
    args: ["--from", "redis-mcp-server@latest", "redis-mcp-server", "--url", "redis://localhost:6379/0"],
    command: "uvx",
    description: "Official Redis MCP for reading, writing, querying, and managing Redis data during development.",
    id: "redis",
    name: "Redis",
    note: "Defaults to local Redis. Replace the --url argument with your Redis or Redis Cloud URL before testing.",
    publisher: "Redis",
    tags: ["Cache", "Data", "uvx"],
    transport: "stdio",
  },
  {
    args: ["-y", "mongodb-mcp-server@latest"],
    command: "npx",
    description: "Official MongoDB MCP for Atlas or self-hosted MongoDB schema, queries, and database management.",
    id: "mongodb",
    name: "MongoDB",
    note: "MongoDB recommends running `npx mongodb-mcp-server@latest setup` once to create the connection config before testing this server.",
    publisher: "MongoDB",
    tags: ["Atlas", "Database", "Setup"],
    transport: "stdio",
  },
  {
    args: ["-y", "@sentry/mcp-server@latest"],
    command: "npx",
    description: "Sentry MCP for issues, traces, docs, and production debugging workflows.",
    id: "sentry",
    name: "Sentry",
    note: "Uses Sentry's npm MCP server. Complete Sentry auth when prompted, or add provider-specific env values if your Sentry setup requires them.",
    publisher: "Sentry",
    tags: ["Errors", "Traces", "Debugging"],
    transport: "stdio",
  },
  {
    args: ["-y", "kubernetes-mcp-server@latest"],
    command: "npx",
    description: "Kubernetes MCP for cluster inspection and kubectl-backed development workflows.",
    id: "kubernetes",
    name: "Kubernetes",
    note: "Requires a working kubeconfig on the machine. Keep write-capable clusters carefully permission-reviewed.",
    publisher: "Containers",
    tags: ["K8s", "Cluster", "kubectl"],
    transport: "stdio",
  },
];

export function AppsPage({ onBackToChat, onOpenGithubSettings, onOpenGoogleSettings }: AppsPageProps) {
  const [activeCatalogSection, setActiveCatalogSection] = useState<AppsCatalogSection>("all");
  const [appSearchQuery, setAppSearchQuery] = useState("");
  const [expandedAppCardIds, setExpandedAppCardIds] = useState<Set<string>>(() => new Set());
  const [gmailActionState, setGmailActionState] = useState<GmailActionState>("idle");
  const [gmailConnection, setGmailConnection] = useState<GmailConnectionState>({ accounts: [], connected: false, maxAccounts: GMAIL_ACCOUNT_LIMIT, pluginInstalled: false, scopes: [] });
  const [gmailConnectOpen, setGmailConnectOpen] = useState(false);
  const [gmailStatus, setGmailStatus] = useState<AppsStatusMessage | null>(null);
  const [calendarActionState, setCalendarActionState] = useState<CalendarActionState>("idle");
  const [calendarConnection, setCalendarConnection] = useState<CalendarConnectionState>({ accounts: [], connected: false, maxAccounts: GOOGLE_CALENDAR_ACCOUNT_LIMIT, pluginInstalled: false, scopes: [] });
  const [calendarConnectOpen, setCalendarConnectOpen] = useState(false);
  const [calendarStatus, setCalendarStatus] = useState<AppsStatusMessage | null>(null);
  const [githubActionState, setGithubActionState] = useState<GithubActionState>("idle");
  const [githubConnection, setGithubConnection] = useState<GithubConnectionState>({ connected: false, pluginInstalled: false, scopes: [] });
  const [githubRepos, setGithubRepos] = useState<GithubRepository[]>([]);
  const [githubStatus, setGithubStatus] = useState<AppsStatusMessage | null>(null);
  const [mcpActionState, setMcpActionState] = useState<McpActionState>("idle");
  const [mcpConnection, setMcpConnection] = useState<McpConnectionState>({ connected: false, enabledServerCount: 0, maxServers: MCP_SERVER_LIMIT, servers: [] });
  const [mcpDialogOpen, setMcpDialogOpen] = useState(false);
  const [mcpDraft, setMcpDraft] = useState<McpServerDraft>(EMPTY_MCP_DRAFT);
  const [mcpPresetPage, setMcpPresetPage] = useState(0);
  const [mcpRegistryBusy, setMcpRegistryBusy] = useState(false);
  const [mcpRegistryPage, setMcpRegistryPage] = useState(0);
  const [mcpRegistryQuery, setMcpRegistryQuery] = useState("firebase");
  const [mcpRegistryResults, setMcpRegistryResults] = useState<McpRegistryServerSummary[]>([]);
  const [mcpRegistryStatus, setMcpRegistryStatus] = useState<AppsStatusMessage | null>(null);
  const [mcpProgressEvents, setMcpProgressEvents] = useState<McpServerProgressEvent[]>([]);
  const [mcpStatus, setMcpStatus] = useState<AppsStatusMessage | null>(null);
  const [openAiPlugins, setOpenAiPlugins] = useState<OpenAiCodexPluginListing[]>([]);
  const [openAiPluginActionId, setOpenAiPluginActionId] = useState<string | null>(null);
  const [openAiPluginBusy, setOpenAiPluginBusy] = useState(false);
  const [openAiPluginPage, setOpenAiPluginPage] = useState(0);
  const [openAiPluginStatus, setOpenAiPluginStatus] = useState<AppsStatusMessage | null>(null);
  const [skillRegistry, setSkillRegistry] = useState<SkillRegistryState>(() => loadSkillRegistry());
  const deferredSearchQuery = useDeferredValue(appSearchQuery);
  const googleTestingHint = import.meta.env.DEV ? " If Google shows access_denied because the app is in testing, add this Google account as a test user in Google Auth Platform > Audience." : "";
  const googleOAuthClientId = getDefaultGoogleOAuthClientId();
  const googleOAuthClientSecret = getDefaultGoogleOAuthClientSecret();
  const googleClientReady = Boolean(googleOAuthClientId && googleOAuthClientSecret);
  const gmailAvailable = gmailDesktopAvailable();
  const gmailBusy = gmailActionState !== "idle";
  const gmailMaxAccounts = gmailConnection.maxAccounts || GMAIL_ACCOUNT_LIMIT;
  const gmailAccountRows = useMemo(() => normalizeGmailAccountRows(gmailConnection), [gmailConnection]);
  const gmailActiveAccount = gmailAccountRows.find((account) => account.active) ?? gmailAccountRows[0];
  const gmailActiveEmail = gmailConnection.activeAccountEmail ?? gmailActiveAccount?.email ?? gmailConnection.user?.email;
  const gmailConnected = gmailConnection.connected || gmailAccountRows.length > 0;
  const gmailInstalled = gmailConnection.pluginInstalled || gmailConnected;
  const gmailNeedsSetup = Boolean(gmailConnection.lastConnectionError) && !gmailConnected;
  const gmailStatusLabel = gmailConnected ? "Connected" : gmailNeedsSetup ? "Needs setup" : gmailInstalled ? "Installed" : googleClientReady && gmailAvailable ? "Ready to install" : gmailAvailable ? "Needs Google setup" : "Unavailable";
  const gmailStatusKind = gmailConnected ? "connected" : gmailNeedsSetup ? "setup" : gmailInstalled ? "installed" : googleClientReady && gmailAvailable ? "ready" : "setup";
  const gmailCanAddAccount = gmailAccountRows.length < gmailMaxAccounts;
  const gmailAccountLabel = gmailAccountRows.length > 0
    ? `${gmailAccountRows.length}/${gmailMaxAccounts} accounts connected${gmailActiveEmail ? ` | Active: ${gmailActiveEmail}` : ""}`
    : gmailInstalled
      ? "Installed locally. Google account not connected."
      : gmailAvailable && !googleClientReady
        ? "Add Google OAuth setup first"
      : "Install to choose a Google account";
  const calendarAvailable = googleCalendarDesktopAvailable();
  const calendarBusy = calendarActionState !== "idle";
  const calendarMaxAccounts = calendarConnection.maxAccounts || GOOGLE_CALENDAR_ACCOUNT_LIMIT;
  const calendarAccountRows = useMemo(() => normalizeCalendarAccountRows(calendarConnection), [calendarConnection]);
  const calendarActiveAccount = calendarAccountRows.find((account) => account.active) ?? calendarAccountRows[0];
  const calendarActiveEmail = calendarConnection.activeAccountEmail ?? calendarActiveAccount?.email ?? calendarConnection.user?.email;
  const calendarConnected = calendarConnection.connected || calendarAccountRows.length > 0;
  const calendarInstalled = calendarConnection.pluginInstalled || calendarConnected;
  const calendarNeedsSetup = Boolean(calendarConnection.lastConnectionError) && !calendarConnected;
  const calendarStatusLabel = calendarConnected ? "Connected" : calendarNeedsSetup ? "Needs setup" : calendarInstalled ? "Installed" : googleClientReady && calendarAvailable ? "Ready to install" : calendarAvailable ? "Needs Google setup" : "Unavailable";
  const calendarStatusKind = calendarConnected ? "connected" : calendarNeedsSetup ? "setup" : calendarInstalled ? "installed" : googleClientReady && calendarAvailable ? "ready" : "setup";
  const calendarCanAddAccount = calendarAccountRows.length < calendarMaxAccounts;
  const calendarAccountLabel = calendarAccountRows.length > 0
    ? `${calendarAccountRows.length}/${calendarMaxAccounts} accounts connected${calendarActiveEmail ? ` | Active: ${calendarActiveEmail}` : ""}`
    : calendarInstalled
      ? "Installed locally. Google account not connected."
      : calendarAvailable && !googleClientReady
        ? "Add Google OAuth setup first"
      : "Install to choose a Google account";
  const githubAvailable = githubDesktopAvailable();
  const githubBusy = githubActionState !== "idle";
  const githubConnected = githubConnection.connected;
  const githubInstalled = githubConnection.pluginInstalled || githubConnected;
  const githubStatusLabel = githubConnected ? "Connected" : githubInstalled ? "Installed" : githubAvailable ? "Ready to install" : "Unavailable";
  const githubStatusKind = githubConnected ? "connected" : githubInstalled ? "installed" : githubAvailable ? "ready" : "setup";
  const githubAccountLabel = githubConnected
    ? `${githubConnection.user?.login ?? "GitHub"} connected${githubRepos.length ? ` | ${githubRepos.length} repos previewed` : ""}`
    : githubInstalled
      ? "Installed locally. Connect GitHub in Settings."
      : "Install to use the existing GitHub setup path";
  const mcpAvailable = mcpDesktopAvailable();
  const mcpBusy = mcpActionState !== "idle";
  const mcpServers = mcpConnection.servers ?? EMPTY_MCP_SERVERS;
  const mcpSummary = useMemo(() => {
    let enabledCount = 0;
    let toolCount = 0;
    const searchParts: string[] = [];

    for (const server of mcpServers) {
      if (server.enabled) {
        enabledCount += 1;
      }

      const tools = server.tools ?? [];
      toolCount += tools.length;
      searchParts.push(server.name, server.endpoint ?? "", server.command ?? "", server.transport, server.serverName ?? "");

      for (const tool of tools) {
        searchParts.push(tool.name);
      }
    }

    return {
      enabledCount,
      searchText: searchParts.join(" "),
      toolCount,
    };
  }, [mcpServers]);
  const mcpPresetSearchText = useMemo(
    () => MCP_FEATURED_PRESETS.map((preset) => [preset.name, preset.publisher, preset.description, ...preset.tags].join(" ")).join(" "),
    [],
  );
  const mcpPresetPageCount = Math.max(1, Math.ceil(MCP_FEATURED_PRESETS.length / MCP_PRESET_PAGE_SIZE));
  const mcpPresetCurrentPage = Math.min(mcpPresetPage, mcpPresetPageCount - 1);
  const mcpPresetPageStart = mcpPresetCurrentPage * MCP_PRESET_PAGE_SIZE;
  const mcpVisiblePresets = MCP_FEATURED_PRESETS.slice(mcpPresetPageStart, mcpPresetPageStart + MCP_PRESET_PAGE_SIZE);
  const mcpRegistrySearchText = useMemo(
    () => mcpRegistryResults.map((server) => [
      server.name,
      server.title,
      server.description,
      server.repositoryUrl,
      server.install?.packageId,
      server.install?.endpoint,
    ].filter(Boolean).join(" ")).join(" "),
    [mcpRegistryResults],
  );
  const mcpRegistryPageCount = Math.max(1, Math.ceil(mcpRegistryResults.length / MCP_REGISTRY_PAGE_SIZE));
  const mcpRegistryCurrentPage = Math.min(mcpRegistryPage, mcpRegistryPageCount - 1);
  const mcpRegistryPageStart = mcpRegistryCurrentPage * MCP_REGISTRY_PAGE_SIZE;
  const mcpVisibleRegistryResults = mcpRegistryResults.slice(mcpRegistryPageStart, mcpRegistryPageStart + MCP_REGISTRY_PAGE_SIZE);
  const githubRepoSearchText = useMemo(
    () => githubRepos.map((repo) => [repo.fullName, repo.description, repo.defaultBranch].filter(Boolean).join(" ")).join(" "),
    [githubRepos],
  );
  const mcpEnabledCount = mcpSummary.enabledCount;
  const mcpMaxServers = mcpConnection.maxServers || MCP_SERVER_LIMIT;
  const mcpToolCount = mcpSummary.toolCount;
  const mcpConfigured = mcpServers.length > 0;
  const mcpConnected = mcpConnection.connected || mcpEnabledCount > 0;
  const mcpStatusLabel = mcpConnected ? "Connected" : mcpConfigured ? "Configured" : mcpAvailable ? "Ready" : "Desktop only";
  const mcpStatusKind = mcpConnected ? "connected" : mcpConfigured ? "installed" : mcpAvailable ? "ready" : "setup";
  const mcpAccountLabel = mcpConfigured
    ? `${mcpEnabledCount}/${mcpMaxServers} enabled servers | ${mcpToolCount} cached tools`
    : mcpAvailable
      ? "Add a Streamable HTTP or stdio MCP server"
      : "Open the desktop app to connect MCP servers";
  const normalizedSearchQuery = useMemo(() => deferredSearchQuery.trim().toLowerCase(), [deferredSearchQuery]);
  const openAiCatalogPlugins = useMemo(
    () => openAiPlugins.filter((plugin) => !isOpenAiNativePlugin(plugin.id)),
    [openAiPlugins],
  );
  const marketplacePluginStates = useMemo(() => {
    const states = new Map<string, MarketplacePluginRuntimeState>();

    for (const plugin of openAiCatalogPlugins) {
      states.set(plugin.id, getMarketplacePluginRuntimeState(plugin, mcpServers, skillRegistry));
    }

    return states;
  }, [mcpServers, openAiCatalogPlugins, skillRegistry]);
  const openAiFilteredPlugins = useMemo(
    () => openAiCatalogPlugins.filter((plugin) => {
      const state = marketplacePluginStates.get(plugin.id);

      return matchesAppsSearch(normalizedSearchQuery, [
        plugin.displayName,
        plugin.id,
        plugin.category,
        plugin.marketplace,
        plugin.sourcePath,
        state?.routeLabel ?? getOpenAiPluginRouteLabel(plugin),
        state?.statusLabel,
        state?.description ?? getOpenAiPluginDescription(plugin),
        ...(state?.tags ?? []),
        plugin.hasBundledSkills ? "skills SKILL.md bundled" : "",
        plugin.mcpPresetId ? "mcp preset tools" : "",
      ]);
    }),
    [normalizedSearchQuery, openAiCatalogPlugins, marketplacePluginStates],
  );
  const openAiPluginPageCount = Math.max(1, Math.ceil(openAiFilteredPlugins.length / OPENAI_PLUGIN_PAGE_SIZE));
  const openAiPluginCurrentPage = Math.min(openAiPluginPage, openAiPluginPageCount - 1);
  const openAiPluginPageStart = openAiPluginCurrentPage * OPENAI_PLUGIN_PAGE_SIZE;
  const openAiVisiblePlugins = openAiFilteredPlugins.slice(openAiPluginPageStart, openAiPluginPageStart + OPENAI_PLUGIN_PAGE_SIZE);
  const openAiPluginMatchesSearch =
    sectionMatches(activeCatalogSection, "plugins") &&
    (openAiPluginBusy || openAiFilteredPlugins.length > 0 || Boolean(openAiPluginStatus));
  const pluginCatalogCount = 3 + openAiCatalogPlugins.length;
  const gmailMatchesSearch =
    sectionMatches(activeCatalogSection, "plugins") &&
    matchesAppsSearch(normalizedSearchQuery, [
      "Gmail",
      "Google",
      "email",
      "inbox",
      "thread summaries",
      "draft replies",
      "direct send",
      "full gmail api",
      "settings",
      "plugins",
      "made by Gilbert Codex",
      gmailStatusLabel,
      gmailAccountLabel,
    ]);
  const calendarMatchesSearch =
    sectionMatches(activeCatalogSection, "plugins") &&
    matchesAppsSearch(normalizedSearchQuery, [
      "Google Calendar",
      "Calendar",
      "Google",
      "agenda",
      "schedule",
      "events",
      "meeting prep",
      "availability",
      "free busy",
      "plugins",
      "made by Gilbert Codex",
      calendarStatusLabel,
      calendarAccountLabel,
    ]);
  const githubMatchesSearch =
    sectionMatches(activeCatalogSection, "plugins") &&
    matchesAppsSearch(normalizedSearchQuery, [
      "GitHub",
      "Git",
      "repositories",
      "branches",
      "commits",
      "pull requests",
      "issues",
      "actions",
      "workflows",
      "releases",
      "tags",
      "stars",
      "forks",
      "semantic search",
      "plugins",
      "made by Gilbert Codex",
      githubStatusLabel,
      githubAccountLabel,
      githubRepoSearchText,
    ]);
  const mcpMatchesSearch =
    sectionMatches(activeCatalogSection, "mcp") &&
    matchesAppsSearch(normalizedSearchQuery, [
      "MCP",
      "Model Context Protocol",
      "tool servers",
      "remote tools",
      "connectors",
      "external tools",
      "Streamable HTTP",
      "stdio",
      "command line servers",
      "bearer token",
      "secure storage",
      "permissions",
      "registry",
      "marketplace",
      "Supabase",
      "Firebase",
      "AWS",
      "Figma",
      mcpStatusLabel,
      mcpAccountLabel,
      mcpSummary.searchText,
      mcpPresetSearchText,
      mcpRegistrySearchText,
    ]);
  const skillsMatchesSearch =
    sectionMatches(activeCatalogSection, "skills") &&
    matchesAppsSearch(normalizedSearchQuery, [
      "Skills",
      "SKILL.md",
      "installed",
      "custom",
      "premade",
      "prompt packs",
      "workflows",
      "triggers",
      "team presets",
      "reusable instructions",
      "coding",
      "review",
      "research",
      "frontend",
    ]);
  const visibleCardCount = (gmailMatchesSearch ? 1 : 0) + (calendarMatchesSearch ? 1 : 0) + (githubMatchesSearch ? 1 : 0) + (openAiPluginMatchesSearch ? 1 : 0) + (mcpMatchesSearch ? 1 : 0) + (skillsMatchesSearch ? 1 : 0);
  const readyCapabilityCount = 4 + MCP_FEATURED_PRESETS.length + openAiCatalogPlugins.length;
  const gmailExpanded = expandedAppCardIds.has("gmail");
  const calendarExpanded = expandedAppCardIds.has("google-calendar");
  const githubExpanded = expandedAppCardIds.has("github");

  useEffect(() => subscribeSkillRegistry(setSkillRegistry), []);

  useEffect(() => {
    let disposed = false;

    setOpenAiPluginBusy(true);
    void loadOpenAiCodexMarketplace()
      .then((plugins) => {
        if (disposed) {
          return;
        }

        setOpenAiPlugins(plugins);
        setOpenAiPluginStatus(plugins[0]?.marketplace.toLowerCase().includes("fallback")
          ? { kind: "warning", text: `Loaded ${plugins.length} fallback plugin entries. The live plugin catalog could not be reached.` }
          : { kind: "success", text: `Loaded ${plugins.length} Gilbert marketplace plugins.` });
      })
      .catch((error) => {
        if (!disposed) {
          setOpenAiPluginStatus({ kind: "error", text: error instanceof Error ? error.message : "Could not load the Gilbert plugin marketplace." });
        }
      })
      .finally(() => {
        if (!disposed) {
          setOpenAiPluginBusy(false);
        }
      });

    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    setOpenAiPluginPage(0);
  }, [normalizedSearchQuery, activeCatalogSection]);

  useEffect(() => {
    if (!gmailAvailable) {
      setGmailStatus({ kind: "warning", text: "Open the desktop app to install Gmail. Browser preview cannot store Google account tokens." });
      return;
    }

    let disposed = false;

    setGmailActionState("refresh");
    void getGmailState()
      .then((connection) => {
        if (disposed) {
          return;
        }

        setGmailConnection(connection);
        setGmailStatus((connection.connected || (connection.accounts ?? []).length > 0)
          ? { kind: "success", text: formatConnectedGmailStatus(connection) }
          : connection.lastConnectionError
            ? { kind: "warning", text: formatGmailConnectionError(connection.lastConnectionError) }
            : connection.pluginInstalled
              ? { kind: "warning", text: "Gmail plugin is installed locally. Connect a Google account before Gmail tools can read mail." }
              : null);
      })
      .catch((error) => {
        if (!disposed) {
          setGmailStatus({ kind: "error", text: error instanceof Error ? error.message : "Could not load Gmail connection." });
        }
      })
      .finally(() => {
        if (!disposed) {
          setGmailActionState("idle");
        }
      });

    return () => {
      disposed = true;
    };
  }, [gmailAvailable]);

  useEffect(() => {
    if (!calendarAvailable) {
      setCalendarStatus({ kind: "warning", text: "Open the desktop app to install Google Calendar. Browser preview cannot store Google account tokens." });
      return;
    }

    let disposed = false;

    setCalendarActionState("refresh");
    void getGoogleCalendarState()
      .then((connection) => {
        if (disposed) {
          return;
        }

        setCalendarConnection(connection);
        setCalendarStatus((connection.connected || (connection.accounts ?? []).length > 0)
          ? { kind: "success", text: formatConnectedCalendarStatus(connection) }
          : connection.lastConnectionError
            ? { kind: "warning", text: formatCalendarConnectionError(connection.lastConnectionError) }
            : connection.pluginInstalled
              ? { kind: "warning", text: "Google Calendar plugin is installed locally. Connect a Google account before Calendar tools can read events." }
              : null);
      })
      .catch((error) => {
        if (!disposed) {
          setCalendarStatus({ kind: "error", text: error instanceof Error ? error.message : "Could not load Google Calendar connection." });
        }
      })
      .finally(() => {
        if (!disposed) {
          setCalendarActionState("idle");
        }
      });

    return () => {
      disposed = true;
    };
  }, [calendarAvailable]);

  useEffect(() => {
    if (!githubAvailable) {
      setGithubStatus({ kind: "warning", text: "Open the desktop app to install GitHub. Browser preview cannot store GitHub account tokens." });
      return;
    }

    let disposed = false;

    setGithubActionState("refresh");
    void getGithubState()
      .then((connection) => {
        if (disposed) {
          return;
        }

        setGithubConnection(connection);
        setGithubRepos([]);

        if (connection.connected) {
          setGithubStatus({ kind: "success", text: `GitHub connected as ${connection.user?.login ?? "your account"}.` });
          return;
        }

        setGithubStatus(connection.pluginInstalled ? { kind: "warning", text: "GitHub plugin is installed locally. Connect GitHub in Settings before GitHub tools can access repositories." } : null);
      })
      .catch((error) => {
        if (!disposed) {
          setGithubStatus({ kind: "error", text: error instanceof Error ? error.message : "Could not load GitHub connection." });
        }
      })
      .finally(() => {
        if (!disposed) {
          setGithubActionState("idle");
        }
      });

    return () => {
      disposed = true;
    };
  }, [githubAvailable]);

  useEffect(() => {
    if (!mcpAvailable) {
      setMcpStatus({ kind: "warning", text: "Open the desktop app to connect MCP servers. Browser preview cannot store MCP bearer tokens." });
      return;
    }

    let disposed = false;

    setMcpActionState("refresh");
    void getMcpState()
      .then((connection) => {
        if (disposed) {
          return;
        }

        setMcpConnection(connection);
        setMcpStatus(formatMcpConnectionStatus(connection));
      })
      .catch((error) => {
        if (!disposed) {
          setMcpStatus({ kind: "error", text: error instanceof Error ? error.message : "Could not load MCP server connections." });
        }
      })
      .finally(() => {
        if (!disposed) {
          setMcpActionState("idle");
        }
      });

    return () => {
      disposed = true;
    };
  }, [mcpAvailable]);

  async function startGmailConnection() {
    if (!gmailAvailable) {
      setGmailStatus({ kind: "error", text: "Gmail sign-in is available in the desktop app." });
      return;
    }

    if (!gmailCanAddAccount) {
      setGmailStatus({ kind: "warning", text: `Gmail already has ${gmailMaxAccounts}/${gmailMaxAccounts} accounts connected. Disconnect one before adding another.` });
      setGmailConnectOpen(true);
      return;
    }

    setGmailActionState("install");

    try {
      const installedConnection = await installGmailPlugin();

      setGmailConnection(installedConnection);
    } catch (error) {
      setGmailActionState("idle");
      setGmailStatus({ kind: "error", text: error instanceof Error ? error.message : "Could not install Gmail plugin locally." });
      return;
    }

    if (!googleOAuthClientId) {
      setGmailActionState("idle");
      setGmailStatus({ kind: "warning", text: "Gmail needs Google OAuth setup first. Opening Settings > Google." });
      onOpenGoogleSettings();
      return;
    }

    if (!googleOAuthClientSecret) {
      setGmailActionState("idle");
      setGmailStatus({ kind: "warning", text: "Gmail needs the matching Google desktop Client secret. Opening Settings > Google." });
      onOpenGoogleSettings();
      return;
    }

    setGmailActionState("connect");
    setGmailStatus({ kind: "warning", text: `Gmail plugin is installed locally. Opening Google sign-in so you can choose the account to connect.${googleTestingHint}` });

    try {
      const connection = await connectGmailOAuth({
        clientId: googleOAuthClientId,
        clientSecret: googleOAuthClientSecret,
        scope: getDefaultGmailOAuthScope(),
      });

      setGmailConnection(connection);
      setGmailStatus({ kind: "success", text: formatConnectedGmailStatus(connection) });
    } catch (error) {
      try {
        setGmailConnection(await getGmailState());
      } catch {
        // Keep the last known install state if a refresh also fails.
      }

      setGmailStatus({ kind: "error", text: formatGmailConnectionError(error) });
    } finally {
      setGmailActionState("idle");
    }
  }

  async function activateGmailAccount(email: string) {
    setGmailActionState("refresh");
    setGmailStatus(null);

    try {
      const connection = await setActiveGmailAccount({ email });

      setGmailConnection(connection);
      setGmailStatus({ kind: "success", text: `Active Gmail account set to ${email}.` });
    } catch (error) {
      setGmailStatus({ kind: "error", text: error instanceof Error ? error.message : "Could not switch Gmail account." });
    } finally {
      setGmailActionState("idle");
    }
  }

  async function disconnectConnectedGmailAccount(email: string) {
    setGmailActionState("disconnect");
    setGmailStatus(null);

    try {
      const connection = await disconnectGmailAccountByEmail({ email });

      setGmailConnection(connection);
      setGmailStatus({ kind: "success", text: `${email} disconnected. The Gmail plugin remains installed locally.` });
    } catch (error) {
      setGmailStatus({ kind: "error", text: error instanceof Error ? error.message : "Could not disconnect Gmail." });
    } finally {
      setGmailActionState("idle");
    }
  }

  function handleGmailPrimaryAction() {
    if (gmailConnected) {
      setGmailConnectOpen(true);
      return;
    }

    if (!gmailAvailable) {
      setGmailStatus({ kind: "error", text: "Open the desktop app to install Gmail. Browser preview can show the setup flow but cannot store Google tokens." });
      setGmailConnectOpen(true);
      return;
    }

    if (!googleClientReady) {
      setGmailConnectOpen(false);
      setGmailStatus({ kind: "warning", text: "Gmail install needs Google OAuth setup first. Opening Settings > Google." });
      onOpenGoogleSettings();
      return;
    }

    void startGmailConnection();
  }

  async function startCalendarConnection() {
    if (!calendarAvailable) {
      setCalendarStatus({ kind: "error", text: "Google Calendar sign-in is available in the desktop app." });
      return;
    }

    if (!calendarCanAddAccount) {
      setCalendarStatus({ kind: "warning", text: `Google Calendar already has ${calendarMaxAccounts}/${calendarMaxAccounts} accounts connected. Disconnect one before adding another.` });
      setCalendarConnectOpen(true);
      return;
    }

    setCalendarActionState("install");

    try {
      const installedConnection = await installGoogleCalendarPlugin();

      setCalendarConnection(installedConnection);
    } catch (error) {
      setCalendarActionState("idle");
      setCalendarStatus({ kind: "error", text: error instanceof Error ? error.message : "Could not install Google Calendar plugin locally." });
      return;
    }

    if (!googleOAuthClientId) {
      setCalendarActionState("idle");
      setCalendarStatus({ kind: "warning", text: "Google Calendar needs Google OAuth setup first. Opening Settings > Google." });
      onOpenGoogleSettings();
      return;
    }

    if (!googleOAuthClientSecret) {
      setCalendarActionState("idle");
      setCalendarStatus({ kind: "warning", text: "Google Calendar needs the matching Google desktop Client secret. Opening Settings > Google." });
      onOpenGoogleSettings();
      return;
    }

    setCalendarActionState("connect");
    setCalendarStatus({ kind: "warning", text: `Google Calendar plugin is installed locally. Opening Google sign-in so you can choose the account to connect.${googleTestingHint}` });

    try {
      const connection = await connectGoogleCalendarOAuth({
        clientId: googleOAuthClientId,
        clientSecret: googleOAuthClientSecret,
        scope: getDefaultGoogleCalendarOAuthScope(),
      });

      setCalendarConnection(connection);
      setCalendarStatus({ kind: "success", text: formatConnectedCalendarStatus(connection) });
    } catch (error) {
      try {
        setCalendarConnection(await getGoogleCalendarState());
      } catch {
        // Keep the last known install state if a refresh also fails.
      }

      setCalendarStatus({ kind: "error", text: formatCalendarConnectionError(error) });
    } finally {
      setCalendarActionState("idle");
    }
  }

  async function activateCalendarAccount(email: string) {
    setCalendarActionState("refresh");
    setCalendarStatus(null);

    try {
      const connection = await setActiveGoogleCalendarAccount({ email });

      setCalendarConnection(connection);
      setCalendarStatus({ kind: "success", text: `Active Google Calendar account set to ${email}.` });
    } catch (error) {
      setCalendarStatus({ kind: "error", text: error instanceof Error ? error.message : "Could not switch Google Calendar account." });
    } finally {
      setCalendarActionState("idle");
    }
  }

  async function disconnectConnectedCalendarAccount(email: string) {
    setCalendarActionState("disconnect");
    setCalendarStatus(null);

    try {
      const connection = await disconnectGoogleCalendarAccountByEmail({ email });

      setCalendarConnection(connection);
      setCalendarStatus({ kind: "success", text: `${email} disconnected. The Google Calendar plugin remains installed locally.` });
    } catch (error) {
      setCalendarStatus({ kind: "error", text: error instanceof Error ? error.message : "Could not disconnect Google Calendar." });
    } finally {
      setCalendarActionState("idle");
    }
  }

  function handleCalendarPrimaryAction() {
    if (calendarConnected) {
      setCalendarConnectOpen(true);
      return;
    }

    if (!calendarAvailable) {
      setCalendarStatus({ kind: "error", text: "Open the desktop app to install Google Calendar. Browser preview can show the setup flow but cannot store Google tokens." });
      setCalendarConnectOpen(true);
      return;
    }

    if (!googleClientReady) {
      setCalendarConnectOpen(false);
      setCalendarStatus({ kind: "warning", text: "Google Calendar install needs Google OAuth setup first. Opening Settings > Google." });
      onOpenGoogleSettings();
      return;
    }

    void startCalendarConnection();
  }

  async function refreshGithubConnection() {
    if (!githubAvailable) {
      setGithubStatus({ kind: "error", text: "GitHub is available in the desktop app." });
      return;
    }

    setGithubActionState("refresh");

    try {
      const connection = await getGithubState();

      setGithubConnection(connection);

      if (connection.connected) {
        const repositories = await listGithubRepositories({ perPage: 6, sort: "updated" });

        setGithubRepos(repositories);
        setGithubStatus({ kind: "success", text: formatConnectedGithubStatus(connection, repositories) });
      } else {
        setGithubRepos([]);
        setGithubStatus(connection.pluginInstalled
          ? { kind: "warning", text: "GitHub plugin is installed locally. Open GitHub settings to finish browser sign-in." }
          : null);
      }
    } catch (error) {
      setGithubStatus({ kind: "error", text: error instanceof Error ? error.message : "Could not refresh GitHub." });
    } finally {
      setGithubActionState("idle");
    }
  }

  async function installOrOpenGithub() {
    if (githubConnected) {
      onOpenGithubSettings();
      return;
    }

    if (!githubAvailable) {
      setGithubStatus({ kind: "error", text: "Open the desktop app to install GitHub. Browser preview can show the setup flow but cannot store GitHub tokens." });
      return;
    }

    if (githubInstalled) {
      onOpenGithubSettings();
      return;
    }

    setGithubActionState("install");

    try {
      const connection = await installGithubPlugin();

      setGithubConnection(connection);
      if (connection.connected) {
        const repositories = await listGithubRepositories({ perPage: 6, sort: "updated" });

        setGithubRepos(repositories);
        setGithubStatus({ kind: "success", text: formatConnectedGithubStatus(connection, repositories) });
        return;
      }

      setGithubRepos([]);
      setGithubStatus({ kind: "warning", text: "GitHub plugin installed locally. Opening GitHub settings so you can finish browser sign-in." });
      onOpenGithubSettings();
    } catch (error) {
      setGithubStatus({ kind: "error", text: error instanceof Error ? error.message : "Could not install GitHub plugin locally." });
    } finally {
      setGithubActionState("idle");
    }
  }

  function openMcpServerDialog(server?: McpServerState) {
    setMcpDraft(server
      ? {
          argsText: (server.args ?? []).join("\n"),
          authorizationToken: "",
          command: server.command ?? "",
          enabled: server.enabled,
          environmentText: formatMcpEnvironmentDraft(server),
          endpoint: server.endpoint ?? "",
          id: server.id,
          name: server.name,
          transport: server.transport ?? "http",
          workingDirectory: server.workingDirectory ?? "",
        }
      : EMPTY_MCP_DRAFT);
    setMcpStatus(server?.hasAuthorizationToken || (server?.environment ?? []).some((item) => item.hasValue)
      ? { kind: "success", text: "Saved secrets are hidden. Leave HTTP bearer token blank to keep it; stdio env lines with blank values keep their saved values." }
      : null);
    setMcpProgressEvents([]);
    setMcpDialogOpen(true);
  }

  function configureMcpPreset(preset: McpProviderPreset, existingServer?: McpServerState) {
    const installedServer = existingServer ?? findMcpServerForPreset(mcpServers, preset);

    if (installedServer) {
      openMcpServerDialog(installedServer);
      setMcpStatus({ kind: "success", text: `${installedServer.name} is already installed. Review it here, refresh tools, or update the saved configuration.` });
      return;
    }

    setMcpDraft({
      ...EMPTY_MCP_DRAFT,
      argsText: (preset.args ?? []).join("\n"),
      command: preset.command ?? "",
      endpoint: preset.endpoint ?? "",
      environmentText: preset.environmentText ?? "",
      name: preset.name,
      transport: preset.transport,
    });
    setMcpStatus({ kind: "warning", text: preset.note });
    setMcpProgressEvents([]);
    setMcpDialogOpen(true);
  }

  function configureMcpRegistryServer(server: McpRegistryServerSummary) {
    const install = server.install;

    if (!install) {
      setMcpRegistryStatus({ kind: "warning", text: `${formatMcpRegistryServerName(server)} does not publish a supported npm, PyPI, or remote install hint yet.` });
      return;
    }

    setMcpDraft(createDraftFromRegistryInstall(server, install));
    setMcpStatus({ kind: "warning", text: install.note ?? "Review this generated MCP configuration, then save and test it." });
    setMcpProgressEvents([]);
    setMcpDialogOpen(true);
  }

  async function handleOpenAiPluginPrimaryAction(plugin: OpenAiCodexPluginListing) {
    const runtimeState = marketplacePluginStates.get(plugin.id) ?? getMarketplacePluginRuntimeState(plugin, mcpServers, skillRegistry);

    setOpenAiPluginActionId(plugin.id);
    setOpenAiPluginStatus(null);

    try {
      if (plugin.installRoute === "native") {
        if (plugin.id === "gmail") {
          handleGmailPrimaryAction();
        } else if (plugin.id === "google-calendar") {
          handleCalendarPrimaryAction();
        } else if (plugin.id === "github") {
          await installOrOpenGithub();
        }
        return;
      }

      if (plugin.installRoute === "mcp-preset") {
        const preset = MCP_FEATURED_PRESETS.find((candidate) => candidate.id === plugin.mcpPresetId);

        if (!preset) {
          setOpenAiPluginStatus({ kind: "error", text: `${plugin.displayName} has no matching MCP preset in this build.` });
          return;
        }

        configureMcpPreset(preset, runtimeState.mcpServer);
        setOpenAiPluginStatus(runtimeState.mcpServer
          ? { kind: "success", text: `${plugin.displayName} is already installed as ${runtimeState.mcpServer.name}. Manage it in MCP settings.` }
          : { kind: "success", text: `${plugin.displayName} is ready to review as an MCP server. Save and test it before chat can use the tools.` });
        return;
      }

      if (plugin.installRoute === "skill-import") {
        if (runtimeState.skillCount > 0) {
          viewPluginSkills(plugin);
          return;
        }

        await installOpenAiPluginSkills(plugin);
        return;
      }

      setActiveCatalogSection("mcp");
      setMcpRegistryQuery(plugin.displayName);
      setOpenAiPluginStatus({ kind: "warning", text: `Searching the MCP Registry for a runnable ${plugin.displayName} server. Hosted connector IDs are not directly callable without a native Gilbert or MCP path.` });
      await searchMcpRegistryCatalog(plugin.displayName);
    } finally {
      setOpenAiPluginActionId(null);
    }
  }

  async function installOpenAiPluginSkills(plugin: OpenAiCodexPluginListing) {
    const runtimeState = marketplacePluginStates.get(plugin.id) ?? getMarketplacePluginRuntimeState(plugin, mcpServers, skillRegistry);

    if (runtimeState.skillCount > 0) {
      viewPluginSkills(plugin);
      return;
    }

    setOpenAiPluginActionId(plugin.id);
    setOpenAiPluginStatus(null);

    try {
      const result = await importOpenAiPluginSkills(plugin);

      if (result.importedCount === 0) {
        setOpenAiPluginStatus({ kind: "warning", text: `${plugin.displayName} does not publish bundled skills in the plugin catalog. Try MCP Registry search for a runnable tool server.` });
        return;
      }

      const preview = result.skillNames.slice(0, 3).join(", ");
      const remaining = result.importedCount > 3 ? `, +${result.importedCount - 3} more` : "";
      setOpenAiPluginStatus({ kind: "success", text: `Installed ${result.importedCount} ${plugin.displayName} skill${result.importedCount === 1 ? "" : "s"} locally${preview ? `: ${preview}${remaining}` : "."}` });
      setSkillRegistry(loadSkillRegistry());
    } catch (error) {
      setOpenAiPluginStatus({ kind: "error", text: error instanceof Error ? error.message : `Could not install ${plugin.displayName} skills.` });
    } finally {
      setOpenAiPluginActionId(null);
    }
  }

  function viewPluginSkills(plugin: OpenAiCodexPluginListing) {
    setActiveCatalogSection("skills");
    setAppSearchQuery(plugin.displayName);
    setOpenAiPluginStatus({ kind: "success", text: `${plugin.displayName} skills are already installed. Showing them in Skills.` });
  }

  async function searchMcpRegistryCatalog(query = mcpRegistryQuery) {
    if (!mcpAvailable) {
      setMcpRegistryStatus({ kind: "error", text: "MCP Registry search is available in the desktop app." });
      return;
    }

    setMcpRegistryBusy(true);
    setMcpRegistryStatus(null);

    try {
      const response = await searchMcpRegistry({ limit: MCP_REGISTRY_RESULT_LIMIT, query });

      setMcpRegistryResults(response.servers);
      setMcpRegistryPage(0);
      setMcpRegistryStatus(response.servers.length > 0
        ? { kind: "success", text: `Found ${response.servers.length} MCP server${response.servers.length === 1 ? "" : "s"}${response.count > response.servers.length ? ` from ${response.count} registry matches` : ""}.` }
        : { kind: "warning", text: "No registry servers matched that search." });
    } catch (error) {
      setMcpRegistryStatus({ kind: "error", text: error instanceof Error ? error.message : "Could not search the MCP Registry." });
    } finally {
      setMcpRegistryBusy(false);
    }
  }

  async function refreshMcpConnections() {
    if (!mcpAvailable) {
      setMcpStatus({ kind: "error", text: "MCP server connections are available in the desktop app." });
      setMcpDialogOpen(true);
      return;
    }

    setMcpActionState("refresh");

    try {
      const connection = await getMcpState();

      setMcpConnection(connection);
      setMcpStatus(formatMcpConnectionStatus(connection));
    } catch (error) {
      setMcpStatus({ kind: "error", text: error instanceof Error ? error.message : "Could not refresh MCP servers." });
    } finally {
      setMcpActionState("idle");
    }
  }

  function resetMcpProgress(message?: string) {
    setMcpProgressEvents(message
      ? [{ kind: "step", message }]
      : []);
  }

  function appendMcpProgressEvent(event: McpServerProgressEvent) {
    setMcpProgressEvents((events) => [...events.slice(-7), event]);
  }

  async function saveAndTestMcpServer() {
    if (!mcpAvailable) {
      setMcpStatus({ kind: "error", text: "MCP setup is available in the desktop app." });
      return;
    }

    const request = createMcpSaveRequest(mcpDraft);

    if (!request.ok) {
      setMcpStatus({ kind: "error", text: request.error });
      return;
    }

    setMcpActionState("save");
    setMcpStatus(null);
    resetMcpProgress("Saving MCP server configuration.");

    try {
      const saved = await saveMcpServer(request.value);

      setMcpConnection(saved.state);
      setMcpDraft((draft) => ({ ...draft, authorizationToken: "", id: saved.server.id }));
      setMcpActionState("test");
      appendMcpProgressEvent({ kind: "step", message: "Saved. Testing connection and loading tools." });

      const tested = await testMcpServerWithProgress({ id: saved.server.id }, appendMcpProgressEvent);

      if (tested.state) {
        setMcpConnection(tested.state);
      }

      setMcpStatus({
        kind: tested.ok ? "success" : "warning",
        text: tested.message,
      });
    } catch (error) {
      setMcpStatus({ kind: "error", text: error instanceof Error ? error.message : "Could not save MCP server." });
    } finally {
      setMcpActionState("idle");
    }
  }

  async function testMcpDraftConnection() {
    if (!mcpAvailable) {
      setMcpStatus({ kind: "error", text: "MCP connection tests are available in the desktop app." });
      return;
    }

    setMcpActionState("test");
    setMcpStatus(null);
    resetMcpProgress("Testing MCP connection.");

    try {
      const request = createMcpTestRequest(mcpDraft);

      if (!request.ok) {
        setMcpStatus({ kind: "error", text: request.error });
        return;
      }

      const response = await testMcpServerWithProgress(mcpDraft.id
        ? { id: mcpDraft.id }
        : request.value, appendMcpProgressEvent);

      if (response.state) {
        setMcpConnection(response.state);
      }

      setMcpStatus({ kind: response.ok ? "success" : "warning", text: response.message });
    } catch (error) {
      setMcpStatus({ kind: "error", text: error instanceof Error ? error.message : "Could not test MCP server." });
    } finally {
      setMcpActionState("idle");
    }
  }

  async function refreshMcpServerTools(serverId: string) {
    setMcpActionState("refresh");
    setMcpStatus(null);

    try {
      const response = await listMcpServerTools({ serverId });

      setMcpConnection(response.state);
      setMcpStatus({ kind: "success", text: `${response.server.name} refreshed with ${response.tools.length} tool${response.tools.length === 1 ? "" : "s"}.` });
    } catch (error) {
      setMcpStatus({ kind: "error", text: error instanceof Error ? error.message : "Could not refresh MCP tools." });
    } finally {
      setMcpActionState("idle");
    }
  }

  async function testAllMcpServers() {
    if (!mcpAvailable) {
      setMcpStatus({ kind: "error", text: "MCP tool tests are available in the desktop app." });
      return;
    }

    const enabledServers = mcpServers.filter((server) => server.enabled);

    if (enabledServers.length === 0) {
      setMcpStatus({ kind: "warning", text: "Enable at least one MCP server before running a tool test." });
      return;
    }

    setMcpActionState("test-all");
    setMcpStatus(null);
    resetMcpProgress(`Testing ${enabledServers.length} enabled MCP server${enabledServers.length === 1 ? "" : "s"}.`);

    let passedCount = 0;
    const failures: string[] = [];

    try {
      for (const server of enabledServers) {
        appendMcpProgressEvent({ kind: "step", message: `Listing tools from ${server.name}.` });

        try {
          const response = await listMcpServerTools({ serverId: server.id });

          passedCount += 1;
          setMcpConnection(response.state);
          appendMcpProgressEvent({
            kind: "finished",
            message: `${response.server.name}: ${response.tools.length} tool${response.tools.length === 1 ? "" : "s"} ready.`,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Could not list tools.";
          failures.push(`${server.name}: ${message}`);
          appendMcpProgressEvent({ kind: "error", message: `${server.name}: ${message}` });
        }
      }

      if (failures.length > 0) {
        setMcpStatus({
          kind: passedCount > 0 ? "warning" : "error",
          text: `${passedCount}/${enabledServers.length} MCP server${enabledServers.length === 1 ? "" : "s"} passed tool discovery. ${failures.slice(0, 2).join(" | ")}`,
        });
      } else {
        setMcpStatus({
          kind: "success",
          text: `All ${passedCount} enabled MCP server${passedCount === 1 ? "" : "s"} listed tools successfully.`,
        });
      }
    } finally {
      setMcpActionState("idle");
    }
  }

  async function removeConfiguredMcpServer(server: McpServerState) {
    if (!window.confirm(`Remove MCP server "${server.name}" from Gilbert Codex?`)) {
      return;
    }

    setMcpActionState("remove");
    setMcpStatus(null);

    try {
      const connection = await removeMcpServer({ id: server.id });

      setMcpConnection(connection);
      setMcpStatus({ kind: "success", text: `${server.name} removed. Its saved bearer token was cleared from secure storage.` });

      if (mcpDraft.id === server.id) {
        setMcpDraft(EMPTY_MCP_DRAFT);
      }
    } catch (error) {
      setMcpStatus({ kind: "error", text: error instanceof Error ? error.message : "Could not remove MCP server." });
    } finally {
      setMcpActionState("idle");
    }
  }

  function toggleAppCardExpanded(cardId: string) {
    setExpandedAppCardIds((currentIds) => {
      const nextIds = new Set(currentIds);

      if (nextIds.has(cardId)) {
        nextIds.delete(cardId);
      } else {
        nextIds.add(cardId);
      }

      return nextIds;
    });
  }

  return (
    <section className="apps-page">
      <header className="apps-hero">
        <div className="apps-hero-title">
          <span className="apps-hero-icon">
            <Puzzle size={22} aria-hidden="true" />
          </span>
          <span>
            <h1>Apps</h1>
            <small>Plugins, Apps, Skills, and more</small>
          </span>
        </div>
        <button className="apps-back-button" type="button" onClick={onBackToChat}>
          <ArrowLeft size={16} aria-hidden="true" />
          <span>Chat</span>
        </button>
      </header>

      <main className="apps-content" aria-labelledby="apps-library-title">
        <section className="apps-library-heading">
          <span className="apps-library-kicker">
            <PlugZap size={15} aria-hidden="true" />
            App library
          </span>
          <div>
            <h2 id="apps-library-title">Connected apps, plugins, and skills</h2>
            <p>Install trusted capability cards as they become available. Gmail, Google Calendar, GitHub, MCP servers, and Skills are available from this workspace.</p>
          </div>
        </section>

        <section className="apps-catalog-toolbar" aria-label="App catalog controls">
          <label className="apps-search">
            <Search size={17} aria-hidden="true" />
            <input value={appSearchQuery} placeholder="Search Gmail, Calendar, GitHub, Skills, MCP, plugins" onChange={(event) => setAppSearchQuery(event.target.value)} />
            {appSearchQuery ? (
              <button type="button" aria-label="Clear apps search" title="Clear search" onClick={() => setAppSearchQuery("")}>
                <X size={15} aria-hidden="true" />
              </button>
            ) : null}
          </label>

          <div className="apps-catalog-metrics" aria-label="App catalog status">
            <span>
              <strong>{gmailAccountRows.length + calendarAccountRows.length + (githubConnected ? 1 : 0) + mcpEnabledCount}</strong>
              Connected
            </span>
            <span>
              <strong>{readyCapabilityCount}</strong>
              Ready
            </span>
            <span>
              <strong>1</strong>
              Skills
            </span>
          </div>
        </section>

        <nav className="apps-section-tabs" aria-label="App catalog sections">
          {APP_SECTION_FILTERS.map((section) => {
            const SectionIcon = getAppsSectionIcon(section.id);

            return (
              <button key={section.id} type="button" data-active={activeCatalogSection === section.id} onClick={() => setActiveCatalogSection(section.id)}>
                <SectionIcon size={15} aria-hidden="true" />
                <span>{section.label}</span>
                <small>{getAppsSectionMeta(section.id, { mcpEnabledCount, pluginCatalogCount })}</small>
              </button>
            );
          })}
        </nav>

        <section className="apps-plugin-grid" aria-label="Available apps and plugins">
          {gmailMatchesSearch ? (
            <article className="apps-plugin-card apps-plugin-card-featured" data-expanded={gmailExpanded}>
              <div className="apps-plugin-card-header">
                <WebAppLogo className="apps-plugin-logo-gmail" fallback={<Mail size={20} aria-hidden="true" />} src={APP_ICON_URLS.gmail} />
                <div>
                  <div className="apps-plugin-title-row">
                    <h3>Gmail</h3>
                    <span className="apps-plugin-status" data-kind={gmailStatusKind}>
                      {gmailConnected ? <CheckCircle2 size={14} aria-hidden="true" /> : <AlertCircle size={14} aria-hidden="true" />}
                      {gmailStatusLabel}
                    </span>
                  </div>
                  <span className="apps-plugin-maker">
                    <BadgeCheck size={14} aria-hidden="true" />
                    Made by Gilbert Codex
                  </span>
                </div>
              </div>

              <p className="apps-plugin-description">Email search, thread summaries, drafts, labels, and user-approved sends.</p>

              <div className="apps-plugin-account" data-connected={gmailConnected}>
                <Mail size={15} aria-hidden="true" />
                <span>{gmailAccountLabel}</span>
              </div>

              <div className="apps-plugin-top-actions">
                <button className="apps-plugin-primary" type="button" disabled={gmailBusy} onClick={handleGmailPrimaryAction}>
                  {gmailActionState === "connect" ? "Opening Google" : gmailActionState === "install" ? "Installing" : gmailConnected ? "Manage" : gmailInstalled ? "Sign in" : "Install"}
                </button>
              </div>

              {gmailStatus && (!gmailConnected || gmailStatus.kind !== "success" || gmailExpanded) ? (
                <div className="apps-plugin-message" data-kind={gmailStatus.kind}>
                  {gmailStatus.text}
                </div>
              ) : null}

              {gmailExpanded ? (
                <div className="apps-plugin-expanded" aria-label="Gmail tools">
                  <div className="apps-plugin-expanded-head">
                    <strong>Included tools</strong>
                    <small>Mail reads, drafts, labels, and sends</small>
                  </div>

                  <div className="apps-plugin-smart-strip" aria-label="Gmail smart actions">
                    <span>Context aware</span>
                    <span>Full Gmail API</span>
                    <span>{gmailMaxAccounts} accounts</span>
                  </div>

                  <div className="apps-plugin-capabilities" aria-label="Gmail capabilities">
                    <span>Inbox search</span>
                    <span>Thread summaries</span>
                    <span>Draft replies</span>
                    <span>Direct send</span>
                    <span>Bulk labels</span>
                    <span>Settings</span>
                  </div>

                  <div className="apps-plugin-safety">
                    <ShieldCheck size={16} aria-hidden="true" />
                    <span>Full mailbox access unlocks after Google approval; destructive actions still use review cards.</span>
                  </div>
                </div>
              ) : null}

              <div className="apps-plugin-actions">
                <button className="apps-plugin-secondary apps-plugin-details-button" type="button" aria-expanded={gmailExpanded} onClick={() => toggleAppCardExpanded("gmail")}>
                  <ChevronDown size={14} aria-hidden="true" />
                  {gmailExpanded ? "Collapse" : "Expand"}
                </button>
              </div>
            </article>
          ) : null}

          {calendarMatchesSearch ? (
            <article className="apps-plugin-card apps-plugin-card-featured" data-expanded={calendarExpanded}>
              <div className="apps-plugin-card-header">
                <WebAppLogo className="apps-plugin-logo-calendar" fallback={<CalendarDays size={20} aria-hidden="true" />} src={APP_ICON_URLS.googleCalendar} />
                <div>
                  <div className="apps-plugin-title-row">
                    <h3>Google Calendar</h3>
                    <span className="apps-plugin-status" data-kind={calendarStatusKind}>
                      {calendarConnected ? <CheckCircle2 size={14} aria-hidden="true" /> : <AlertCircle size={14} aria-hidden="true" />}
                      {calendarStatusLabel}
                    </span>
                  </div>
                  <span className="apps-plugin-maker">
                    <BadgeCheck size={14} aria-hidden="true" />
                    Made by Gilbert Codex
                  </span>
                </div>
              </div>

              <p className="apps-plugin-description">Agenda review, event search, free-busy checks, and approved calendar changes.</p>

              <div className="apps-plugin-account" data-connected={calendarConnected}>
                <CalendarDays size={15} aria-hidden="true" />
                <span>{calendarAccountLabel}</span>
              </div>

              <div className="apps-plugin-top-actions">
                <button className="apps-plugin-primary" type="button" disabled={calendarBusy} onClick={handleCalendarPrimaryAction}>
                  {calendarActionState === "connect" ? "Opening Google" : calendarActionState === "install" ? "Installing" : calendarConnected ? "Manage" : calendarInstalled ? "Sign in" : "Install"}
                </button>
              </div>

              {calendarStatus && (!calendarConnected || calendarStatus.kind !== "success" || calendarExpanded) ? (
                <div className="apps-plugin-message" data-kind={calendarStatus.kind}>
                  {calendarStatus.text}
                </div>
              ) : null}

              {calendarExpanded ? (
                <div className="apps-plugin-expanded" aria-label="Google Calendar tools">
                  <div className="apps-plugin-expanded-head">
                    <strong>Included tools</strong>
                    <small>Events, calendars, tasks, and availability</small>
                  </div>

                  <div className="apps-plugin-smart-strip" aria-label="Google Calendar smart actions">
                    <span>Agenda aware</span>
                    <span>Free-busy safe</span>
                    <span>{calendarMaxAccounts} accounts</span>
                  </div>

                  <div className="apps-plugin-capabilities" aria-label="Google Calendar capabilities">
                    <span>Agenda review</span>
                    <span>Event search</span>
                    <span>Free-busy</span>
                    <span>Meeting prep</span>
                    <span>Create events</span>
                    <span>Update events</span>
                    <span>Google Tasks</span>
                  </div>

                  <div className="apps-plugin-safety">
                    <ShieldCheck size={16} aria-hidden="true" />
                    <span>Calendar writes can run with full access, but destructive actions still use approval.</span>
                  </div>
                </div>
              ) : null}

              <div className="apps-plugin-actions">
                <button className="apps-plugin-secondary apps-plugin-details-button" type="button" aria-expanded={calendarExpanded} onClick={() => toggleAppCardExpanded("google-calendar")}>
                  <ChevronDown size={14} aria-hidden="true" />
                  {calendarExpanded ? "Collapse" : "Expand"}
                </button>
              </div>
            </article>
          ) : null}

          {githubMatchesSearch ? (
            <article className="apps-plugin-card apps-plugin-card-featured" data-expanded={githubExpanded}>
              <div className="apps-plugin-card-header">
                <WebAppLogo className="apps-plugin-logo-github" fallback={<Github size={20} aria-hidden="true" />} src={APP_ICON_URLS.github} />
                <div>
                  <div className="apps-plugin-title-row">
                    <h3>GitHub</h3>
                    <span className="apps-plugin-status" data-kind={githubStatusKind}>
                      {githubConnected ? <CheckCircle2 size={14} aria-hidden="true" /> : <AlertCircle size={14} aria-hidden="true" />}
                      {githubStatusLabel}
                    </span>
                  </div>
                  <span className="apps-plugin-maker">
                    <BadgeCheck size={14} aria-hidden="true" />
                    Made by Gilbert Codex
                  </span>
                </div>
              </div>

              <p className="apps-plugin-description">Repository, issue, pull request, release, Action, and local Git tools.</p>

              <div className="apps-plugin-account" data-connected={githubConnected}>
                <Github size={15} aria-hidden="true" />
                <span>{githubAccountLabel}</span>
              </div>

              <div className="apps-plugin-top-actions">
                <button className="apps-plugin-primary" type="button" disabled={githubBusy} onClick={() => void installOrOpenGithub()}>
                  {githubActionState === "install" ? "Installing" : githubConnected ? "Manage" : githubInstalled ? "Sign in" : "Install"}
                </button>
                <button className="apps-plugin-secondary apps-plugin-icon-action" type="button" aria-label="Refresh GitHub" title="Refresh GitHub" disabled={githubBusy || !githubAvailable} onClick={() => void refreshGithubConnection()}>
                  <RefreshCw size={14} aria-hidden="true" />
                </button>
              </div>

              {githubStatus && (!githubConnected || githubStatus.kind !== "success" || githubExpanded) ? (
                <div className="apps-plugin-message" data-kind={githubStatus.kind}>
                  {githubStatus.text}
                </div>
              ) : null}

              {githubExpanded ? (
                <div className="apps-plugin-expanded" aria-label="GitHub tools">
                  <div className="apps-plugin-expanded-head">
                    <strong>Included tools</strong>
                    <small>Repos, issues, pull requests, releases, and local Git</small>
                  </div>

                  <div className="apps-plugin-smart-strip" aria-label="GitHub smart actions">
                    <span>Local Git aware</span>
                    <span>Semantic search</span>
                    <span>REST fallback</span>
                  </div>

                  <div className="apps-plugin-capabilities" aria-label="GitHub capabilities">
                    <span>Working tree</span>
                    <span>Branches</span>
                    <span>Commits</span>
                    <span>Pull requests</span>
                    <span>Issues</span>
                    <span>Actions</span>
                    <span>Releases</span>
                    <span>API tools</span>
                  </div>

                  <div className="apps-plugin-safety">
                    <ShieldCheck size={16} aria-hidden="true" />
                    <span>Reads run after connection; commits, PRs, releases, workflow actions, and API writes stay approval gated.</span>
                  </div>
                </div>
              ) : null}

              <div className="apps-plugin-actions">
                <button className="apps-plugin-secondary apps-plugin-details-button" type="button" aria-expanded={githubExpanded} onClick={() => toggleAppCardExpanded("github")}>
                  <ChevronDown size={14} aria-hidden="true" />
                  {githubExpanded ? "Collapse" : "Expand"}
                </button>
              </div>
            </article>
          ) : null}

          {openAiPluginMatchesSearch ? (
            <section className="apps-plugin-marketplace-board" aria-label="Gilbert Codex plugin marketplace">
              <div className="apps-mcp-board-head">
                <div className="apps-mcp-heading">
                  <span className="apps-plugin-logo apps-plugin-logo-marketplace">
                    <PlugZap size={20} aria-hidden="true" />
                  </span>
                  <span>
                    <strong>Gilbert Plugin Marketplace</strong>
                    <small>Curated plugin catalog mapped to Gilbert install paths</small>
                  </span>
                  <span className="apps-plugin-status" data-kind={openAiPluginBusy ? "setup" : "ready"}>
                    {openAiPluginBusy ? <RefreshCw size={14} aria-hidden="true" /> : <CheckCircle2 size={14} aria-hidden="true" />}
                    {openAiPluginBusy ? "Loading" : `${openAiCatalogPlugins.length} plugins`}
                  </span>
                </div>
              </div>

              <div className="apps-plugin-marketplace-summary" aria-label="Plugin marketplace summary">
                <span>
                  <strong>Native</strong>
                  Gmail, Calendar, GitHub
                </span>
                <span>
                  <strong>MCP</strong>
                  Save and test runnable servers
                </span>
                <span>
                  <strong>Skills</strong>
                  Import bundled workflows
                </span>
                <span>
                  <strong>Registry</strong>
                  Find public tool servers
                </span>
              </div>

              {openAiPluginStatus ? (
                <div className="apps-plugin-message" data-kind={openAiPluginStatus.kind}>
                  {openAiPluginStatus.text}
                </div>
              ) : null}

              {openAiPluginBusy ? (
                <div className="apps-plugin-marketplace-loading">
                  <RefreshCw size={16} aria-hidden="true" />
                  <span>Loading plugin metadata...</span>
                </div>
              ) : openAiVisiblePlugins.length > 0 ? (
                <div className="apps-plugin-marketplace-grid">
                  {openAiVisiblePlugins.map((plugin) => {
                    const pluginBusy = openAiPluginActionId === plugin.id;
                    const runtimeState = marketplacePluginStates.get(plugin.id) ?? getMarketplacePluginRuntimeState(plugin, mcpServers, skillRegistry);

                    return (
                      <article key={plugin.id} className="apps-plugin-marketplace-card" data-status={runtimeState.statusKind}>
                        <div className="apps-plugin-marketplace-card-top">
                          <span className="apps-mcp-card-avatar" aria-hidden="true">{getPluginInitials(plugin.displayName)}</span>
                          <span>
                            <strong>{plugin.displayName}</strong>
                            <small>{plugin.category} | {runtimeState.statusLabel}</small>
                          </span>
                          <em>{runtimeState.routeLabel}</em>
                        </div>
                        <p>{runtimeState.description}</p>
                        <div className="apps-mcp-preset-tags" aria-label={`${plugin.displayName} tags`}>
                          {runtimeState.tags.map((tag) => <em key={tag}>{tag}</em>)}
                        </div>
                        <div className="apps-plugin-marketplace-actions">
                          <button
                            className="apps-plugin-primary"
                            type="button"
                            disabled={pluginBusy || runtimeState.primaryDisabled || (plugin.installRoute === "mcp-preset" && mcpBusy)}
                            onClick={() => void handleOpenAiPluginPrimaryAction(plugin)}
                          >
                            {pluginBusy ? "Working" : runtimeState.primaryActionLabel}
                          </button>
                          {plugin.hasBundledSkills && plugin.installRoute !== "skill-import" ? (
                            <button className="apps-plugin-secondary" type="button" disabled={pluginBusy || runtimeState.secondaryDisabled} onClick={() => runtimeState.skillCount > 0 ? viewPluginSkills(plugin) : void installOpenAiPluginSkills(plugin)}>
                              {runtimeState.secondaryActionLabel ?? "Skills"}
                            </button>
                          ) : null}
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="apps-empty-state">
                  <Puzzle size={20} aria-hidden="true" />
                  <span>
                    <strong>No marketplace plugins match</strong>
                    <small>Try Figma, Slack, Notion, Vercel, Stripe, Supabase, or Developer Docs.</small>
                  </span>
                </div>
              )}

              {openAiFilteredPlugins.length > OPENAI_PLUGIN_PAGE_SIZE ? (
                <div className="apps-mcp-pagination" aria-label="Gilbert plugin marketplace pagination">
                  <span>{openAiPluginPageStart + 1}-{Math.min(openAiPluginPageStart + OPENAI_PLUGIN_PAGE_SIZE, openAiFilteredPlugins.length)} of {openAiFilteredPlugins.length}</span>
                  <button type="button" disabled={openAiPluginCurrentPage === 0} onClick={() => setOpenAiPluginPage((page) => Math.max(0, page - 1))}>Previous</button>
                  <button type="button" disabled={openAiPluginCurrentPage >= openAiPluginPageCount - 1} onClick={() => setOpenAiPluginPage((page) => Math.min(openAiPluginPageCount - 1, page + 1))}>Next</button>
                </div>
              ) : null}

              <div className="apps-plugin-safety">
                <ShieldCheck size={16} aria-hidden="true" />
                <span>Hosted connector IDs are not treated as live Gilbert tools. Gilbert only marks a plugin usable after native install, MCP test, or local skill import succeeds.</span>
              </div>
            </section>
          ) : null}

          {mcpMatchesSearch ? (
            <section className="apps-mcp-board" aria-label="MCP servers and catalog">
              <div className="apps-mcp-board-head">
                <div className="apps-mcp-heading">
                  <WebAppLogo className="apps-plugin-logo-mcp" fallback={<Server size={20} aria-hidden="true" />} src={APP_ICON_URLS.mcp} />
                  <span>
                    <strong>MCP Servers</strong>
                    <small>External tools, app servers, and command-line MCPs</small>
                  </span>
                  <span className="apps-plugin-status" data-kind={mcpStatusKind}>
                    {mcpConnected ? <CheckCircle2 size={14} aria-hidden="true" /> : <AlertCircle size={14} aria-hidden="true" />}
                    {mcpStatusLabel}
                  </span>
                </div>

                <div className="apps-mcp-board-actions">
                  <button className="apps-plugin-primary" type="button" disabled={mcpBusy && mcpActionState !== "refresh"} onClick={() => openMcpServerDialog()}>
                    <Plus size={15} aria-hidden="true" />
                    Add MCP
                  </button>
                  <button className="apps-plugin-secondary" type="button" disabled={mcpBusy || !mcpConfigured} onClick={() => void testAllMcpServers()}>
                    <RefreshCw size={14} aria-hidden="true" />
                    {mcpActionState === "test-all" ? "Testing" : "Test all"}
                  </button>
                  <button className="apps-plugin-secondary apps-plugin-icon-action" type="button" aria-label="Refresh MCP servers" title="Refresh MCP servers" disabled={mcpBusy || !mcpAvailable} onClick={() => void refreshMcpConnections()}>
                    <RefreshCw size={14} aria-hidden="true" />
                  </button>
                </div>
              </div>

              {mcpStatus ? (
                <div className="apps-plugin-message" data-kind={mcpStatus.kind}>
                  {mcpStatus.text}
                </div>
              ) : null}

              <div className="apps-mcp-summary-grid" aria-label="MCP status">
                <span>
                  <strong>{mcpEnabledCount}/{mcpMaxServers}</strong>
                  Enabled servers
                </span>
                <span>
                  <strong>{mcpToolCount}</strong>
                  Cached tools
                </span>
                <span>
                  <strong>HTTP</strong>
                  Streamable endpoints
                </span>
                <span>
                  <strong>stdio</strong>
                  Local commands
                </span>
              </div>

              <section className="apps-mcp-section" aria-label="Configured MCP servers">
                <div className="apps-mcp-panel-head">
                  <div className="apps-plugin-expanded-head">
                    <strong>Configured MCPs</strong>
                    <small>{mcpConfigured ? mcpAccountLabel : "Add a server card, test tools, then use it in chat."}</small>
                  </div>
                  <div className="apps-mcp-steps" aria-label="MCP setup steps">
                    <span>Add</span>
                    <span>Test</span>
                    <span>Chat</span>
                  </div>
                </div>

                <div className="apps-mcp-server-card-grid">
                  {mcpServers.map((server) => {
                    const tools = server.tools ?? [];

                    return (
                      <article key={server.id} className="apps-mcp-server-card" data-enabled={server.enabled} data-error={Boolean(server.lastError)}>
                        <div className="apps-mcp-card-top">
                          <span className="apps-mcp-card-avatar" aria-hidden="true">
                            <Server size={17} aria-hidden="true" />
                          </span>
                          <span>
                            <strong>{server.name}</strong>
                            <small>{formatMcpServerTarget(server)}</small>
                          </span>
                          <em>{server.transport === "stdio" ? "stdio" : "HTTP"}</em>
                        </div>
                        <p>{formatMcpServerDetail(server)}</p>
                        <div className="apps-mcp-tool-chip-list" aria-label={`${server.name} cached tools`}>
                          {tools.length > 0 ? tools.slice(0, 5).map((tool) => (
                            <em key={tool.name}>{tool.name}</em>
                          )) : <em>No cached tools</em>}
                          {tools.length > 5 ? <em>+{tools.length - 5}</em> : null}
                        </div>
                        <div className="apps-mcp-card-actions">
                          <button type="button" disabled={mcpBusy} onClick={() => openMcpServerDialog(server)}>
                            <Wrench size={14} aria-hidden="true" />
                            Edit
                          </button>
                          <button type="button" disabled={mcpBusy || !server.enabled} onClick={() => void refreshMcpServerTools(server.id)}>
                            <RefreshCw size={14} aria-hidden="true" />
                            Tools
                          </button>
                          <button className="mcp-server-remove-button" type="button" disabled={mcpBusy} onClick={() => void removeConfiguredMcpServer(server)}>
                            <Trash2 size={14} aria-hidden="true" />
                          </button>
                        </div>
                      </article>
                    );
                  })}

                  <button className="apps-mcp-add-server-card" type="button" disabled={mcpBusy || !mcpAvailable} onClick={() => openMcpServerDialog()}>
                    <span className="apps-mcp-card-avatar" aria-hidden="true">
                      <Plus size={18} aria-hidden="true" />
                    </span>
                    <strong>Add custom MCP</strong>
                    <small>Remote HTTPS, localhost development, or command-line stdio server.</small>
                  </button>
                </div>
              </section>

              <section className="apps-mcp-section" aria-label="Featured MCP connectors">
                <div className="apps-mcp-panel-head">
                  <div className="apps-plugin-expanded-head">
                    <strong>Featured MCPs</strong>
                    <small>{MCP_FEATURED_PRESETS.length} curated app, cloud, database, design, and docs servers</small>
                  </div>
                  <div className="apps-mcp-pagination" aria-label="Featured MCP pagination">
                    <span>{mcpPresetPageStart + 1}-{Math.min(mcpPresetPageStart + MCP_PRESET_PAGE_SIZE, MCP_FEATURED_PRESETS.length)} of {MCP_FEATURED_PRESETS.length}</span>
                    <button type="button" disabled={mcpPresetCurrentPage === 0} onClick={() => setMcpPresetPage((page) => Math.max(0, page - 1))}>Previous</button>
                    <button type="button" disabled={mcpPresetCurrentPage >= mcpPresetPageCount - 1} onClick={() => setMcpPresetPage((page) => Math.min(mcpPresetPageCount - 1, page + 1))}>Next</button>
                  </div>
                </div>
                <div className="apps-mcp-preset-grid">
                  {mcpVisiblePresets.map((preset) => (
                    <button key={preset.id} className="apps-mcp-preset-card" type="button" disabled={mcpBusy} onClick={() => configureMcpPreset(preset)}>
                      <span className="apps-mcp-card-top">
                        <span className="apps-mcp-card-avatar" aria-hidden="true">{getMcpPresetInitials(preset)}</span>
                        <span>
                          <strong>{preset.name}</strong>
                          <small>{preset.publisher}</small>
                        </span>
                        <em>{preset.transport === "stdio" ? "stdio" : "HTTP"}</em>
                      </span>
                      <small>{preset.description}</small>
                      <span className="apps-mcp-preset-tags">
                        {preset.tags.slice(0, 3).map((tag) => (
                          <em key={tag}>{tag}</em>
                        ))}
                      </span>
                    </button>
                  ))}
                </div>
              </section>

              <section className="apps-mcp-section" aria-label="MCP Registry search">
                <div className="apps-plugin-expanded-head">
                  <strong>MCP Registry</strong>
                  <small>Search public MCP servers and generate a Gilbert configuration</small>
                </div>
                <form className="apps-mcp-registry-search" onSubmit={(event) => {
                  event.preventDefault();
                  void searchMcpRegistryCatalog();
                }}>
                  <Search size={15} aria-hidden="true" />
                  <input value={mcpRegistryQuery} placeholder="Search supabase, firebase, aws, figma..." onChange={(event) => setMcpRegistryQuery(event.target.value)} />
                  <button type="submit" disabled={mcpRegistryBusy || !mcpAvailable}>
                    {mcpRegistryBusy ? "Searching" : "Search"}
                  </button>
                </form>
                {mcpRegistryStatus ? (
                  <div className="apps-plugin-message" data-kind={mcpRegistryStatus.kind}>
                    {mcpRegistryStatus.text}
                  </div>
                ) : null}
                {mcpRegistryResults.length > 0 ? (
                  <div className="apps-mcp-registry-results" aria-label="MCP Registry results">
                    {mcpVisibleRegistryResults.map((server) => (
                      <article key={`${server.name}-${server.version ?? "latest"}`}>
                        <span>
                          <strong>{formatMcpRegistryServerName(server)}</strong>
                          <small>{formatMcpRegistryServerMeta(server)}</small>
                        </span>
                        <p>{server.description ?? "No description published for this MCP server."}</p>
                        <button type="button" disabled={!server.install || mcpBusy} onClick={() => configureMcpRegistryServer(server)}>
                          {server.install ? "Configure" : "No install hint"}
                        </button>
                      </article>
                    ))}
                  </div>
                ) : null}
                {mcpRegistryResults.length > MCP_REGISTRY_PAGE_SIZE ? (
                  <div className="apps-mcp-pagination" aria-label="MCP Registry pagination">
                    <span>{mcpRegistryPageStart + 1}-{Math.min(mcpRegistryPageStart + MCP_REGISTRY_PAGE_SIZE, mcpRegistryResults.length)} of {mcpRegistryResults.length}</span>
                    <button type="button" disabled={mcpRegistryCurrentPage === 0} onClick={() => setMcpRegistryPage((page) => Math.max(0, page - 1))}>Previous</button>
                    <button type="button" disabled={mcpRegistryCurrentPage >= mcpRegistryPageCount - 1} onClick={() => setMcpRegistryPage((page) => Math.min(mcpRegistryPageCount - 1, page + 1))}>Next</button>
                  </div>
                ) : null}
              </section>

              <div className="apps-plugin-safety">
                <ShieldCheck size={16} aria-hidden="true" />
                <span>Bearer tokens and stdio environment values stay in OS-backed secure storage; chat gets server inventory, tool discovery, and gated tool calls.</span>
              </div>
            </section>
          ) : null}

          {skillsMatchesSearch ? (
            <SkillsManagerPanel searchQuery={normalizedSearchQuery} />
          ) : null}

          {visibleCardCount === 0 ? (
            <div className="apps-empty-state">
              <Puzzle size={20} aria-hidden="true" />
              <span>
                <strong>No apps match</strong>
                <small>Try Gmail, Calendar, GitHub, Skills, MCP, plugins, or email.</small>
              </span>
            </div>
          ) : null}
        </section>
      </main>

      {gmailConnectOpen ? (
        <DialogShell
        description={`${gmailAccountRows.length}/${gmailMaxAccounts} connected`}
        icon={Mail}
        open={gmailConnectOpen}
        title="Gmail accounts"
        onClose={() => setGmailConnectOpen(false)}
      >
        <div className="gmail-connect-dialog">
          <section className="gmail-account-manager" aria-label="Connected Gmail accounts">
            <div className="gmail-account-manager-heading">
              <span>
                <strong>Accounts</strong>
                <small>{gmailAccountRows.length}/{gmailMaxAccounts} connected</small>
              </span>
              <button className="gmail-account-add-button" type="button" disabled={gmailBusy || !gmailCanAddAccount || !gmailAvailable} onClick={() => void startGmailConnection()}>
                <LogIn size={15} aria-hidden="true" />
                Sign in
              </button>
            </div>

            {gmailAccountRows.length > 0 ? (
              <div className="gmail-account-list">
                {gmailAccountRows.map((account) => (
                  <div key={account.email} className="gmail-account-row" data-active={account.active}>
                    <span className="gmail-account-avatar">
                      {account.user.picture ? <img src={account.user.picture} alt="" decoding="async" loading="lazy" referrerPolicy="no-referrer" /> : <Mail size={16} aria-hidden="true" />}
                    </span>
                    <span className="gmail-account-details">
                      <strong>{account.email}</strong>
                      <small>{account.active ? "Active" : "Connected"}</small>
                    </span>
                    <span className="gmail-account-actions">
                      {account.active ? (
                        <span className="gmail-account-active-badge">
                          <UserCheck size={14} aria-hidden="true" />
                          Active
                        </span>
                      ) : (
                        <button type="button" disabled={gmailBusy} onClick={() => void activateGmailAccount(account.email)}>
                          <UserCheck size={14} aria-hidden="true" />
                          Use
                        </button>
                      )}
                      <button className="gmail-account-signout-button" type="button" disabled={gmailBusy} onClick={() => void disconnectConnectedGmailAccount(account.email)}>
                        <LogOut size={14} aria-hidden="true" />
                        Sign out
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="gmail-account-empty">
                <Mail size={18} aria-hidden="true" />
                <span>
                  <strong>No Gmail account connected</strong>
                  <small>Sign in to connect an account.</small>
                </span>
              </div>
            )}
          </section>

          {gmailStatus && gmailStatus.kind !== "success" ? (
            <div className="gmail-connect-status" data-kind={gmailStatus.kind}>
              {gmailStatus.text}
            </div>
          ) : null}
        </div>
        </DialogShell>
      ) : null}

      {calendarConnectOpen ? (
        <DialogShell
        description={`${calendarAccountRows.length}/${calendarMaxAccounts} connected`}
        icon={CalendarDays}
        open={calendarConnectOpen}
        title="Google Calendar accounts"
        onClose={() => setCalendarConnectOpen(false)}
      >
        <div className="gmail-connect-dialog">
          <section className="gmail-account-manager" aria-label="Connected Google Calendar accounts">
            <div className="gmail-account-manager-heading">
              <span>
                <strong>Accounts</strong>
                <small>{calendarAccountRows.length}/{calendarMaxAccounts} connected</small>
              </span>
              <button className="gmail-account-add-button" type="button" disabled={calendarBusy || !calendarCanAddAccount || !calendarAvailable} onClick={() => void startCalendarConnection()}>
                <LogIn size={15} aria-hidden="true" />
                Sign in
              </button>
            </div>

            {calendarAccountRows.length > 0 ? (
              <div className="gmail-account-list">
                {calendarAccountRows.map((account) => (
                  <div key={account.email} className="gmail-account-row" data-active={account.active}>
                    <span className="gmail-account-avatar">
                      {account.user.picture ? <img src={account.user.picture} alt="" decoding="async" loading="lazy" referrerPolicy="no-referrer" /> : <CalendarDays size={16} aria-hidden="true" />}
                    </span>
                    <span className="gmail-account-details">
                      <strong>{account.email}</strong>
                      <small>{account.active ? "Active" : "Connected"}</small>
                    </span>
                    <span className="gmail-account-actions">
                      {account.active ? (
                        <span className="gmail-account-active-badge">
                          <UserCheck size={14} aria-hidden="true" />
                          Active
                        </span>
                      ) : (
                        <button type="button" disabled={calendarBusy} onClick={() => void activateCalendarAccount(account.email)}>
                          <UserCheck size={14} aria-hidden="true" />
                          Use
                        </button>
                      )}
                      <button className="gmail-account-signout-button" type="button" disabled={calendarBusy} onClick={() => void disconnectConnectedCalendarAccount(account.email)}>
                        <LogOut size={14} aria-hidden="true" />
                        Sign out
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="gmail-account-empty">
                <CalendarDays size={18} aria-hidden="true" />
                <span>
                  <strong>No Google Calendar account connected</strong>
                  <small>Sign in to connect an account.</small>
                </span>
              </div>
            )}
          </section>

          {calendarStatus && calendarStatus.kind !== "success" ? (
            <div className="gmail-connect-status" data-kind={calendarStatus.kind}>
              {calendarStatus.text}
            </div>
          ) : null}
        </div>
        </DialogShell>
      ) : null}

      {mcpDialogOpen ? (
        <DialogShell
        description={`Connect up to ${mcpMaxServers} Streamable HTTP or command-line stdio MCP servers. Enabled servers become available to chat as MCP tools when settings allow them.`}
        icon={Server}
        open={mcpDialogOpen}
        title="Manage MCP servers"
        onClose={() => setMcpDialogOpen(false)}
        actions={
          <>
            <button className="dialog-button" type="button" onClick={() => setMcpDialogOpen(false)}>
              Close
            </button>
            <button className="dialog-button dialog-button-primary" type="button" disabled={mcpBusy || !mcpAvailable} onClick={() => openMcpServerDialog()}>
              <Plus size={15} aria-hidden="true" />
              New server
            </button>
          </>
        }
      >
        <div className="mcp-connect-dialog">
          <section className="mcp-server-manager" aria-label="Configured MCP servers">
            <div className="gmail-account-manager-heading">
              <span>
                <strong>Servers</strong>
                <small>{mcpEnabledCount}/{mcpMaxServers} enabled | {mcpToolCount} cached tools</small>
              </span>
              <button className="gmail-account-add-button" type="button" disabled={mcpBusy || !mcpAvailable} onClick={() => void refreshMcpConnections()}>
                <RefreshCw size={15} aria-hidden="true" />
                Refresh
              </button>
            </div>

            {mcpServers.length > 0 ? (
              <div className="mcp-server-list">
                {mcpServers.map((server) => (
                  <div key={server.id} className="mcp-server-row" data-enabled={server.enabled}>
                    <span className="mcp-server-avatar">
                      <Server size={17} aria-hidden="true" />
                    </span>
                    <span className="mcp-server-details">
                      <strong>{server.name}</strong>
                      <small>{formatMcpServerTarget(server)}</small>
                      <small>{formatMcpServerDetail(server)}</small>
                    </span>
                    <span className="mcp-server-actions">
                      <button type="button" disabled={mcpBusy} onClick={() => openMcpServerDialog(server)}>
                        <Wrench size={14} aria-hidden="true" />
                        Edit
                      </button>
                      <button type="button" disabled={mcpBusy} onClick={() => void refreshMcpServerTools(server.id)}>
                        <RefreshCw size={14} aria-hidden="true" />
                        Tools
                      </button>
                      <button className="mcp-server-remove-button" type="button" disabled={mcpBusy} onClick={() => void removeConfiguredMcpServer(server)}>
                        <Trash2 size={14} aria-hidden="true" />
                        Remove
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="gmail-account-empty">
                <Server size={18} aria-hidden="true" />
                <span>
                  <strong>No MCP server connected</strong>
                  <small>Add a remote HTTPS server or a localhost development endpoint.</small>
                </span>
              </div>
            )}
          </section>

          <section className="mcp-server-form" aria-label={mcpDraft.id ? "Edit MCP server" : "Add MCP server"}>
            <div className="gmail-connect-permissions-heading">
              <Server size={16} aria-hidden="true" />
              <span>{mcpDraft.id ? "Edit server" : "Add server"}</span>
            </div>

            <div className="mcp-form-grid">
              <div className="mcp-transport-tabs" role="group" aria-label="MCP transport">
                <button type="button" data-active={mcpDraft.transport === "http"} onClick={() => setMcpDraft((draft) => ({ ...draft, transport: "http" }))}>
                  <Globe2 size={14} aria-hidden="true" />
                  HTTP
                </button>
                <button type="button" data-active={mcpDraft.transport === "stdio"} onClick={() => setMcpDraft((draft) => ({ ...draft, transport: "stdio" }))}>
                  <TerminalSquare size={14} aria-hidden="true" />
                  Stdio
                </button>
              </div>
              <label className="mcp-field">
                <span>Name</span>
                <input value={mcpDraft.name} placeholder={mcpDraft.transport === "stdio" ? "Local Echo" : "Docs tools"} onChange={(event) => setMcpDraft((draft) => ({ ...draft, name: event.target.value }))} />
              </label>
              {mcpDraft.transport === "http" ? (
                <>
                  <label className="mcp-field">
                    <span>Endpoint</span>
                    <input value={mcpDraft.endpoint} placeholder="https://example.com/mcp" onChange={(event) => setMcpDraft((draft) => ({ ...draft, endpoint: event.target.value }))} />
                  </label>
                  <label className="mcp-field">
                    <span>Bearer token</span>
                    <input
                      type="password"
                      value={mcpDraft.authorizationToken}
                      placeholder={mcpDraft.id ? "Leave blank to keep saved token" : "Optional"}
                      onChange={(event) => setMcpDraft((draft) => ({ ...draft, authorizationToken: event.target.value }))}
                    />
                  </label>
                </>
              ) : (
                <>
                  <label className="mcp-field">
                    <span>Command</span>
                    <input value={mcpDraft.command} placeholder="node" onChange={(event) => setMcpDraft((draft) => ({ ...draft, command: event.target.value }))} />
                  </label>
                  <label className="mcp-field mcp-field-wide">
                    <span>Arguments</span>
                    <textarea value={mcpDraft.argsText} placeholder={"server.js\n--flag=value"} rows={3} onChange={(event) => setMcpDraft((draft) => ({ ...draft, argsText: event.target.value }))} />
                  </label>
                  <label className="mcp-field">
                    <span>Working directory</span>
                    <input value={mcpDraft.workingDirectory} placeholder="Optional folder path" onChange={(event) => setMcpDraft((draft) => ({ ...draft, workingDirectory: event.target.value }))} />
                  </label>
                  <label className="mcp-field mcp-field-wide">
                    <span>Environment</span>
                    <textarea value={mcpDraft.environmentText} placeholder={"API_KEY=secret\nMODEL=local"} rows={3} onChange={(event) => setMcpDraft((draft) => ({ ...draft, environmentText: event.target.value }))} />
                  </label>
                </>
              )}
              <label className="mcp-toggle">
                <input type="checkbox" checked={mcpDraft.enabled} onChange={(event) => setMcpDraft((draft) => ({ ...draft, enabled: event.target.checked }))} />
                <span>Enable this server for chat tools</span>
              </label>
            </div>

            <div className="mcp-form-actions">
              <button type="button" disabled={mcpBusy || !mcpAvailable} onClick={() => void testMcpDraftConnection()}>
                <RefreshCw size={15} aria-hidden="true" />
                Test
              </button>
              <button className="mcp-form-primary" type="button" disabled={mcpBusy || !mcpAvailable} onClick={() => void saveAndTestMcpServer()}>
                <CheckCircle2 size={15} aria-hidden="true" />
                {mcpActionState === "save" ? "Saving" : mcpActionState === "test" ? "Testing" : "Save and test"}
              </button>
            </div>
          </section>

          {mcpProgressEvents.length > 0 ? (
            <div className="mcp-progress-panel" aria-live="polite" aria-label="MCP startup progress">
              <div className="mcp-progress-heading">
                <RefreshCw size={14} aria-hidden="true" />
                <span>{mcpActionState === "test" || mcpActionState === "save" ? "Starting MCP" : "Last MCP startup"}</span>
              </div>
              <div className="mcp-progress-list">
                {mcpProgressEvents.map((event, index) => (
                  <span key={`${event.kind}-${index}`} data-kind={event.kind}>
                    <strong>{formatMcpProgressKind(event.kind)}</strong>
                    <small>{event.message}</small>
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {mcpStatus ? (
            <div className="gmail-connect-status" data-kind={mcpStatus.kind}>
              {mcpStatus.text}
            </div>
          ) : null}

          <div className="gmail-connect-quick-notes" aria-label="MCP connection behavior">
            <span>
              <KeyRound size={15} aria-hidden="true" />
              HTTP bearer tokens and stdio environment values are stored in the desktop secure store.
            </span>
            <span>
              <ShieldCheck size={15} aria-hidden="true" />
              Chat calls use mcp_list_servers, mcp_list_tools, and approval-gated mcp_call_tool.
            </span>
          </div>
        </div>
        </DialogShell>
      ) : null}
    </section>
  );
}

function WebAppLogo({ className, fallback, src }: { className: string; fallback: ReactNode; src: string }) {
  const [failed, setFailed] = useState(false);

  return (
    <span className={`apps-plugin-logo ${className}`}>
      {failed ? fallback : <img src={src} alt="" aria-hidden="true" decoding="async" draggable={false} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />}
    </span>
  );
}

function formatConnectedGmailStatus(connection: GmailConnectionState) {
  const accounts = normalizeGmailAccountRows(connection);
  const maxAccounts = connection.maxAccounts || GMAIL_ACCOUNT_LIMIT;
  const activeEmail = connection.activeAccountEmail ?? accounts.find((account) => account.active)?.email ?? connection.user?.email;

  if (accounts.length > 0) {
    return `Gmail connected: ${accounts.length}/${maxAccounts} accounts${activeEmail ? `, active ${activeEmail}` : ""}.`;
  }

  return `Gmail connected as ${connection.user?.email ?? "your account"}.`;
}

function normalizeGmailAccountRows(connection: GmailConnectionState): GmailAccountState[] {
  if (connection.accounts?.length) {
    return connection.accounts;
  }

  if (connection.connected && connection.user?.email) {
    return [
      {
        active: true,
        connectedAt: connection.connectedAt,
        email: connection.user.email,
        expiresAt: connection.expiresAt,
        scopes: connection.scopes,
        user: connection.user,
      },
    ];
  }

  return [];
}

function formatGmailConnectionError(error: unknown) {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "Could not connect Gmail.";
  const normalized = message.toLowerCase();

  if (normalized.includes("timed out") || normalized.includes("access_denied") || normalized.includes("did not authorize")) {
    return "Gmail plugin is installed locally, but Google did not approve this account connection. If Google says the app is in testing or only developer-approved testers can access it, add this Google account under Google Auth Platform > Audience > Test users, then try Connect Google again.";
  }

  if (normalized.includes("client_secret is missing") || normalized.includes("oauth client secret is missing")) {
    return "Gmail plugin is installed locally, but Google OAuth is missing the matching Client secret. Add it in Settings > Google, then try Connect Google again.";
  }

  return message;
}

function formatConnectedCalendarStatus(connection: CalendarConnectionState) {
  const accounts = normalizeCalendarAccountRows(connection);
  const maxAccounts = connection.maxAccounts || GOOGLE_CALENDAR_ACCOUNT_LIMIT;
  const activeEmail = connection.activeAccountEmail ?? accounts.find((account) => account.active)?.email ?? connection.user?.email;

  if (accounts.length > 0) {
    return `Google Calendar connected: ${accounts.length}/${maxAccounts} accounts${activeEmail ? `, active ${activeEmail}` : ""}.`;
  }

  return `Google Calendar connected as ${connection.user?.email ?? "your account"}.`;
}

function formatConnectedGithubStatus(connection: GithubConnectionState, repositories: GithubRepository[]) {
  const login = connection.user?.login ?? "your GitHub account";
  const repositorySummary = repositories.length > 0
    ? `${repositories.length} repository preview${repositories.length === 1 ? "" : "s"} loaded`
    : "no repository preview loaded";

  return `GitHub connected as ${login}; ${repositorySummary}.`;
}

function getMcpPresetInitials(preset: McpProviderPreset) {
  return getPluginInitials(preset.name);
}

function getPluginInitials(name: string) {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function getMarketplacePluginRuntimeState(
  plugin: OpenAiCodexPluginListing,
  mcpServers: McpServerState[],
  skillRegistry: SkillRegistryState,
): MarketplacePluginRuntimeState {
  const importedSkills = getImportedSkillsForPlugin(plugin, skillRegistry);
  const skillCount = importedSkills.length;
  const enabledSkillCount = importedSkills.filter((skill) => skill.enabled).length;
  const mcpPreset = plugin.mcpPresetId
    ? MCP_FEATURED_PRESETS.find((preset) => preset.id === plugin.mcpPresetId)
    : undefined;
  const mcpServer = mcpPreset ? findMcpServerForPreset(mcpServers, mcpPreset) : undefined;
  const authTag = plugin.authPolicy === "ON_INSTALL" ? "Auth required" : "Auth on use";

  if (plugin.installRoute === "mcp-preset") {
    if (mcpServer) {
      const toolCount = mcpServer.tools?.length ?? 0;
      const connected = Boolean(mcpServer.enabled && !mcpServer.lastError && (toolCount > 0 || mcpServer.lastConnectedAt));
      const tags = [
        connected ? `${toolCount} tool${toolCount === 1 ? "" : "s"}` : mcpServer.lastError ? "Needs fix" : "Needs test",
        mcpServer.enabled ? "Enabled" : "Disabled",
        mcpServer.hasAuthorizationToken || (mcpServer.environment ?? []).some((item) => item.hasValue) ? "Auth saved" : authTag,
        skillCount > 0 ? `${skillCount} skill${skillCount === 1 ? "" : "s"} installed` : plugin.hasBundledSkills ? "Skills available" : undefined,
      ].filter(Boolean) as string[];

      return {
        description: connected
          ? "Installed MCP server with discovered tools available to chat when MCP tools are enabled."
          : "Installed as an MCP server. Test or refresh it before relying on chat tool calls.",
        mcpServer,
        primaryActionLabel: "Manage",
        primaryDisabled: false,
        routeLabel: connected ? "Connected" : "Installed",
        secondaryActionLabel: skillCount > 0 ? "Skills installed" : "Install skills",
        skillCount,
        statusKind: connected ? "connected" : "installed",
        statusLabel: connected ? "Connected" : "Installed",
        tags,
      };
    }

    return {
      description: "Maps to a curated MCP setup that Gilbert can save, test, and expose to chat.",
      primaryActionLabel: "Configure MCP",
      primaryDisabled: false,
      routeLabel: "MCP",
      secondaryActionLabel: skillCount > 0 ? "Skills installed" : "Install skills",
      skillCount,
      statusKind: "ready",
      statusLabel: "Ready",
      tags: [
        "MCP preset",
        "Needs install",
        authTag,
        skillCount > 0 ? `${skillCount} skill${skillCount === 1 ? "" : "s"} installed` : plugin.hasBundledSkills ? "Skills available" : undefined,
      ].filter(Boolean) as string[],
    };
  }

  if (plugin.installRoute === "skill-import") {
    if (skillCount > 0) {
      return {
        description: "Installed local skill workflows are enabled for prompts and skill mentions.",
        primaryActionLabel: "View skills",
        primaryDisabled: false,
        routeLabel: "Installed",
        skillCount,
        statusKind: enabledSkillCount > 0 ? "connected" : "installed",
        statusLabel: "Installed",
        tags: [
          `${skillCount} skill${skillCount === 1 ? "" : "s"} installed`,
          enabledSkillCount > 0 ? `${enabledSkillCount} enabled` : "Disabled",
          authTag,
        ],
      };
    }

    return {
      description: "Imports bundled skills into Gilbert's local skill registry.",
      primaryActionLabel: "Install skills",
      primaryDisabled: false,
      routeLabel: "Skills",
      skillCount,
      statusKind: "ready",
      statusLabel: "Ready",
      tags: ["Bundled skills", authTag],
    };
  }

  if (plugin.installRoute === "native") {
    return {
      description: "Built into Gilbert with app-owned auth, local state, and approval-gated tools.",
      primaryActionLabel: "Install",
      primaryDisabled: false,
      routeLabel: "Native",
      skillCount,
      statusKind: "ready",
      statusLabel: "Ready",
      tags: ["Native", authTag],
    };
  }

  return {
    description: "Searches the public MCP Registry for a runnable server or hosted replacement.",
    primaryActionLabel: "Find MCP",
    primaryDisabled: false,
    routeLabel: "Registry",
    skillCount,
    statusKind: "ready",
    statusLabel: "Ready",
    tags: ["Registry search", "Connector metadata", authTag],
  };
}

function getImportedSkillsForPlugin(plugin: OpenAiCodexPluginListing, skillRegistry: SkillRegistryState) {
  const idPrefix = `${plugin.id}-`;
  const displayNamePrefix = `${plugin.displayName.toLowerCase()}:`;

  return skillRegistry.skills.filter((skill) =>
    skill.installed &&
    skill.source === "imported" &&
    (
      skill.id.startsWith(idPrefix) ||
      skill.tags.includes(plugin.id) ||
      skill.name.toLowerCase().startsWith(displayNamePrefix)
    ),
  );
}

function findMcpServerForPreset(servers: McpServerState[], preset: McpProviderPreset) {
  return servers.find((server) => serverMatchesMcpPreset(server, preset));
}

function serverMatchesMcpPreset(server: McpServerState, preset: McpProviderPreset) {
  if (server.transport !== preset.transport) {
    return false;
  }

  if (preset.transport === "http") {
    return normalizeMcpEndpoint(server.endpoint) === normalizeMcpEndpoint(preset.endpoint);
  }

  return normalizeMcpCommand(server.command) === normalizeMcpCommand(preset.command) &&
    normalizeMcpArgs(server.args).join("\n") === normalizeMcpArgs(preset.args).join("\n");
}

function normalizeMcpEndpoint(value?: string) {
  return (value ?? "").trim().replace(/\/+$/g, "").toLowerCase();
}

function normalizeMcpCommand(value?: string) {
  return (value ?? "").trim().replace(/\.cmd$/i, "").toLowerCase();
}

function normalizeMcpArgs(value?: string[]) {
  return (value ?? []).map((item) => item.trim()).filter(Boolean);
}

function formatMcpProgressKind(kind: string) {
  switch (kind) {
    case "download":
      return "Download";
    case "error":
      return "Error";
    case "finished":
      return "Ready";
    case "output":
      return "Output";
    case "started":
      return "Start";
    default:
      return "Step";
  }
}

function createDraftFromRegistryInstall(server: McpRegistryServerSummary, install: McpRegistryInstallHint): McpServerDraft {
  const name = formatMcpRegistryServerName(server);

  if (install.transport === "stdio") {
    return {
      ...EMPTY_MCP_DRAFT,
      argsText: install.args.join("\n"),
      command: install.command ?? "",
      name,
      transport: "stdio",
    };
  }

  return {
    ...EMPTY_MCP_DRAFT,
    endpoint: install.endpoint ?? "",
    name,
    transport: "http",
  };
}

function formatMcpRegistryServerName(server: McpRegistryServerSummary) {
  if (server.title?.trim()) {
    return server.title.trim();
  }

  const rawName = server.name.split("/").pop() ?? server.name;

  return rawName
    .replace(/^mcp[-_]/i, "")
    .replace(/[-_]?mcp[-_]?server$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim() || server.name;
}

function formatMcpRegistryServerMeta(server: McpRegistryServerSummary) {
  const install = server.install;
  const installLabel = install
    ? install.transport === "stdio"
      ? [install.command, ...(install.args ?? [])].filter(Boolean).join(" ")
      : install.endpoint
    : "manual setup";
  const parts = [
    server.official ? "Official registry" : "Registry",
    server.status,
    server.version ? `v${server.version}` : undefined,
    installLabel,
  ].filter(Boolean);

  return parts.join(" | ");
}

function normalizeCalendarAccountRows(connection: CalendarConnectionState): CalendarAccountState[] {
  if (connection.accounts?.length) {
    return connection.accounts;
  }

  if (connection.connected && connection.user?.email) {
    return [
      {
        active: true,
        connectedAt: connection.connectedAt,
        email: connection.user.email,
        expiresAt: connection.expiresAt,
        scopes: connection.scopes,
        user: connection.user,
      },
    ];
  }

  return [];
}

function formatCalendarConnectionError(error: unknown) {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "Could not connect Google Calendar.";
  const normalized = message.toLowerCase();

  if (normalized.includes("timed out") || normalized.includes("access_denied") || normalized.includes("did not authorize")) {
    return "Google Calendar plugin is installed locally, but Google did not approve this account connection. If Google says the app is in testing or only developer-approved testers can access it, add this Google account under Google Auth Platform > Audience, then try Connect Google again.";
  }

  if (normalized.includes("client_secret is missing") || normalized.includes("oauth client secret is missing")) {
    return "Google Calendar plugin is installed locally, but Google OAuth is missing the matching Client secret. Add it in Settings > Google, then try Connect Google again.";
  }

  return message;
}

function createMcpSaveRequest(draft: McpServerDraft): { ok: true; value: McpSaveServerRequest } | { error: string; ok: false } {
  const base = createMcpTestRequest(draft);

  if (!base.ok) {
    return base;
  }

  const name = draft.name.trim();

  if (!name) {
    return { error: "Add a server name before saving.", ok: false };
  }

  return {
    ok: true,
    value: {
      ...base.value,
      enabled: draft.enabled,
      id: draft.id || undefined,
      name,
    },
  };
}

function createMcpTestRequest(draft: McpServerDraft): { ok: true; value: McpTestServerRequest } | { error: string; ok: false } {
  if (draft.transport === "stdio") {
    const command = draft.command.trim();

    if (!command) {
      return { error: "Add a command before testing this stdio MCP server.", ok: false };
    }

    const parsedEnvironment = parseMcpEnvironmentText(draft.environmentText);

    if (!parsedEnvironment.ok) {
      return parsedEnvironment;
    }

    return {
      ok: true,
      value: {
        args: parseMcpLines(draft.argsText),
        command,
        environment: parsedEnvironment.value,
        transport: "stdio",
        workingDirectory: draft.workingDirectory.trim() || undefined,
      },
    };
  }

  const endpoint = draft.endpoint.trim();

  if (!endpoint) {
    return { error: "Add an MCP endpoint before testing this HTTP server.", ok: false };
  }

  return {
    ok: true,
    value: {
      authorizationToken: draft.authorizationToken.trim() || undefined,
      endpoint,
      transport: "http",
    },
  };
}

function parseMcpLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseMcpEnvironmentText(value: string): { ok: true; value: Array<{ name: string; value: string }> } | { error: string; ok: false } {
  const environment: Array<{ name: string; value: string }> = [];

  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line) {
      continue;
    }

    const separator = line.indexOf("=");

    if (separator < 1) {
      return { error: "Environment lines must use NAME=value format.", ok: false };
    }

    const name = line.slice(0, separator).trim();

    if (!name || name.includes("=")) {
      return { error: "Environment variable names cannot be empty or contain equals signs.", ok: false };
    }

    environment.push({ name, value: line.slice(separator + 1).trim() });
  }

  return { ok: true, value: environment };
}

function formatMcpEnvironmentDraft(server: McpServerState) {
  return (server.environment ?? []).map((item) => `${item.name}=`).join("\n");
}

function formatMcpConnectionStatus(connection: McpConnectionState): AppsStatusMessage | null {
  const servers = connection.servers ?? [];
  const enabledCount = servers.filter((server) => server.enabled).length;

  if (enabledCount > 0) {
    const toolCount = servers.reduce((total, server) => total + (server.tools?.length ?? 0), 0);
    return { kind: "success", text: `MCP ready: ${enabledCount}/${connection.maxServers || MCP_SERVER_LIMIT} enabled servers with ${toolCount} cached tools.` };
  }

  if (servers.length > 0) {
    return { kind: "warning", text: "MCP servers are configured, but none are enabled for chat tools." };
  }

  return null;
}

function formatMcpServerTarget(server: McpServerState) {
  if (server.transport === "stdio") {
    const command = [server.command, ...(server.args ?? [])].filter(Boolean).join(" ");

    return command ? `stdio: ${command}` : "stdio server";
  }

  return server.endpoint ?? "HTTP endpoint";
}

function formatMcpServerDetail(server: McpServerState) {
  const transport = server.transport === "stdio" ? "Stdio" : "HTTP";
  const parts = [
    transport,
    server.enabled ? "Enabled" : "Disabled",
    `${server.tools?.length ?? 0} tool${(server.tools?.length ?? 0) === 1 ? "" : "s"}`,
    server.transport === "stdio"
      ? `${server.environment?.filter((item) => item.hasValue).length ?? 0} env secret${(server.environment?.filter((item) => item.hasValue).length ?? 0) === 1 ? "" : "s"}`
      : server.hasAuthorizationToken ? "Bearer token saved" : "No token",
    server.serverName ? `${server.serverName}${server.serverVersion ? ` ${server.serverVersion}` : ""}` : undefined,
    server.lastError ? `Last error: ${server.lastError}` : undefined,
  ].filter(Boolean);

  return parts.join(" | ");
}

function matchesAppsSearch(normalizedQuery: string, fields: Array<string | undefined>) {
  if (!normalizedQuery) {
    return true;
  }

  return fields
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(normalizedQuery);
}

function sectionMatches(activeSection: AppsCatalogSection, cardSection: Exclude<AppsCatalogSection, "all">) {
  return activeSection === "all" || activeSection === cardSection;
}

function getAppsSectionIcon(section: AppsCatalogSection) {
  if (section === "plugins") {
    return PlugZap;
  }

  if (section === "skills") {
    return Sparkles;
  }

  if (section === "mcp") {
    return Globe2;
  }

  return Puzzle;
}

function getAppsSectionMeta(section: AppsCatalogSection, metrics: { mcpEnabledCount: number; pluginCatalogCount: number }) {
  if (section === "plugins") {
    return String(metrics.pluginCatalogCount);
  }

  if (section === "skills") {
    return "Ready";
  }

  if (section === "mcp") {
    return metrics.mcpEnabledCount > 0 ? String(metrics.mcpEnabledCount) : "Ready";
  }

  return "5";
}
