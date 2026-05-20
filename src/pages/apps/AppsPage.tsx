import { type ReactNode, useEffect, useMemo, useState } from "react";
import { AlertCircle, ArrowLeft, BadgeCheck, CalendarDays, CheckCircle2, ChevronDown, Github, Globe2, KeyRound, LogIn, LogOut, Mail, Plus, PlugZap, Puzzle, RefreshCw, Search, Server, ShieldCheck, Sparkles, TerminalSquare, Trash2, UserCheck, Wrench, X } from "lucide-react";
import {
  connectGmailOAuth,
  disconnectGmailAccount as disconnectGmailAccountByEmail,
  getDefaultGmailOAuthScope,
  getDefaultGoogleOAuthClientId,
  getGmailState,
  gmailDesktopAvailable,
  GMAIL_CORE_OAUTH_SCOPES,
  installGmailPlugin,
  setActiveGmailAccount,
} from "../../app/gmailClient";
import {
  connectGoogleCalendarOAuth,
  disconnectGoogleCalendarAccount as disconnectGoogleCalendarAccountByEmail,
  getDefaultGoogleCalendarOAuthScope,
  getGoogleCalendarState,
  googleCalendarDesktopAvailable,
  GOOGLE_CALENDAR_CORE_OAUTH_SCOPES,
  installGoogleCalendarPlugin,
  setActiveGoogleCalendarAccount,
} from "../../app/googleCalendarClient";
import {
  getMcpState,
  listMcpServerTools,
  mcpDesktopAvailable,
  removeMcpServer,
  saveMcpServer,
  testMcpServer,
} from "../../app/mcpClient";
import {
  getGithubState,
  githubDesktopAvailable,
  installGithubPlugin,
  listGithubRepositories,
} from "../../app/githubClient";
import { DialogShell } from "../../components/dialogs/AppDialog";
import type { GithubConnectionState, GithubRepository } from "../../types/github";
import type { CalendarAccountState, CalendarConnectionState } from "../../types/googleCalendar";
import type { GmailAccountState, GmailConnectionState } from "../../types/gmail";
import type { McpConnectionState, McpSaveServerRequest, McpServerState, McpTestServerRequest, McpTransport } from "../../types/mcp";
import "../../styles/apps.css";

interface AppsPageProps {
  locationServicesEnabled: boolean;
  onBackToChat: () => void;
  onOpenGithubSettings: () => void;
  onOpenRadar: () => void;
  onOpenSupport: () => void;
}

type GmailActionState = "connect" | "disconnect" | "idle" | "install" | "refresh";
type CalendarActionState = "connect" | "disconnect" | "idle" | "install" | "refresh";
type GithubActionState = "idle" | "install" | "refresh";
type McpActionState = "idle" | "refresh" | "remove" | "save" | "test";
type AppsStatusMessage = { kind: "error" | "success" | "warning"; text: string };
type AppsCatalogSection = "all" | "mcp" | "plugins" | "skills";
const GMAIL_ACCOUNT_LIMIT = 6;
const GOOGLE_CALENDAR_ACCOUNT_LIMIT = 6;
const MCP_SERVER_LIMIT = 20;

const APP_ICON_URLS = {
  gmail: "https://cdn.simpleicons.org/gmail/EA4335",
  googleCalendar: "https://cdn.simpleicons.org/googlecalendar/4285F4",
  github: "https://cdn.simpleicons.org/github/FFFFFF",
  mcp: "https://modelcontextprotocol.io/favicon.ico",
  skills: "https://cdn.simpleicons.org/openai/FFFFFF",
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

const UPCOMING_APP_CARDS = [
  {
    id: "skills",
    section: "skills",
    title: "Skills",
    eyebrow: "Reusable intelligence",
    description: "Curated task playbooks, project workflows, and app-specific instructions that can be installed and searched from here.",
    tags: ["Prompt packs", "Workflows", "Team presets"],
  },
] as const;

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

export function AppsPage({ onBackToChat, onOpenGithubSettings }: AppsPageProps) {
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
  const [mcpStatus, setMcpStatus] = useState<AppsStatusMessage | null>(null);
  const googleTestingHint = import.meta.env.DEV ? " If Google shows access_denied because the app is in testing, add this Google account as a test user in Google Auth Platform > Audience." : "";
  const googleOAuthClientId = getDefaultGoogleOAuthClientId();
  const googleClientReady = Boolean(googleOAuthClientId);
  const gmailAvailable = gmailDesktopAvailable();
  const gmailBusy = gmailActionState !== "idle";
  const gmailMaxAccounts = gmailConnection.maxAccounts || GMAIL_ACCOUNT_LIMIT;
  const gmailAccountRows = normalizeGmailAccountRows(gmailConnection);
  const gmailActiveAccount = gmailAccountRows.find((account) => account.active) ?? gmailAccountRows[0];
  const gmailActiveEmail = gmailConnection.activeAccountEmail ?? gmailActiveAccount?.email ?? gmailConnection.user?.email;
  const gmailConnected = gmailConnection.connected || gmailAccountRows.length > 0;
  const gmailInstalled = gmailConnection.pluginInstalled || gmailConnected;
  const gmailNeedsSetup = Boolean(gmailConnection.lastConnectionError) && !gmailConnected;
  const gmailStatusLabel = gmailConnected ? "Connected" : gmailNeedsSetup ? "Needs setup" : gmailInstalled ? "Installed" : googleClientReady && gmailAvailable ? "Ready to install" : "Unavailable";
  const gmailStatusKind = gmailConnected ? "connected" : gmailNeedsSetup ? "setup" : gmailInstalled ? "installed" : googleClientReady && gmailAvailable ? "ready" : "setup";
  const gmailCanAddAccount = gmailAccountRows.length < gmailMaxAccounts;
  const gmailAccountLabel = gmailAccountRows.length > 0
    ? `${gmailAccountRows.length}/${gmailMaxAccounts} accounts connected${gmailActiveEmail ? ` | Active: ${gmailActiveEmail}` : ""}`
    : gmailInstalled
      ? "Installed locally. Google account not connected."
      : "Install to choose a Google account";
  const calendarAvailable = googleCalendarDesktopAvailable();
  const calendarBusy = calendarActionState !== "idle";
  const calendarMaxAccounts = calendarConnection.maxAccounts || GOOGLE_CALENDAR_ACCOUNT_LIMIT;
  const calendarAccountRows = normalizeCalendarAccountRows(calendarConnection);
  const calendarActiveAccount = calendarAccountRows.find((account) => account.active) ?? calendarAccountRows[0];
  const calendarActiveEmail = calendarConnection.activeAccountEmail ?? calendarActiveAccount?.email ?? calendarConnection.user?.email;
  const calendarConnected = calendarConnection.connected || calendarAccountRows.length > 0;
  const calendarInstalled = calendarConnection.pluginInstalled || calendarConnected;
  const calendarNeedsSetup = Boolean(calendarConnection.lastConnectionError) && !calendarConnected;
  const calendarStatusLabel = calendarConnected ? "Connected" : calendarNeedsSetup ? "Needs setup" : calendarInstalled ? "Installed" : googleClientReady && calendarAvailable ? "Ready to install" : "Unavailable";
  const calendarStatusKind = calendarConnected ? "connected" : calendarNeedsSetup ? "setup" : calendarInstalled ? "installed" : googleClientReady && calendarAvailable ? "ready" : "setup";
  const calendarCanAddAccount = calendarAccountRows.length < calendarMaxAccounts;
  const calendarAccountLabel = calendarAccountRows.length > 0
    ? `${calendarAccountRows.length}/${calendarMaxAccounts} accounts connected${calendarActiveEmail ? ` | Active: ${calendarActiveEmail}` : ""}`
    : calendarInstalled
      ? "Installed locally. Google account not connected."
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
  const mcpServers = mcpConnection.servers ?? [];
  const mcpEnabledCount = mcpServers.filter((server) => server.enabled).length;
  const mcpMaxServers = mcpConnection.maxServers || MCP_SERVER_LIMIT;
  const mcpToolCount = mcpServers.reduce((total, server) => total + (server.tools?.length ?? 0), 0);
  const mcpConfigured = mcpServers.length > 0;
  const mcpConnected = mcpConnection.connected || mcpEnabledCount > 0;
  const mcpStatusLabel = mcpConnected ? "Connected" : mcpConfigured ? "Configured" : mcpAvailable ? "Ready" : "Desktop only";
  const mcpStatusKind = mcpConnected ? "connected" : mcpConfigured ? "installed" : mcpAvailable ? "ready" : "setup";
  const mcpAccountLabel = mcpConfigured
    ? `${mcpEnabledCount}/${mcpMaxServers} enabled servers | ${mcpToolCount} cached tools`
    : mcpAvailable
      ? "Add a Streamable HTTP or stdio MCP server"
      : "Open the desktop app to connect MCP servers";
  const normalizedSearchQuery = appSearchQuery.trim().toLowerCase();
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
      ...githubRepos.flatMap((repo) => [repo.fullName, repo.description, repo.defaultBranch]),
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
      mcpStatusLabel,
      mcpAccountLabel,
      ...mcpServers.flatMap((server) => [server.name, server.endpoint, server.command, server.transport, server.serverName, ...(server.tools ?? []).map((tool) => tool.name)]),
    ]);
  const visibleUpcomingCards = useMemo(
    () =>
      UPCOMING_APP_CARDS.filter((card) => {
        if (!sectionMatches(activeCatalogSection, card.section)) {
          return false;
        }

        return matchesAppsSearch(normalizedSearchQuery, [
          card.title,
          card.section,
          card.eyebrow,
          card.description,
          "coming soon",
          ...card.tags,
        ]);
      }),
    [activeCatalogSection, normalizedSearchQuery],
  );
  const visibleCardCount = (gmailMatchesSearch ? 1 : 0) + (calendarMatchesSearch ? 1 : 0) + (githubMatchesSearch ? 1 : 0) + (mcpMatchesSearch ? 1 : 0) + visibleUpcomingCards.length;
  const gmailExpanded = expandedAppCardIds.has("gmail");
  const calendarExpanded = expandedAppCardIds.has("google-calendar");
  const githubExpanded = expandedAppCardIds.has("github");
  const mcpExpanded = expandedAppCardIds.has("mcp");

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
      .then(async (connection) => {
        if (disposed) {
          return;
        }

        setGithubConnection(connection);

        if (connection.connected) {
          try {
            const repositories = await listGithubRepositories({ perPage: 6, sort: "updated" });

            if (!disposed) {
              setGithubRepos(repositories);
              setGithubStatus({ kind: "success", text: formatConnectedGithubStatus(connection, repositories) });
            }
          } catch (error) {
            if (!disposed) {
              setGithubRepos([]);
              setGithubStatus({ kind: "warning", text: `GitHub connected as ${connection.user?.login ?? "your account"}, but repository preview could not load: ${error instanceof Error ? error.message : "unknown GitHub error"}` });
            }
          }
          return;
        }

        setGithubRepos([]);
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
      setGmailStatus({ kind: "error", text: "Gmail plugin is installed locally, but this build cannot open Google sign-in yet." });
      return;
    }

    setGmailActionState("connect");
    setGmailStatus({ kind: "warning", text: `Gmail plugin is installed locally. Opening Google sign-in so you can choose the account to connect.${googleTestingHint}` });

    try {
      const connection = await connectGmailOAuth({
        clientId: googleOAuthClientId,
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
      setGmailStatus({ kind: "error", text: "Gmail install is not available in this build yet. Install an updated build to connect Gmail." });
      setGmailConnectOpen(true);
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
      setCalendarStatus({ kind: "error", text: "Google Calendar plugin is installed locally, but this build cannot open Google sign-in yet." });
      return;
    }

    setCalendarActionState("connect");
    setCalendarStatus({ kind: "warning", text: `Google Calendar plugin is installed locally. Opening Google sign-in so you can choose the account to connect.${googleTestingHint}` });

    try {
      const connection = await connectGoogleCalendarOAuth({
        clientId: googleOAuthClientId,
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
      setCalendarStatus({ kind: "error", text: "Google Calendar install is not available in this build yet. Install an updated build to connect Calendar." });
      setCalendarConnectOpen(true);
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
    setMcpDialogOpen(true);
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

    try {
      const saved = await saveMcpServer(request.value);

      setMcpConnection(saved.state);
      setMcpDraft((draft) => ({ ...draft, authorizationToken: "", id: saved.server.id }));
      setMcpActionState("test");

      const tested = await testMcpServer({ id: saved.server.id });

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

    try {
      const request = createMcpTestRequest(mcpDraft);

      if (!request.ok) {
        setMcpStatus({ kind: "error", text: request.error });
        return;
      }

      const response = await testMcpServer(mcpDraft.id
        ? { id: mcpDraft.id }
        : request.value);

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
            <p>Install trusted capability cards as they become available. Gmail, Google Calendar, GitHub, and MCP server connections are live, with Skills staged as the next surface.</p>
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
              <strong>4</strong>
              Ready
            </span>
            <span>
              <strong>1</strong>
              Soon
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
                <small>{getAppsSectionMeta(section.id, { mcpEnabledCount })}</small>
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
                <button className="apps-plugin-primary" type="button" disabled={gmailBusy} onClick={handleGmailPrimaryAction}>
                  {gmailActionState === "connect" ? "Opening Google" : gmailActionState === "install" ? "Installing" : gmailConnected ? "Manage" : gmailInstalled ? "Sign in" : "Install"}
                </button>
                <button className="apps-plugin-secondary apps-plugin-details-button" type="button" aria-expanded={gmailExpanded} onClick={() => toggleAppCardExpanded("gmail")}>
                  <ChevronDown size={14} aria-hidden="true" />
                  {gmailExpanded ? "Collapse" : "Expand"}
                </button>
                <span>{gmailConnected ? `${gmailAccountRows.length}/${gmailMaxAccounts} connected. Tools use the active account by default` : gmailInstalled ? "Connect Google before Gmail tools can read mail" : "Installs locally and opens Google account selection"}</span>
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
                <button className="apps-plugin-primary" type="button" disabled={calendarBusy} onClick={handleCalendarPrimaryAction}>
                  {calendarActionState === "connect" ? "Opening Google" : calendarActionState === "install" ? "Installing" : calendarConnected ? "Manage" : calendarInstalled ? "Sign in" : "Install"}
                </button>
                <button className="apps-plugin-secondary apps-plugin-details-button" type="button" aria-expanded={calendarExpanded} onClick={() => toggleAppCardExpanded("google-calendar")}>
                  <ChevronDown size={14} aria-hidden="true" />
                  {calendarExpanded ? "Collapse" : "Expand"}
                </button>
                <span>{calendarConnected ? `${calendarAccountRows.length}/${calendarMaxAccounts} connected. Tools use the active account by default` : calendarInstalled ? "Connect Google before Calendar tools can read events" : "Installs locally and opens Google account selection"}</span>
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
                <button className="apps-plugin-primary" type="button" disabled={githubBusy} onClick={() => void installOrOpenGithub()}>
                  {githubActionState === "install" ? "Installing" : githubConnected ? "Manage" : githubInstalled ? "Sign in" : "Install"}
                </button>
                <button className="apps-plugin-secondary apps-plugin-icon-action" type="button" aria-label="Refresh GitHub" title="Refresh GitHub" disabled={githubBusy || !githubAvailable} onClick={() => void refreshGithubConnection()}>
                  <RefreshCw size={14} aria-hidden="true" />
                </button>
                <button className="apps-plugin-secondary apps-plugin-details-button" type="button" aria-expanded={githubExpanded} onClick={() => toggleAppCardExpanded("github")}>
                  <ChevronDown size={14} aria-hidden="true" />
                  {githubExpanded ? "Collapse" : "Expand"}
                </button>
                <span>{githubConnected ? "Tools use the connected GitHub account and the current workspace by default" : githubInstalled ? "Finish sign-in in Settings before GitHub tools can access repositories" : "Installs locally and reuses the existing GitHub settings sign-in"}</span>
              </div>
            </article>
          ) : null}

          {mcpMatchesSearch ? (
            <article className="apps-plugin-card apps-plugin-card-featured apps-plugin-card-mcp" data-expanded={mcpExpanded}>
              <div className="apps-plugin-card-header">
                <WebAppLogo className="apps-plugin-logo-mcp" fallback={<Server size={20} aria-hidden="true" />} src={APP_ICON_URLS.mcp} />
                <div>
                  <div className="apps-plugin-title-row">
                    <h3>MCP Servers</h3>
                    <span className="apps-plugin-status" data-kind={mcpStatusKind}>
                      {mcpConnected ? <CheckCircle2 size={14} aria-hidden="true" /> : <AlertCircle size={14} aria-hidden="true" />}
                      {mcpStatusLabel}
                    </span>
                  </div>
                  <span className="apps-plugin-maker">
                    <BadgeCheck size={14} aria-hidden="true" />
                    Model Context Protocol
                  </span>
                </div>
              </div>

              <p className="apps-plugin-description">Add external tool servers, test them, then let chat use approved tools.</p>

              <div className="apps-plugin-account" data-connected={mcpConfigured}>
                <Server size={15} aria-hidden="true" />
                <span>{mcpAccountLabel}</span>
              </div>

              {mcpStatus && (!mcpConnected || mcpStatus.kind !== "success" || mcpExpanded) ? (
                <div className="apps-plugin-message" data-kind={mcpStatus.kind}>
                  {mcpStatus.text}
                </div>
              ) : null}

              {!mcpConfigured || mcpExpanded ? (
                <div className="apps-mcp-steps" aria-label="MCP setup steps">
                  <span>Add server</span>
                  <span>Test tools</span>
                  <span>Use in chat</span>
                </div>
              ) : null}

              {mcpExpanded ? (
                <div className="apps-plugin-expanded" aria-label="MCP tools">
                  <div className="apps-plugin-expanded-head">
                    <strong>Connected servers</strong>
                    <small>External tools discovered through MCP</small>
                  </div>

                  <div className="apps-plugin-smart-strip" aria-label="MCP smart actions">
                    <span>Streamable HTTP</span>
                    <span>Stdio</span>
                    <span>{mcpMaxServers} servers</span>
                  </div>

                  <div className="apps-plugin-capabilities" aria-label="MCP capabilities">
                    <span>Server inventory</span>
                    <span>Tool discovery</span>
                    <span>Tool calls</span>
                    <span>Bearer auth</span>
                    <span>Secure tokens</span>
                    <span>Approval gates</span>
                  </div>

                  {mcpServers.length > 0 ? (
                    <div className="apps-mcp-server-preview" aria-label="Configured MCP servers">
                      {mcpServers.slice(0, 3).map((server) => (
                        <span key={server.id} data-enabled={server.enabled}>
                          <strong>{server.name}</strong>
                          <small>{server.enabled ? "Enabled" : "Disabled"} | {server.tools?.length ?? 0} tools</small>
                        </span>
                      ))}
                    </div>
                  ) : null}

                  <div className="apps-plugin-safety">
                    <ShieldCheck size={16} aria-hidden="true" />
                    <span>Bearer tokens stay in OS-backed secure storage; tool calls stay permission reviewed.</span>
                  </div>
                </div>
              ) : null}

              <div className="apps-plugin-actions">
                <button className="apps-plugin-primary" type="button" disabled={mcpBusy && mcpActionState !== "refresh"} onClick={() => openMcpServerDialog()}>
                  {mcpConfigured ? "Manage" : "Add server"}
                </button>
                <button className="apps-plugin-secondary apps-plugin-details-button" type="button" aria-expanded={mcpExpanded} onClick={() => toggleAppCardExpanded("mcp")}>
                  <ChevronDown size={14} aria-hidden="true" />
                  {mcpExpanded ? "Collapse" : "Expand"}
                </button>
                <span>{mcpConfigured ? `${mcpToolCount} cached tools across ${mcpServers.length} configured server${mcpServers.length === 1 ? "" : "s"}` : "Connect HTTPS, localhost, or command-line stdio servers"}</span>
              </div>
            </article>
          ) : null}

          {visibleUpcomingCards.map((card) => {
            const Icon = card.id === "skills" ? Sparkles : Globe2;

            return (
              <article key={card.id} className="apps-plugin-card apps-plugin-card-soon">
                <div className="apps-plugin-card-header">
                  <WebAppLogo className="apps-plugin-logo-soon" fallback={<Icon size={20} aria-hidden="true" />} src={APP_ICON_URLS.skills} />
                  <div>
                    <div className="apps-plugin-title-row">
                      <h3>{card.title}</h3>
                      <span className="apps-plugin-status" data-kind="soon">
                        Coming soon
                      </span>
                    </div>
                    <p className="apps-plugin-description">{card.description}</p>
                  </div>
                </div>

                <div className="apps-plugin-soon-meta">
                  <span>{card.eyebrow}</span>
                  {card.tags.slice(0, 2).map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>
              </article>
            );
          })}

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

      <DialogShell
        description={`Connect up to ${gmailMaxAccounts} Google accounts. Gilbert uses the active Gmail by default unless a tool call names another account.`}
        icon={Mail}
        open={gmailConnectOpen}
        title={gmailConnected ? "Manage Gmail accounts" : gmailInstalled ? "Connect Gmail" : "Install Gmail"}
        onClose={() => setGmailConnectOpen(false)}
        actions={
          <>
            <button className="dialog-button" type="button" onClick={() => setGmailConnectOpen(false)}>
              Close
            </button>
            <button className="dialog-button dialog-button-primary" type="button" disabled={gmailBusy || !gmailAvailable || !googleClientReady || !gmailCanAddAccount} onClick={() => void startGmailConnection()}>
              {gmailConnected ? <Plus size={15} aria-hidden="true" /> : <LogIn size={15} aria-hidden="true" />}
              {gmailActionState === "connect" ? "Waiting for Google" : gmailActionState === "install" ? "Installing" : gmailConnected ? "Add account" : gmailInstalled ? "Connect Google" : "Install with Google"}
            </button>
          </>
        }
      >
        <div className="gmail-connect-dialog">
          <section className="gmail-account-manager" aria-label="Connected Gmail accounts">
            <div className="gmail-account-manager-heading">
              <span>
                <strong>Accounts</strong>
                <small>{gmailAccountRows.length}/{gmailMaxAccounts} connected</small>
              </span>
              <button className="gmail-account-add-button" type="button" disabled={gmailBusy || !gmailCanAddAccount || !gmailAvailable || !googleClientReady} onClick={() => void startGmailConnection()}>
                <Plus size={15} aria-hidden="true" />
                Add account
              </button>
            </div>

            {gmailAccountRows.length > 0 ? (
              <div className="gmail-account-list">
                {gmailAccountRows.map((account) => (
                  <div key={account.email} className="gmail-account-row" data-active={account.active}>
                    <span className="gmail-account-avatar">
                      {account.user.picture ? <img src={account.user.picture} alt="" referrerPolicy="no-referrer" /> : <Mail size={16} aria-hidden="true" />}
                    </span>
                    <span className="gmail-account-details">
                      <strong>{account.email}</strong>
                      <small>{account.active ? "Active account for Gmail tools" : "Connected and ready"}</small>
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
                  <small>Add an account to activate Gmail tools.</small>
                </span>
              </div>
            )}
          </section>

          {gmailStatus ? (
            <div className="gmail-connect-status" data-kind={gmailStatus.kind}>
              {gmailStatus.text}
            </div>
          ) : null}

          <div className="gmail-connect-quick-notes" aria-label="Gmail account behavior">
            <span>
              <UserCheck size={15} aria-hidden="true" />
              Active account is used by default.
            </span>
            <span>
              <ShieldCheck size={15} aria-hidden="true" />
              Full Gmail API scopes unlock read, write, send, settings, and cleanup tools.
            </span>
          </div>

          <div className="gmail-connect-permissions">
            <div className="gmail-connect-permissions-heading">
              <ShieldCheck size={16} aria-hidden="true" />
              <span>Requested access</span>
            </div>
            <div className="gmail-connect-scope-list">
              {GMAIL_CORE_OAUTH_SCOPES.map((scope) => (
                <code key={scope}>{scope}</code>
              ))}
            </div>
            <p>Full Gmail access is needed for mailbox reads, labels, drafts, direct sends, filters, settings, history, archive/trash actions, and generic Gmail API operations.</p>
          </div>

          <div className="gmail-connect-setup" data-ready={googleClientReady && gmailAvailable}>
            <ShieldCheck size={16} aria-hidden="true" />
            <span>
              {googleClientReady ? "This build can connect installed Gmail plugins with Google account selection." : "This build can install Gmail locally, but Google sign-in is not enabled yet."}
            </span>
          </div>
        </div>
      </DialogShell>

      <DialogShell
        description={`Connect up to ${calendarMaxAccounts} Google accounts. Gilbert uses the active Google Calendar by default unless a tool call names another account.`}
        icon={CalendarDays}
        open={calendarConnectOpen}
        title={calendarConnected ? "Manage Google Calendar accounts" : calendarInstalled ? "Connect Google Calendar" : "Install Google Calendar"}
        onClose={() => setCalendarConnectOpen(false)}
        actions={
          <>
            <button className="dialog-button" type="button" onClick={() => setCalendarConnectOpen(false)}>
              Close
            </button>
            <button className="dialog-button dialog-button-primary" type="button" disabled={calendarBusy || !calendarAvailable || !googleClientReady || !calendarCanAddAccount} onClick={() => void startCalendarConnection()}>
              {calendarConnected ? <Plus size={15} aria-hidden="true" /> : <LogIn size={15} aria-hidden="true" />}
              {calendarActionState === "connect" ? "Waiting for Google" : calendarActionState === "install" ? "Installing" : calendarConnected ? "Add account" : calendarInstalled ? "Connect Google" : "Install with Google"}
            </button>
          </>
        }
      >
        <div className="gmail-connect-dialog">
          <section className="gmail-account-manager" aria-label="Connected Google Calendar accounts">
            <div className="gmail-account-manager-heading">
              <span>
                <strong>Accounts</strong>
                <small>{calendarAccountRows.length}/{calendarMaxAccounts} connected</small>
              </span>
              <button className="gmail-account-add-button" type="button" disabled={calendarBusy || !calendarCanAddAccount || !calendarAvailable || !googleClientReady} onClick={() => void startCalendarConnection()}>
                <Plus size={15} aria-hidden="true" />
                Add account
              </button>
            </div>

            {calendarAccountRows.length > 0 ? (
              <div className="gmail-account-list">
                {calendarAccountRows.map((account) => (
                  <div key={account.email} className="gmail-account-row" data-active={account.active}>
                    <span className="gmail-account-avatar">
                      {account.user.picture ? <img src={account.user.picture} alt="" referrerPolicy="no-referrer" /> : <CalendarDays size={16} aria-hidden="true" />}
                    </span>
                    <span className="gmail-account-details">
                      <strong>{account.email}</strong>
                      <small>{account.active ? "Active account for Google Calendar tools" : "Connected and ready"}</small>
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
                  <small>Add an account to activate Calendar tools.</small>
                </span>
              </div>
            )}
          </section>

          {calendarStatus ? (
            <div className="gmail-connect-status" data-kind={calendarStatus.kind}>
              {calendarStatus.text}
            </div>
          ) : null}

          <div className="gmail-connect-quick-notes" aria-label="Google Calendar account behavior">
            <span>
              <UserCheck size={15} aria-hidden="true" />
              Active account is used by default.
            </span>
            <span>
              <ShieldCheck size={15} aria-hidden="true" />
              Event changes require review before execution.
            </span>
          </div>

          <div className="gmail-connect-permissions">
            <div className="gmail-connect-permissions-heading">
              <ShieldCheck size={16} aria-hidden="true" />
              <span>Requested access</span>
            </div>
            <div className="gmail-connect-scope-list">
              {GOOGLE_CALENDAR_CORE_OAUTH_SCOPES.map((scope) => (
                <code key={scope}>{scope}</code>
              ))}
            </div>
            <p>Calendar access is used for agenda reads, free-busy checks, and user-approved event create, update, or delete actions.</p>
          </div>

          <div className="gmail-connect-setup" data-ready={googleClientReady && calendarAvailable}>
            <ShieldCheck size={16} aria-hidden="true" />
            <span>
              {googleClientReady ? "This build can connect installed Google Calendar plugins with Google account selection." : "This build can install Google Calendar locally, but Google sign-in is not enabled yet."}
            </span>
          </div>
        </div>
      </DialogShell>

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
    </section>
  );
}

function WebAppLogo({ className, fallback, src }: { className: string; fallback: ReactNode; src: string }) {
  const [failed, setFailed] = useState(false);

  return (
    <span className={`apps-plugin-logo ${className}`}>
      {failed ? fallback : <img src={src} alt="" aria-hidden="true" draggable={false} referrerPolicy="no-referrer" onError={() => setFailed(true)} />}
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
    return "Gmail plugin is installed locally, but this build is missing the backend Google OAuth client secret. Add GOOGLE_OAUTH_CLIENT_SECRET to the ignored local .env file or release secrets, restart Gilbert Codex, then try Connect Google again.";
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
    return "Google Calendar plugin is installed locally, but this build is missing the backend Google OAuth client secret. Add GOOGLE_OAUTH_CLIENT_SECRET to the ignored local .env file or release secrets, restart Gilbert Codex, then try Connect Google again.";
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

function getAppsSectionMeta(section: AppsCatalogSection, metrics: { mcpEnabledCount: number }) {
  if (section === "plugins") {
    return "3";
  }

  if (section === "skills") {
    return "Soon";
  }

  if (section === "mcp") {
    return metrics.mcpEnabledCount > 0 ? String(metrics.mcpEnabledCount) : "Ready";
  }

  return "5";
}
