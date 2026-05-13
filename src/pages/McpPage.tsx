import { useMemo, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Copy,
  ExternalLink,
  Globe2,
  KeyRound,
  Plus,
  PlugZap,
  Server,
  ShieldCheck,
  TerminalSquare,
  Trash2,
} from "lucide-react";
import { UtilityPageShell } from "../components/utility/UtilityPageShell";
import { createDefaultMcpServer, normalizeMcpServerLabel, normalizeMcpSettings, parseMcpList } from "../types/mcp";
import type { McpServerConfig, McpServerTransport, McpSettings } from "../types/mcp";
import type { ModelProviderId } from "../types/settings";

interface McpPageProps {
  mcp: McpSettings;
  mcpToolboxEnabled: boolean;
  onMcpChange: (settings: McpSettings) => void;
  provider: ModelProviderId;
  thinkingEnabled: boolean;
}

const mcpConcepts = [
  {
    icon: Server,
    label: "Host",
    value: "Gilbert Codex is the host that decides which servers are available, when they are sent to a provider, and what approval policy applies.",
  },
  {
    icon: PlugZap,
    label: "Client",
    value: "A client maintains one isolated session per MCP server, negotiates capabilities, and moves JSON-RPC messages both ways.",
  },
  {
    icon: Globe2,
    label: "Server",
    value: "A server exposes focused tools, resources, and prompts for a service such as files, docs, GitHub, Stripe, Figma, or an internal API.",
  },
  {
    icon: ShieldCheck,
    label: "Approval",
    value: "Tool calls can read or mutate outside systems, so sensitive servers should keep human review on unless the user fully trusts them.",
  },
];

const setupSteps = [
  "Pick remote when the server has an HTTPS MCP endpoint. Pick local stdio when the server runs as a command on this computer.",
  "Use a short server label because the model and provider use that label when listing or calling tools.",
  "Keep approval required for broad or mutating tools, then optionally limit allowed tool names once the server is understood.",
  "Test remote servers with direct OpenAI Responses mode. For local stdio servers, copy the config into an MCP-compatible desktop client until Gilbert's local MCP adapter is connected.",
];

const docsLinks = [
  { href: "https://modelcontextprotocol.io/docs/getting-started/intro", label: "MCP introduction" },
  { href: "https://modelcontextprotocol.io/specification/2025-06-18/architecture", label: "Architecture" },
  { href: "https://modelcontextprotocol.io/specification/2025-06-18/basic/transports", label: "Transports" },
  { href: "https://modelcontextprotocol.io/specification/2025-06-18/server/tools", label: "Tools" },
  { href: "https://developers.openai.com/api/docs/guides/tools-connectors-mcp", label: "OpenAI MCP" },
];

const remoteStarterServers = [
  {
    description: "Repository documentation and wiki context through DeepWiki's remote MCP endpoint.",
    label: "deepwiki",
    serverUrl: "https://mcp.deepwiki.com/mcp",
  },
  {
    description: "Official GitHub Copilot MCP endpoint for GitHub-hosted repository tooling.",
    label: "github",
    serverUrl: "https://api.githubcopilot.com/mcp/",
  },
];

export function McpPage({ mcp, mcpToolboxEnabled, onMcpChange, provider, thinkingEnabled }: McpPageProps) {
  const normalized = normalizeMcpSettings(mcp);
  const [copyStatus, setCopyStatus] = useState("");
  const enabledServers = normalized.servers.filter((server) => server.enabled);
  const remoteReady = enabledServers.filter((server) => server.transport === "remote" && isHttpUrl(server.serverUrl)).length;
  const localProfiles = normalized.servers.filter((server) => server.transport === "stdio").length;
  const openAiConfigured = provider === "openai" && normalized.enabled && mcpToolboxEnabled && remoteReady > 0;
  const openAiReady = openAiConfigured && thinkingEnabled;
  const stats = [
    { count: String(enabledServers.length).padStart(2, "0"), icon: PlugZap, label: "Enabled", status: normalized.enabled ? "MCP on" : "Paused" },
    { count: String(remoteReady).padStart(2, "0"), icon: Globe2, label: "Remote ready", status: openAiReady ? "Provider path active" : openAiConfigured ? "Needs thinking" : "Needs OpenAI" },
    { count: String(localProfiles).padStart(2, "0"), icon: TerminalSquare, label: "Local profiles", status: "Config export" },
    { count: mcpToolboxEnabled ? "ON" : "OFF", icon: ShieldCheck, label: "Toolbox gate", status: mcpToolboxEnabled ? "Allowed" : "Disabled" },
  ];
  const claudeConfig = useMemo(() => createClaudeDesktopConfig(normalized), [normalized]);
  const openAiSnippet = useMemo(() => createOpenAiToolSnippet(normalized), [normalized]);

  function updateMcp(nextSettings: McpSettings) {
    onMcpChange(normalizeMcpSettings(nextSettings));
  }

  function patchMcp(patch: Partial<McpSettings>) {
    updateMcp({
      ...normalized,
      ...patch,
    });
  }

  function addServer(transport: McpServerTransport) {
    updateMcp({
      ...normalized,
      servers: [...normalized.servers, createDefaultMcpServer(transport)],
    });
  }

  function addStarterServer(starter: (typeof remoteStarterServers)[number]) {
    const server = {
      ...createDefaultMcpServer("remote"),
      description: starter.description,
      label: starter.label,
      serverUrl: starter.serverUrl,
    };

    updateMcp({
      ...normalized,
      servers: [...normalized.servers, server],
    });
  }

  function patchServer(serverId: string, patch: Partial<McpServerConfig>) {
    updateMcp({
      ...normalized,
      servers: normalized.servers.map((server) =>
        server.id === serverId
          ? {
              ...server,
              ...patch,
              label: patch.label === undefined ? server.label : normalizeMcpServerLabel(patch.label),
              updatedAt: new Date().toISOString(),
            }
          : server,
      ),
    });
  }

  function deleteServer(serverId: string) {
    updateMcp({
      ...normalized,
      servers: normalized.servers.filter((server) => server.id !== serverId),
    });
  }

  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus(label);
      window.setTimeout(() => setCopyStatus(""), 2200);
    } catch {
      setCopyStatus("Copy failed");
    }
  }

  return (
    <UtilityPageShell
      actions={
        <>
          <button type="button" onClick={() => patchMcp({ enabled: !normalized.enabled })}>
            {normalized.enabled ? "Pause MCP" : "Enable MCP"}
          </button>
          <button type="button" onClick={() => addServer("remote")}>
            <Plus size={14} aria-hidden="true" />
            Remote
          </button>
          <button type="button" onClick={() => addServer("stdio")}>
            <Plus size={14} aria-hidden="true" />
            Local
          </button>
        </>
      }
      actionsLabel="MCP actions"
      className="mcp-page"
      eyebrow="MCP"
      stats={stats}
      statsLabel="MCP overview"
      title="Model Context Protocol"
      titleId="mcp-title"
    >
        <section className="mcp-runtime-banner" data-ready={openAiReady} aria-label="MCP runtime status">
          <div className="tool-card-icon" aria-hidden="true">
            {openAiReady ? <CheckCircle2 size={20} /> : <AlertTriangle size={20} />}
          </div>
          <div>
            <strong>
              {openAiReady
                ? "Remote MCP is available to the AI"
                : openAiConfigured
                  ? "Remote MCP needs thinking mode to fire"
                  : "Remote MCP is configured as setup guidance"}
            </strong>
            <p>
              {openAiReady
                ? "Enabled remote servers are sent in OpenAI Responses requests with their configured approval policy."
                : openAiConfigured
                  ? "Remote MCP passthrough rides the OpenAI Responses API, which only activates when thinking mode is on. Enable thinking in the composer to let the model call these servers; otherwise the configuration is kept as setup guidance."
                  : provider === "openai"
                    ? "Add at least one enabled remote HTTPS server, keep MCP plus the Toolbox MCP gate enabled, and turn on thinking mode."
                    : "OpenAI Responses supports remote MCP passthrough now. Other providers still get the setup context, but they cannot directly call MCP servers from this build."}
            </p>
          </div>
        </section>

        <section className="utility-section" aria-labelledby="mcp-server-title">
          <div className="utility-section-heading">
            <h2 id="mcp-server-title">Servers</h2>
            <span>{normalized.servers.length} configured</span>
          </div>
          {normalized.servers.length === 0 ? (
            <div className="mcp-empty-state">
              <PlugZap size={19} aria-hidden="true" />
              <div>
                <strong>No MCP servers yet</strong>
                <p>Add a remote MCP URL for model access through OpenAI Responses, or save a local stdio profile for desktop-client setup.</p>
              </div>
            </div>
          ) : (
            <div className="mcp-server-grid">
              {normalized.servers.map((server) => (
                <McpServerCard key={server.id} server={server} onDelete={() => deleteServer(server.id)} onPatch={(patch) => patchServer(server.id, patch)} />
              ))}
            </div>
          )}
        </section>

        <section className="utility-section" aria-labelledby="mcp-starter-title">
          <div className="utility-section-heading">
            <h2 id="mcp-starter-title">Quick Add</h2>
            <span>Remote examples</span>
          </div>
          <div className="mcp-starter-grid">
            {remoteStarterServers.map((server) => (
              <article className="mcp-starter-card" key={server.serverUrl}>
                <div className="tool-card-header">
                  <span className="tool-card-icon" aria-hidden="true">
                    <Globe2 size={20} />
                  </span>
                  <button type="button" onClick={() => addStarterServer(server)}>
                    <Plus size={14} aria-hidden="true" />
                    Add
                  </button>
                </div>
                <h3>{server.label}</h3>
                <p>{server.description}</p>
                <code>{server.serverUrl}</code>
              </article>
            ))}
          </div>
        </section>

        <section className="utility-section" aria-labelledby="mcp-learn-title">
          <div className="utility-section-heading">
            <h2 id="mcp-learn-title">How It Works</h2>
            <span>From official docs</span>
          </div>
          <div className="mcp-concept-grid">
            {mcpConcepts.map((item) => {
              const Icon = item.icon;

              return (
                <article className="mcp-concept-card" key={item.label}>
                  <span className="tool-card-icon" aria-hidden="true">
                    <Icon size={20} />
                  </span>
                  <h3>{item.label}</h3>
                  <p>{item.value}</p>
                </article>
              );
            })}
          </div>
        </section>

        <section className="utility-section mcp-setup-section" aria-labelledby="mcp-setup-title">
          <div className="utility-section-heading">
            <h2 id="mcp-setup-title">Setup</h2>
            <span>User handoff</span>
          </div>
          <div className="mcp-setup-grid">
            <article className="mcp-setup-card">
              <div className="tool-card-header">
                <span className="tool-card-icon" aria-hidden="true">
                  <BookOpen size={20} />
                </span>
                <button type="button" onClick={() => copyText(setupSteps.join("\n"), "Setup steps copied")}>
                  <Copy size={14} aria-hidden="true" />
                  Copy
                </button>
              </div>
              <h3>Setup checklist</h3>
              <ol>
                {setupSteps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </article>

            <article className="mcp-setup-card">
              <div className="tool-card-header">
                <span className="tool-card-icon" aria-hidden="true">
                  <TerminalSquare size={20} />
                </span>
                <button type="button" onClick={() => copyText(claudeConfig, "Local config copied")}>
                  <Copy size={14} aria-hidden="true" />
                  Copy
                </button>
              </div>
              <h3>Local stdio config</h3>
              <pre>{claudeConfig}</pre>
            </article>

            <article className="mcp-setup-card">
              <div className="tool-card-header">
                <span className="tool-card-icon" aria-hidden="true">
                  <KeyRound size={20} />
                </span>
                <button type="button" onClick={() => copyText(openAiSnippet, "OpenAI snippet copied")}>
                  <Copy size={14} aria-hidden="true" />
                  Copy
                </button>
              </div>
              <h3>OpenAI Responses tools</h3>
              <pre>{openAiSnippet}</pre>
            </article>
          </div>
          {copyStatus ? <div className="mcp-copy-status">{copyStatus}</div> : null}
        </section>

        <section className="utility-section" aria-labelledby="mcp-docs-title">
          <div className="utility-section-heading">
            <h2 id="mcp-docs-title">Docs</h2>
            <span>Primary sources</span>
          </div>
          <div className="mcp-doc-link-grid">
            {docsLinks.map((link) => (
              <a href={link.href} key={link.href} rel="noreferrer" target="_blank">
                <ExternalLink size={15} aria-hidden="true" />
                <span>{link.label}</span>
              </a>
            ))}
          </div>
        </section>
    </UtilityPageShell>
  );
}

function McpServerCard({
  onDelete,
  onPatch,
  server,
}: {
  onDelete: () => void;
  onPatch: (patch: Partial<McpServerConfig>) => void;
  server: McpServerConfig;
}) {
  const remote = server.transport === "remote";

  return (
    <article className="mcp-server-card" data-enabled={server.enabled} data-transport={server.transport}>
      <div className="tool-card-header">
        <span className="tool-card-icon" aria-hidden="true">
          {remote ? <Globe2 size={20} /> : <TerminalSquare size={20} />}
        </span>
        <div className="mcp-card-actions">
          <button
            className="tool-toggle"
            type="button"
            role="switch"
            aria-checked={server.enabled}
            aria-label={`${server.enabled ? "Disable" : "Enable"} ${server.label}`}
            data-on={server.enabled}
            onClick={() => onPatch({ enabled: !server.enabled })}
          >
            <span />
          </button>
          <button className="mcp-icon-button" type="button" aria-label={`Delete ${server.label}`} title="Delete server" onClick={onDelete}>
            <Trash2 size={15} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="mcp-field-grid">
        <label className="mcp-field">
          <span>Label</span>
          <input value={server.label} onChange={(event) => onPatch({ label: event.target.value })} />
        </label>
        <label className="mcp-field">
          <span>Transport</span>
          <select value={server.transport} onChange={(event) => onPatch({ transport: event.target.value as McpServerTransport })}>
            <option value="remote">Remote HTTP</option>
            <option value="stdio">Local stdio</option>
          </select>
        </label>
      </div>

      <label className="mcp-field">
        <span>Description</span>
        <input value={server.description} onChange={(event) => onPatch({ description: event.target.value })} />
      </label>

      {remote ? (
        <>
          <label className="mcp-field">
            <span>Server URL</span>
            <input placeholder="https://example.com/mcp" value={server.serverUrl} onChange={(event) => onPatch({ serverUrl: event.target.value })} />
          </label>
          <div className="mcp-field-grid">
            <label className="mcp-field">
              <span>Approval</span>
              <select value={server.requireApproval} onChange={(event) => onPatch({ requireApproval: event.target.value as McpServerConfig["requireApproval"] })}>
                <option value="always">Always ask</option>
                <option value="never">Never ask</option>
              </select>
            </label>
            <label className="mcp-field mcp-checkbox-field">
              <input type="checkbox" checked={server.deferLoading} onChange={(event) => onPatch({ deferLoading: event.target.checked })} />
              <span>Defer tool loading</span>
            </label>
          </div>
          <label className="mcp-field">
            <span>Authorization token</span>
            <input type="password" placeholder="OAuth or bearer token" value={server.authorization} onChange={(event) => onPatch({ authorization: event.target.value })} />
          </label>
          <label className="mcp-field">
            <span>Allowed tools</span>
            <textarea rows={3} placeholder="Optional, comma or line separated" value={server.allowedTools} onChange={(event) => onPatch({ allowedTools: event.target.value })} />
          </label>
        </>
      ) : (
        <>
          <label className="mcp-field">
            <span>Command</span>
            <input placeholder="npx" value={server.command} onChange={(event) => onPatch({ command: event.target.value })} />
          </label>
          <label className="mcp-field">
            <span>Arguments</span>
            <textarea rows={3} placeholder="-y @modelcontextprotocol/server-filesystem C:\\Users\\you\\Desktop" value={server.args} onChange={(event) => onPatch({ args: event.target.value })} />
          </label>
          <label className="mcp-field">
            <span>Environment</span>
            <textarea rows={3} placeholder="BRAVE_API_KEY=..." value={server.env} onChange={(event) => onPatch({ env: event.target.value })} />
          </label>
        </>
      )}

      <div className="tool-card-meta">
        <span>{server.enabled ? "Enabled" : "Off"}</span>
        <span>{remote ? (isHttpUrl(server.serverUrl) ? "Remote ready" : "Needs URL") : server.command ? "Profile ready" : "Needs command"}</span>
      </div>
    </article>
  );
}

function createClaudeDesktopConfig(settings: McpSettings) {
  const stdioServers = settings.servers.filter((server) => server.transport === "stdio" && server.command.trim());
  const mcpServers = Object.fromEntries(
    stdioServers.map((server) => [
      normalizeMcpServerLabel(server.label),
      {
        args: splitCommandArgs(server.args),
        command: server.command.trim(),
        ...(parseEnv(server.env) ? { env: parseEnv(server.env) } : {}),
      },
    ]),
  );

  return JSON.stringify({ mcpServers }, null, 2);
}

function createOpenAiToolSnippet(settings: McpSettings) {
  const tools = settings.servers
    .filter((server) => server.enabled && server.transport === "remote" && isHttpUrl(server.serverUrl))
    .map((server) => ({
      ...(parseMcpList(server.allowedTools).length > 0 ? { allowed_tools: parseMcpList(server.allowedTools) } : {}),
      ...(server.authorization.trim() ? { authorization: "[stored locally]" } : {}),
      ...(server.deferLoading ? { defer_loading: true } : {}),
      require_approval: server.requireApproval,
      ...(server.description.trim() ? { server_description: server.description.trim() } : {}),
      server_label: normalizeMcpServerLabel(server.label),
      server_url: server.serverUrl.trim(),
      type: "mcp",
    }));

  return JSON.stringify({ tools }, null, 2);
}

function splitCommandArgs(value: string) {
  const args: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|[^\s]+/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value))) {
    args.push(match[1] ?? match[2] ?? match[0]);
  }

  return args;
}

function parseEnv(value: string) {
  const entries = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf("=");
      return separator > 0 ? [line.slice(0, separator).trim(), line.slice(separator + 1).trim()] : null;
    })
    .filter((entry): entry is string[] => Boolean(entry));

  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
