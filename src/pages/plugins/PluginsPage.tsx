import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  BadgeCheck,
  BookOpen,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  Code2,
  Download,
  ExternalLink,
  FileJson,
  Globe2,
  Hammer,
  Maximize2,
  Minimize2,
  PackagePlus,
  Puzzle,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Store,
  Wand2,
  Workflow,
  X,
} from "lucide-react";
import {
  DEFAULT_INSTALLED_PLUGIN_IDS,
  PLUGIN_CATEGORIES,
  PLUGIN_COMPONENT_LABELS,
  PLUGIN_LISTINGS,
  PLUGIN_MARKETPLACES,
  formatInstallCount,
  type PluginComponentKind,
  type PluginListing,
  type PluginListingStatus,
  type PluginMarketplace,
  type PluginPermissionSensitivity,
} from "../../features/plugins/pluginCatalog";
import "../../styles/plugins.css";

interface PluginsPageProps {
  onBackToChat: () => void;
}

interface PluginDirectoryProps {
  embedded?: boolean;
  onBackToChat?: () => void;
}

type PluginTab = "create" | "discover" | "installed" | "marketplaces";
type PluginSort = "name" | "popular" | "trust";
type InstallScope = "User" | "Project" | "Local";

const tabOptions: Array<{ id: PluginTab; label: string; meta: string }> = [
  { id: "discover", label: "Discover", meta: "Catalog" },
  { id: "installed", label: "Installed", meta: "Enabled" },
  { id: "create", label: "Create", meta: "Build" },
  { id: "marketplaces", label: "Marketplaces", meta: "Sources" },
];

const scopeOptions: InstallScope[] = ["User", "Project", "Local"];

const componentChoices: Array<{ id: PluginComponentKind; label: string }> = [
  { id: "skill", label: "Skills" },
  { id: "mcp", label: "MCP" },
  { id: "agent", label: "Agents" },
  { id: "hook", label: "Hooks" },
  { id: "lsp", label: "LSP" },
  { id: "monitor", label: "Monitors" },
];

const PLUGIN_ICON_DOMAINS: Record<string, string> = {
  "chrome-devtools": "developer.chrome.com",
  "code-review": "github.com",
  "code-simplifier": "github.com",
  coderabbit: "coderabbit.ai",
  "commit-commands": "git-scm.com",
  context7: "upstash.com",
  "feature-dev": "github.com",
  figma: "figma.com",
  "frontend-design": "react.dev",
  github: "github.com",
  "go-lsp": "go.dev",
  "mcp-server-dev": "modelcontextprotocol.io",
  "plugin-developer-toolkit": "modelcontextprotocol.io",
  playwright: "playwright.dev",
  "playwright-browser": "playwright.dev",
  "pr-review-toolkit": "github.com",
  "pyright-lsp": "microsoft.github.io",
  "rust-analyzer-lsp": "rust-lang.org",
  security: "owasp.org",
  "security-guidance": "owasp.org",
  semgrep: "semgrep.dev",
  serena: "github.com",
  "skill-creator": "openai.com",
  slack: "slack.com",
  stripe: "stripe.com",
  superpowers: "github.com",
  supabase: "supabase.com",
  "typescript-lsp": "typescriptlang.org",
  vercel: "vercel.com",
};

export function PluginsPage({ onBackToChat }: PluginsPageProps) {
  return <PluginDirectory onBackToChat={onBackToChat} />;
}

export function PluginDirectory({ embedded = false, onBackToChat }: PluginDirectoryProps) {
  const [activeTab, setActiveTab] = useState<PluginTab>("discover");
  const [category, setCategory] = useState<(typeof PLUGIN_CATEGORIES)[number]>("All");
  const [expandedPluginIds, setExpandedPluginIds] = useState<Set<string>>(() => new Set());
  const [installScope, setInstallScope] = useState<InstallScope>("User");
  const [installedPluginIds, setInstalledPluginIds] = useState<Set<string>>(() => new Set<string>(DEFAULT_INSTALLED_PLUGIN_IDS));
  const [query, setQuery] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [selectedPluginId, setSelectedPluginId] = useState(PLUGIN_LISTINGS[0]?.id ?? "");
  const [sort, setSort] = useState<PluginSort>("popular");
  const [copyStatus, setCopyStatus] = useState("");
  const [draftName, setDraftName] = useState("team-workflow");
  const [draftDescription, setDraftDescription] = useState("Reusable skills, MCP tools, and approval points for this workspace.");
  const [draftComponents, setDraftComponents] = useState<Record<PluginComponentKind, boolean>>({
    agent: false,
    hook: false,
    lsp: false,
    mcp: true,
    monitor: false,
    skill: true,
  });

  const visiblePlugins = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const basePlugins = activeTab === "installed"
      ? PLUGIN_LISTINGS.filter((plugin) => installedPluginIds.has(plugin.id))
      : PLUGIN_LISTINGS;
    const filteredPlugins = basePlugins.filter((plugin) => {
      const matchesCategory = category === "All" || plugin.category === category;
      const searchableText = [
        plugin.name,
        plugin.publisher,
        plugin.description,
        plugin.category,
        plugin.marketplace,
        plugin.source,
        plugin.trust,
        plugin.installCommand,
        ...plugin.tags,
        ...plugin.components.map((component) => PLUGIN_COMPONENT_LABELS[component]),
        ...plugin.skills.flatMap((skill) => [skill.title, skill.mention, ...skill.aliases, ...skill.tags]),
      ].join(" ").toLowerCase();

      return matchesCategory && (!normalizedQuery || searchableText.includes(normalizedQuery));
    });

    return sortPluginListings(filteredPlugins, sort);
  }, [activeTab, category, installedPluginIds, query, sort]);

  useEffect(() => {
    if (activeTab === "create" || activeTab === "marketplaces" || visiblePlugins.length === 0) {
      return;
    }

    if (!visiblePlugins.some((plugin) => plugin.id === selectedPluginId)) {
      setSelectedPluginId(visiblePlugins[0].id);
    }
  }, [activeTab, selectedPluginId, visiblePlugins]);

  const selectedPlugin = PLUGIN_LISTINGS.find((plugin) => plugin.id === selectedPluginId) ?? visiblePlugins[0] ?? null;
  const selectedComponents = componentChoices.filter((component) => draftComponents[component.id]).map((component) => component.id);
  const manifestPreview = useMemo(
    () =>
      JSON.stringify(
        {
          name: createPluginId(draftName),
          description: draftDescription.trim(),
          version: "0.1.0",
          components: selectedComponents,
          permissions: selectedComponents.map((component) => PLUGIN_COMPONENT_LABELS[component]),
          marketplaces: ["workspace-local"],
        },
        null,
        2,
      ),
    [draftDescription, draftName, selectedComponents],
  );

  function toggleInstall(pluginId: string) {
    setInstalledPluginIds((currentIds) => {
      const nextIds = new Set(currentIds);

      if (nextIds.has(pluginId)) {
        nextIds.delete(pluginId);
      } else {
        nextIds.add(pluginId);
      }

      return nextIds;
    });
  }

  function toggleCardExpanded(pluginId: string) {
    setExpandedPluginIds((currentIds) => {
      const nextIds = new Set(currentIds);

      if (nextIds.has(pluginId)) {
        nextIds.delete(pluginId);
      } else {
        nextIds.add(pluginId);
      }

      return nextIds;
    });
    setSelectedPluginId(pluginId);
  }

  function toggleDraftComponent(componentId: PluginComponentKind) {
    setDraftComponents((currentComponents) => ({
      ...currentComponents,
      [componentId]: !currentComponents[componentId],
    }));
  }

  async function copyManifestPreview() {
    try {
      await navigator.clipboard.writeText(manifestPreview);
      setCopyStatus("Copied");
    } catch {
      setCopyStatus("Unavailable");
    }

    window.setTimeout(() => setCopyStatus(""), 1800);
  }

  return (
    <section className={embedded ? "plugin-directory-embed" : "plugin-page"}>
      {!embedded && onBackToChat ? (
        <PluginHero
          activeTab={activeTab}
          installedCount={installedPluginIds.size}
          installScope={installScope}
          onBackToChat={onBackToChat}
          onScopeChange={setInstallScope}
        />
      ) : null}

      <div className="plugin-tabs" role="tablist" aria-label="Plugin sections">
        {tabOptions.map((tab) => (
          <button key={tab.id} type="button" role="tab" aria-selected={activeTab === tab.id} data-active={activeTab === tab.id} onClick={() => setActiveTab(tab.id)}>
            {getTabIcon(tab.id)}
            <span>{tab.label}</span>
            <small>{tab.meta}</small>
          </button>
        ))}
      </div>

      {activeTab === "create" ? (
        <CreatePluginPanel
          copyStatus={copyStatus}
          draftComponents={draftComponents}
          draftDescription={draftDescription}
          draftName={draftName}
          manifestPreview={manifestPreview}
          onCopyManifest={() => void copyManifestPreview()}
          onDraftDescriptionChange={setDraftDescription}
          onDraftNameChange={setDraftName}
          onToggleComponent={toggleDraftComponent}
          selectedComponents={selectedComponents}
        />
      ) : activeTab === "marketplaces" ? (
        <MarketplacePanel />
      ) : (
        <div className="plugin-catalog-page">
          <div className="plugin-toolbar">
            <label className="plugin-search">
              <Search size={17} aria-hidden="true" />
              <input value={query} placeholder="Search plugins, components, skills, sources" onChange={(event) => setQuery(event.target.value)} />
            </label>
            <PluginSelect label="Install scope" value={installScope} onChange={(value) => setInstallScope(value as InstallScope)}>
              {scopeOptions.map((scope) => (
                <option key={scope}>{scope}</option>
              ))}
            </PluginSelect>
            <PluginSelect label="Sort plugins" value={sort} onChange={(value) => setSort(value as PluginSort)}>
              <option value="popular">Popular</option>
              <option value="trust">Trust</option>
              <option value="name">Name</option>
            </PluginSelect>
          </div>

          <div className="plugin-category-row" aria-label="Plugin categories">
            {PLUGIN_CATEGORIES.map((nextCategory) => (
              <button key={nextCategory} type="button" data-active={category === nextCategory} onClick={() => setCategory(nextCategory)}>
                {nextCategory}
              </button>
            ))}
          </div>

          <PermissionReviewWindow
            installScope={installScope}
            installed={Boolean(selectedPlugin && installedPluginIds.has(selectedPlugin.id))}
            open={reviewOpen}
            plugin={selectedPlugin}
            onInstallToggle={toggleInstall}
            onOpenChange={setReviewOpen}
            onScopeChange={setInstallScope}
          />

          <PluginCardGrid
            activeTab={activeTab}
            expandedPluginIds={expandedPluginIds}
            installScope={installScope}
            installedPluginIds={installedPluginIds}
            plugins={visiblePlugins}
            selectedPluginId={selectedPlugin?.id ?? ""}
            onExpandToggle={toggleCardExpanded}
            onInstallToggle={toggleInstall}
            onOpenCreate={() => setActiveTab("create")}
            onReview={(pluginId) => {
              setSelectedPluginId(pluginId);
              setReviewOpen(true);
            }}
          />
        </div>
      )}
    </section>
  );
}

function PluginHero({
  activeTab,
  installedCount,
  installScope,
  onBackToChat,
  onScopeChange,
}: {
  activeTab: PluginTab;
  installedCount: number;
  installScope: InstallScope;
  onBackToChat: () => void;
  onScopeChange: (scope: InstallScope) => void;
}) {
  const copy =
    activeTab === "create"
      ? { detail: "Create reusable skills, MCP servers, agents, hooks, LSP config, and monitors.", title: "Create plugin" }
      : activeTab === "installed"
        ? { detail: "Manage enabled capability bundles and their local install scope.", title: "Installed plugins" }
        : activeTab === "marketplaces"
          ? { detail: "Connect official, team, Git, URL, or workspace-local plugin catalogs.", title: "Marketplaces" }
          : { detail: "Real catalog plugins with readable cards, source details, and reviewable permissions.", title: "Discover plugins" };

  return (
    <header className="plugin-hero">
      <div className="plugin-hero-title">
        <div className="plugin-hero-icon">
          <Puzzle size={24} aria-hidden="true" />
        </div>
        <span>
          <strong>{copy.title}</strong>
          <small>{copy.detail}</small>
        </span>
      </div>

      <div className="plugin-hero-actions">
        <div className="plugin-metric">
          <strong>{installedCount}</strong>
          <span>Installed</span>
        </div>
        <div className="plugin-metric">
          <strong>{PLUGIN_LISTINGS.length}</strong>
          <span>Catalog</span>
        </div>
        <div className="plugin-metric">
          <strong>{PLUGIN_MARKETPLACES.length}</strong>
          <span>Marketplaces</span>
        </div>
        <PluginSelect label="Default install scope" value={installScope} onChange={(value) => onScopeChange(value as InstallScope)}>
          {scopeOptions.map((scope) => (
            <option key={scope}>{scope}</option>
          ))}
        </PluginSelect>
        <button className="plugin-icon-button" type="button" aria-label="Close plugins" title="Close plugins" onClick={onBackToChat}>
          <X size={17} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}

function PluginSelect({ children, label, onChange, value }: { children: ReactNode; label: string; onChange: (value: string) => void; value: string }) {
  return (
    <label className="plugin-select">
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
      <ChevronDown size={15} aria-hidden="true" />
    </label>
  );
}

function PluginCardGrid({
  activeTab,
  expandedPluginIds,
  installScope,
  installedPluginIds,
  onExpandToggle,
  onInstallToggle,
  onOpenCreate,
  onReview,
  plugins,
  selectedPluginId,
}: {
  activeTab: PluginTab;
  expandedPluginIds: Set<string>;
  installScope: InstallScope;
  installedPluginIds: Set<string>;
  onExpandToggle: (pluginId: string) => void;
  onInstallToggle: (pluginId: string) => void;
  onOpenCreate: () => void;
  onReview: (pluginId: string) => void;
  plugins: PluginListing[];
  selectedPluginId: string;
}) {
  if (plugins.length === 0) {
    return (
      <div className="plugin-empty-state">
        <Puzzle size={20} aria-hidden="true" />
        <span>
          <strong>{activeTab === "installed" ? "No installed plugins match" : "No catalog plugins match"}</strong>
          <small>{activeTab === "installed" ? "Switch to Discover or create a workspace plugin." : "Try a broader category or search term."}</small>
        </span>
        {activeTab === "installed" ? (
          <button type="button" onClick={onOpenCreate}>
            <PackagePlus size={15} aria-hidden="true" />
            <span>Create</span>
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="plugin-card-grid">
      {plugins.map((plugin) => {
        const expanded = expandedPluginIds.has(plugin.id);
        const installed = installedPluginIds.has(plugin.id);
        const status: PluginListingStatus = installed ? "installed" : plugin.status;

        return (
          <article key={plugin.id} className="plugin-card" data-expanded={expanded} data-selected={selectedPluginId === plugin.id} data-status={status}>
            <div className="plugin-card-top">
              <PluginLogo plugin={plugin} />
              <div className="plugin-card-title">
                <span>
                  <strong>{plugin.name}</strong>
                  <small>{plugin.publisher} · {plugin.marketplace}</small>
                </span>
                <StatusBadge status={status} />
              </div>
            </div>

            <p>{plugin.description}</p>

            <ComponentBadges components={plugin.components} limit={expanded ? undefined : 2} />

            <div className="plugin-card-meta" aria-label={`${plugin.name} summary`}>
              <span>{plugin.trust}</span>
              <span>{formatInstallCount(plugin.installCount)} installs</span>
              <span>{PLUGIN_COMPONENT_LABELS[plugin.components[0]] ?? "Plugin"}</span>
            </div>

            {expanded ? (
              <>
                <div className="plugin-skill-row" aria-label={`${plugin.name} skills`}>
                  {plugin.skills.length > 0 ? plugin.skills.slice(0, 8).map((skill) => <code key={skill.id}>{skill.mention}</code>) : <code>No skill trigger</code>}
                </div>

                <dl className="plugin-card-details">
                  <div>
                    <dt>Source</dt>
                    <dd title={plugin.source}>{plugin.source}</dd>
                  </div>
                  <div>
                    <dt>Trust</dt>
                    <dd>{plugin.trust}</dd>
                  </div>
                  <div>
                    <dt>Version</dt>
                    <dd>{plugin.version}</dd>
                  </div>
                  <div>
                    <dt>Installs</dt>
                    <dd>{formatInstallCount(plugin.installCount)}</dd>
                  </div>
                </dl>

                <ExpandedPluginDetails plugin={plugin} />
              </>
            ) : null}

            <div className="plugin-card-actions">
              <a href={plugin.homepage} aria-label={`Open ${plugin.name} source`} title="Open source">
                <ExternalLink size={15} aria-hidden="true" />
                <span>Source</span>
              </a>
              <button type="button" onClick={() => onReview(plugin.id)}>
                <ShieldCheck size={15} aria-hidden="true" />
                <span>Review</span>
              </button>
              <button className="plugin-card-expand-button" type="button" aria-expanded={expanded} onClick={() => onExpandToggle(plugin.id)}>
                <ChevronDown size={15} aria-hidden="true" />
                <span>{expanded ? "Collapse" : "Expand"}</span>
              </button>
              <button type="button" data-installed={installed} onClick={() => onInstallToggle(plugin.id)}>
                {installed ? <Check size={15} aria-hidden="true" /> : <Download size={15} aria-hidden="true" />}
                <span>{installed ? `${installScope} enabled` : "Install"}</span>
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function PluginLogo({ plugin }: { plugin: PluginListing }) {
  const [failed, setFailed] = useState(false);
  const FallbackIcon = getPluginFallbackIcon(plugin);

  return (
    <div className="plugin-card-icon">
      {failed ? (
        <FallbackIcon size={21} aria-hidden="true" />
      ) : (
        <img src={getPluginIconUrl(plugin)} alt="" aria-hidden="true" decoding="async" draggable={false} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      )}
    </div>
  );
}

function ExpandedPluginDetails({ plugin }: { plugin: PluginListing }) {
  return (
    <div className="plugin-card-expanded">
      <div>
        <strong>Permissions</strong>
        <div className="plugin-mini-permission-list">
          {plugin.permissions.map((permission) => (
            <span key={`${plugin.id}-${permission.id}`} data-sensitivity={permission.sensitivity}>
              {getComponentIcon(permission.component)}
              {permission.label}
            </span>
          ))}
        </div>
      </div>
      <code>{plugin.installCommand}</code>
    </div>
  );
}

function PermissionReviewWindow({
  installScope,
  installed,
  onInstallToggle,
  onOpenChange,
  onScopeChange,
  open,
  plugin,
}: {
  installScope: InstallScope;
  installed: boolean;
  onInstallToggle: (pluginId: string) => void;
  onOpenChange: (open: boolean) => void;
  onScopeChange: (scope: InstallScope) => void;
  open: boolean;
  plugin: PluginListing | null;
}) {
  if (!plugin) {
    return null;
  }

  if (!open) {
    return (
      <button className="plugin-review-collapsed" type="button" onClick={() => onOpenChange(true)}>
        <ShieldCheck size={17} aria-hidden="true" />
        <span>
          <strong>Permission review collapsed</strong>
          <small>{plugin.name}</small>
        </span>
        <Maximize2 size={15} aria-hidden="true" />
      </button>
    );
  }

  return (
    <section className="plugin-review-window" aria-label="Permission review">
      <div className="plugin-review-summary">
        <div className="plugin-review-heading">
          <span className="plugin-review-icon">
            <ShieldCheck size={20} aria-hidden="true" />
          </span>
          <span>
            <strong>Permission review</strong>
            <small>{plugin.name} by {plugin.publisher}</small>
          </span>
        </div>
        <p>{plugin.description}</p>
        <ComponentBadges components={plugin.components} />
      </div>

      <dl className="plugin-review-facts">
        <div>
          <dt>Source</dt>
          <dd title={plugin.source}>{plugin.source}</dd>
        </div>
        <div>
          <dt>Marketplace</dt>
          <dd>{plugin.marketplace}</dd>
        </div>
        <div>
          <dt>Trust</dt>
          <dd>{plugin.trust}</dd>
        </div>
        <div>
          <dt>Version</dt>
          <dd>{plugin.version}</dd>
        </div>
        <div>
          <dt>Installs</dt>
          <dd>{formatInstallCount(plugin.installCount)}</dd>
        </div>
        <div>
          <dt>Scope</dt>
          <dd>{installScope}</dd>
        </div>
      </dl>

      <div className="plugin-review-permissions">
        {plugin.permissions.map((permission) => (
          <div key={`${plugin.id}-${permission.id}`} className="plugin-permission-row" data-sensitivity={permission.sensitivity}>
            <span>{getComponentIcon(permission.component)}</span>
            <span>
              <strong>{permission.label}</strong>
              <small>{permission.detail}</small>
            </span>
            <em>{formatSensitivity(permission.sensitivity)}</em>
          </div>
        ))}
      </div>

      <div className="plugin-review-control">
        <span>
          <strong>Install scope</strong>
          <small>{formatScopeDetail(installScope)}</small>
        </span>
        <PluginSelect label="Review install scope" value={installScope} onChange={(value) => onScopeChange(value as InstallScope)}>
          {scopeOptions.map((scope) => (
            <option key={scope}>{scope}</option>
          ))}
        </PluginSelect>
      </div>

      <code className="plugin-install-command">{plugin.installCommand}</code>

      <div className="plugin-review-actions">
        <a href={plugin.sourceUrl}>
          <ExternalLink size={15} aria-hidden="true" />
          <span>Source</span>
        </a>
        <button type="button" onClick={() => onOpenChange(false)}>
          <Minimize2 size={15} aria-hidden="true" />
          <span>Collapse</span>
        </button>
        <button type="button" data-installed={installed} onClick={() => onInstallToggle(plugin.id)}>
          {installed ? <Check size={15} aria-hidden="true" /> : <Download size={15} aria-hidden="true" />}
          <span>{installed ? "Disable" : "Install"}</span>
        </button>
      </div>
    </section>
  );
}

function MarketplacePanel() {
  return (
    <div className="plugin-marketplaces-layout">
      <section className="plugin-marketplace-grid" aria-label="Plugin marketplaces">
        {PLUGIN_MARKETPLACES.map((marketplace) => (
          <MarketplaceCard key={marketplace.id} marketplace={marketplace} />
        ))}
      </section>

      <section className="plugin-marketplace-add" aria-label="Add marketplace">
        <div className="plugin-review-heading">
          <span className="plugin-review-icon">
            <Store size={19} aria-hidden="true" />
          </span>
          <span>
            <strong>Add marketplace</strong>
            <small>Git, HTTPS, or workspace-local catalog</small>
          </span>
        </div>
        <label>
          <span>Name</span>
          <input defaultValue="team-marketplace" />
        </label>
        <label>
          <span>Source</span>
          <input defaultValue="https://example.com/plugins/marketplace.json" />
        </label>
        <div className="plugin-marketplace-add-actions">
          <button type="button">
            <Store size={15} aria-hidden="true" />
            <span>Add source</span>
          </button>
          <button type="button">
            <BookOpen size={15} aria-hidden="true" />
            <span>Open docs</span>
          </button>
        </div>
      </section>
    </div>
  );
}

function MarketplaceCard({ marketplace }: { marketplace: PluginMarketplace }) {
  return (
    <article className="plugin-marketplace-card" data-status={marketplace.status}>
      <div className="plugin-marketplace-card-header">
        <span className="plugin-review-icon">
          <Store size={18} aria-hidden="true" />
        </span>
        <span>
          <strong>{marketplace.name}</strong>
          <small>{marketplace.source}</small>
        </span>
        <StatusPill label={formatMarketplaceStatus(marketplace.status)} />
      </div>
      <p>{marketplace.description}</p>
      <dl className="plugin-card-details">
        <div>
          <dt>Trust</dt>
          <dd>{marketplace.trust}</dd>
        </div>
        <div>
          <dt>Plugins</dt>
          <dd>{marketplace.pluginCount}</dd>
        </div>
        <div>
          <dt>Sync</dt>
          <dd>{marketplace.autoUpdate ? "Auto" : "Manual"}</dd>
        </div>
        <div>
          <dt>Updated</dt>
          <dd>{marketplace.lastUpdated}</dd>
        </div>
      </dl>
      <div className="plugin-review-actions">
        <a href={marketplace.sourceUrl}>
          <ExternalLink size={15} aria-hidden="true" />
          <span>Source</span>
        </a>
        <button type="button">
          <Settings size={15} aria-hidden="true" />
          <span>Manage</span>
        </button>
      </div>
    </article>
  );
}

function CreatePluginPanel({
  copyStatus,
  draftComponents,
  draftDescription,
  draftName,
  manifestPreview,
  onCopyManifest,
  onDraftDescriptionChange,
  onDraftNameChange,
  onToggleComponent,
  selectedComponents,
}: {
  copyStatus: string;
  draftComponents: Record<PluginComponentKind, boolean>;
  draftDescription: string;
  draftName: string;
  manifestPreview: string;
  onCopyManifest: () => void;
  onDraftDescriptionChange: (value: string) => void;
  onDraftNameChange: (value: string) => void;
  onToggleComponent: (componentId: PluginComponentKind) => void;
  selectedComponents: PluginComponentKind[];
}) {
  return (
    <div className="plugin-create-layout">
      <section className="plugin-create-form" aria-label="Plugin details">
        <label>
          <span>Name</span>
          <input value={draftName} onChange={(event) => onDraftNameChange(event.target.value)} />
        </label>
        <label>
          <span>Description</span>
          <textarea rows={4} value={draftDescription} onChange={(event) => onDraftDescriptionChange(event.target.value)} />
        </label>
        <div className="plugin-component-picker" aria-label="Plugin components">
          {componentChoices.map((component) => {
            const selected = draftComponents[component.id];

            return (
              <button key={component.id} type="button" data-selected={selected} onClick={() => onToggleComponent(component.id)}>
                {getComponentIcon(component.id)}
                <span>{component.label}</span>
                {selected ? <CheckCircle2 size={15} aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>
      </section>

      <section className="plugin-manifest-preview" aria-label="Manifest preview">
        <div className="plugin-manifest-header">
          <span>
            <strong>{createPluginId(draftName)}</strong>
            <small>{selectedComponents.map((component) => PLUGIN_COMPONENT_LABELS[component]).join(", ") || "No components selected"}</small>
          </span>
          <button type="button" onClick={onCopyManifest}>
            <FileJson size={15} aria-hidden="true" />
            <span>{copyStatus || "Copy manifest"}</span>
          </button>
        </div>
        <pre>{manifestPreview}</pre>
        <div className="plugin-structure-list">
          <span>.gilbert-plugin/plugin.json</span>
          {selectedComponents.includes("skill") ? <span>skills/{createPluginId(draftName)}/SKILL.md</span> : null}
          {selectedComponents.includes("mcp") ? <span>.mcp.json</span> : null}
          {selectedComponents.includes("agent") ? <span>agents/reviewer.md</span> : null}
          {selectedComponents.includes("hook") ? <span>hooks/hooks.json</span> : null}
          {selectedComponents.includes("lsp") ? <span>.lsp.json</span> : null}
          {selectedComponents.includes("monitor") ? <span>monitors/monitors.json</span> : null}
        </div>
      </section>
    </div>
  );
}

function ComponentBadges({ components, limit }: { components: PluginComponentKind[]; limit?: number }) {
  const visibleComponents = typeof limit === "number" ? components.slice(0, limit) : components;
  const hiddenCount = components.length - visibleComponents.length;

  return (
    <div className="plugin-component-badges">
      {visibleComponents.map((component) => (
        <span key={component}>
          {getComponentIcon(component)}
          {PLUGIN_COMPONENT_LABELS[component]}
        </span>
      ))}
      {hiddenCount > 0 ? <span>+{hiddenCount}</span> : null}
    </div>
  );
}

function StatusBadge({ status }: { status: PluginListingStatus }) {
  const label = status === "installed" ? "Installed" : status === "queued" ? "Queued" : "Available";

  return <span className="plugin-status-badge" data-status={status}>{label}</span>;
}

function StatusPill({ label }: { label: string }) {
  return <span className="plugin-status-badge">{label}</span>;
}

function sortPluginListings(plugins: PluginListing[], sort: PluginSort) {
  if (sort === "name") {
    return [...plugins].sort((left, right) => left.name.localeCompare(right.name));
  }

  if (sort === "trust") {
    return [...plugins].sort((left, right) => getTrustScore(right.trust) - getTrustScore(left.trust) || right.installCount - left.installCount);
  }

  return [...plugins].sort((left, right) => right.installCount - left.installCount || getTrustScore(right.trust) - getTrustScore(left.trust));
}

function getTrustScore(trust: PluginListing["trust"]) {
  if (trust === "Official") {
    return 3;
  }

  if (trust === "Verified") {
    return 2;
  }

  return 1;
}

function createPluginId(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "my-plugin";
}

function formatScopeDetail(scope: InstallScope) {
  if (scope === "Project") {
    return "Only this workspace";
  }

  if (scope === "Local") {
    return "This local checkout";
  }

  return "All local Gilbert sessions";
}

function formatSensitivity(sensitivity: PluginPermissionSensitivity) {
  if (sensitivity === "high") {
    return "High";
  }

  if (sensitivity === "medium") {
    return "Medium";
  }

  return "Low";
}

function formatMarketplaceStatus(status: PluginMarketplace["status"]) {
  if (status === "not_connected") {
    return "Not connected";
  }

  if (status === "bundled") {
    return "Bundled";
  }

  if (status === "local") {
    return "Local";
  }

  return "Connected";
}

function getTabIcon(tabId: PluginTab) {
  if (tabId === "installed") {
    return <Settings size={16} aria-hidden="true" />;
  }

  if (tabId === "create") {
    return <PackagePlus size={16} aria-hidden="true" />;
  }

  if (tabId === "marketplaces") {
    return <Store size={16} aria-hidden="true" />;
  }

  return <Puzzle size={16} aria-hidden="true" />;
}

function getPluginIconUrl(plugin: PluginListing) {
  const domain = PLUGIN_ICON_DOMAINS[plugin.id] ?? PLUGIN_ICON_DOMAINS[plugin.category.toLowerCase()] ?? "github.com";

  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=96`;
}

function getPluginFallbackIcon(plugin: PluginListing) {
  if (plugin.components.includes("mcp") && plugin.category === "Apps & data") {
    return Globe2;
  }

  if (plugin.components.includes("lsp")) {
    return Code2;
  }

  if (plugin.components.includes("agent")) {
    return Bot;
  }

  if (plugin.category === "Design") {
    return Wand2;
  }

  if (plugin.category === "Security") {
    return ShieldCheck;
  }

  if (plugin.category === "Delivery") {
    return Workflow;
  }

  if (plugin.category === "Testing") {
    return SlidersHorizontal;
  }

  return Sparkles;
}

function getComponentIcon(component: PluginComponentKind) {
  if (component === "skill") {
    return <Sparkles size={14} aria-hidden="true" />;
  }

  if (component === "mcp") {
    return <Globe2 size={14} aria-hidden="true" />;
  }

  if (component === "agent") {
    return <Bot size={14} aria-hidden="true" />;
  }

  if (component === "hook") {
    return <Hammer size={14} aria-hidden="true" />;
  }

  if (component === "lsp") {
    return <Code2 size={14} aria-hidden="true" />;
  }

  return <BadgeCheck size={14} aria-hidden="true" />;
}
