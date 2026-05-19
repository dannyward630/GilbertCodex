export type PluginComponentKind = "agent" | "hook" | "lsp" | "mcp" | "monitor" | "skill";

export type PluginListingStatus = "available" | "installed" | "queued";
export type PluginTrust = "Community" | "Official" | "Verified";
export type PluginPermissionSensitivity = "low" | "medium" | "high";

export interface PluginPermission {
  component: PluginComponentKind;
  detail: string;
  id: string;
  label: string;
  sensitivity: PluginPermissionSensitivity;
}

export interface PluginSkillOption {
  aliases: string[];
  category: string;
  description: string;
  id: string;
  mention: string;
  plugin: string;
  pluginId: string;
  status: PluginListingStatus;
  tags: string[];
  title: string;
}

export interface PluginListing {
  category: string;
  components: PluginComponentKind[];
  description: string;
  homepage: string;
  id: string;
  installCommand: string;
  installCount: number;
  marketplace: string;
  name: string;
  permissions: PluginPermission[];
  publisher: string;
  skills: PluginSkillOption[];
  source: string;
  sourceUrl: string;
  status: PluginListingStatus;
  tags: string[];
  trust: PluginTrust;
  updated: string;
  version: string;
}

export interface PluginMarketplace {
  autoUpdate: boolean;
  description: string;
  id: string;
  lastUpdated: string;
  name: string;
  pluginCount: number;
  source: string;
  sourceUrl: string;
  status: "bundled" | "connected" | "local" | "not_connected";
  trust: PluginTrust;
}

export const PLUGIN_CATEGORIES = [
  "All",
  "Coding",
  "Code intelligence",
  "Apps & data",
  "Research",
  "Design",
  "Security",
  "Testing",
  "Delivery",
  "Authoring",
] as const;

export const PLUGIN_COMPONENT_LABELS: Record<PluginComponentKind, string> = {
  agent: "Agents",
  hook: "Hooks",
  lsp: "LSP",
  mcp: "MCP",
  monitor: "Monitors",
  skill: "Skills",
};

export const DEFAULT_INSTALLED_PLUGIN_IDS = [
  "github",
  "playwright-browser",
  "figma",
  "stripe",
  "coderabbit",
] as const;

export const PLUGIN_MARKETPLACES: PluginMarketplace[] = [
  {
    autoUpdate: true,
    description: "Local Codex plugin cache exposed by this desktop session. Bundles skills, MCP tools, and app connectors that are already available to Codex.",
    id: "openai-curated",
    lastUpdated: "2026-05-15",
    name: "OpenAI curated",
    pluginCount: 13,
    source: "$CODEX_HOME/plugins/cache/openai-curated",
    sourceUrl: "https://openai.com/academy/codex-plugins-and-skills/",
    status: "bundled",
    trust: "Official",
  },
  {
    autoUpdate: true,
    description: "Gilbert Codex curated catalog for proven plugin concepts while the backend installer is being built.",
    id: "gilbert-curated",
    lastUpdated: "2026-05-15",
    name: "Gilbert Codex curated",
    pluginCount: 100,
    source: "gilbert-codex-curated",
    sourceUrl: "https://github.com/UrbanWafflezz/GilbertCodex",
    status: "connected",
    trust: "Verified",
  },
  {
    autoUpdate: false,
    description: "Workspace-local plugin folders for private skills, MCP servers, hooks, LSP config, and monitors.",
    id: "workspace-local",
    lastUpdated: "Local",
    name: "Workspace local",
    pluginCount: 0,
    source: ".gilbert/plugins",
    sourceUrl: "https://github.com/UrbanWafflezz/GilbertCodex",
    status: "local",
    trust: "Community",
  },
  {
    autoUpdate: false,
    description: "A future team-controlled Git or HTTPS catalog for internal plugins after the backend install flow lands.",
    id: "team-marketplace",
    lastUpdated: "Not connected",
    name: "Team marketplace",
    pluginCount: 0,
    source: "Git URL or HTTPS catalog",
    sourceUrl: "https://github.com/UrbanWafflezz/GilbertCodex",
    status: "not_connected",
    trust: "Community",
  },
];

const docs = permission("docs", "Read documentation", "Can fetch or attach product docs and reference material into the model context.", "skill", "low");
const repoRead = permission("repo-read", "Read repository data", "Can inspect repository files, symbols, issues, pull requests, or workspace metadata.", "mcp", "medium");
const repoWrite = permission("repo-write", "Change repository data", "Can create branches, issues, pull requests, commits, or code changes after user approval.", "mcp", "high");
const browser = permission("browser", "Control browser session", "Can drive a browser, take screenshots, inspect network activity, or automate end-to-end tests.", "mcp", "high");
const designFiles = permission("design-files", "Read design files", "Can access design files, components, tokens, and exported implementation context.", "mcp", "medium");
const cloud = permission("cloud", "Manage cloud resources", "Can inspect or operate cloud projects, deployments, logs, databases, or infrastructure.", "mcp", "high");
const lsp = permission("lsp", "Start language server", "Can launch a local language server process for code intelligence and diagnostics.", "lsp", "medium");
const hooks = permission("hooks", "Run hooks", "Can run event-triggered checks around file edits, shell commands, or agent workflow events.", "hook", "high");
const agents = permission("agents", "Spawn specialist agents", "Can activate task-specific agents with their own instructions and tool restrictions.", "agent", "medium");
const monitors = permission("monitors", "Run background monitors", "Can start background watchers that stream logs, file changes, or service events into the session.", "monitor", "high");
const messaging = permission("messaging", "Access messaging workspace", "Can search, draft, or send messages in connected collaboration tools after approval.", "mcp", "high");
const payments = permission("payments", "Access billing objects", "Can inspect or create payment, billing, subscription, customer, or invoice objects after approval.", "mcp", "high");
const securityScan = permission("security-scan", "Analyze code security", "Can scan code, dependency, IaC, or policy data and surface remediation guidance.", "mcp", "medium");

export const PLUGIN_LISTINGS: PluginListing[] = [
  listing({
    category: "Design",
    components: ["skill", "agent"],
    description: "Craft production-grade frontends with distinctive design and implementation guidance that avoids generic AI UI patterns.",
    id: "frontend-design",
    installCount: 732603,
    name: "Frontend Design",
    permissions: [docs, agents],
    publisher: "Gilbert Codex",
    skills: [skill("frontend-design", "Frontend design", "Shape a polished frontend direction and implementation pass.", "Design", ["UI", "Frontend", "Visual QA"])],
    tags: ["UI", "Frontend", "Design"],
    trust: "Verified",
  }),
  listing({
    category: "Coding",
    components: ["skill", "agent", "hook"],
    description: "Brainstorming, debugging, TDD, skill authoring, and subagent development workflows packaged as one capability bundle.",
    id: "superpowers",
    installCount: 652113,
    name: "Superpowers",
    permissions: [docs, agents, hooks],
    publisher: "Gilbert Codex",
    skills: [skill("superpowers", "Superpowers", "Use structured coding workflows for design, TDD, review, and debugging.", "Coding", ["TDD", "Debug", "Review"])],
    tags: ["Workflow", "TDD", "Agents"],
    trust: "Verified",
  }),
  listing({
    category: "Research",
    components: ["mcp"],
    description: "Upstash Context7 MCP server for live, version-specific documentation lookup and code examples from source repositories.",
    id: "context7",
    installCount: 320585,
    name: "Context7",
    permissions: [docs, repoRead],
    publisher: "Upstash",
    skills: [skill("context7", "Context7 docs", "Look up current library docs and examples before implementing.", "Research", ["Docs", "MCP", "Libraries"])],
    tags: ["Docs", "MCP", "Libraries"],
    trust: "Community",
  }),
  listing({
    category: "Coding",
    components: ["agent", "skill"],
    description: "AI code review with specialized agents and confidence-based filtering for pull requests.",
    id: "code-review",
    installCount: 312840,
    name: "Code Review",
    permissions: [repoRead, agents],
    publisher: "Gilbert Codex",
    skills: [skill("code-review", "Code review", "Review changed code for regressions, risks, quality, and missing tests.", "Coding", ["Review", "PR", "Tests"])],
    tags: ["Review", "PR", "Agents"],
    trust: "Verified",
  }),
  listing({
    category: "Coding",
    components: ["agent", "skill"],
    description: "Code clarity agent that simplifies and refines recently modified code while preserving behavior and project style.",
    id: "code-simplifier",
    installCount: 258110,
    name: "Code Simplifier",
    permissions: [repoRead, repoWrite, agents],
    publisher: "Gilbert Codex",
    skills: [skill("code-simplifier", "Code simplifier", "Simplify fresh changes while preserving behavior and tests.", "Coding", ["Refactor", "Clarity"])],
    tags: ["Refactor", "Quality"],
    trust: "Verified",
  }),
  listing({
    category: "Authoring",
    components: ["skill"],
    description: "Create, improve, evaluate, and benchmark skills for repeatable team workflows.",
    id: "skill-creator",
    installCount: 244732,
    name: "Skill Creator",
    permissions: [docs, repoWrite],
    publisher: "Gilbert Codex",
    skills: [skill("skill-creator", "Skill creator", "Design or improve a reusable skill with clear trigger guidance.", "Authoring", ["Skills", "Authoring"])],
    tags: ["Skills", "Authoring"],
    trust: "Verified",
  }),
  listing({
    category: "Apps & data",
    components: ["mcp"],
    description: "Official GitHub MCP server for repository management, issues, pull requests, review, search, and API access.",
    id: "github",
    installCount: 240296,
    name: "GitHub",
    permissions: [repoRead, repoWrite],
    publisher: "GitHub",
    skills: [skill("github", "GitHub workflow", "Use repository, pull request, issue, and code-search context.", "Apps & data", ["GitHub", "PR", "Issues"])],
    tags: ["Repositories", "Pull requests", "Issues"],
    trust: "Official",
  }),
  listing({
    category: "Testing",
    components: ["mcp"],
    description: "Microsoft Playwright browser automation and end-to-end testing MCP server for page inspection, screenshots, and form automation.",
    id: "playwright-browser",
    installCount: 223398,
    name: "Playwright",
    permissions: [browser],
    publisher: "Microsoft",
    skills: [skill("playwright", "Playwright test", "Inspect a web app, take screenshots, and run browser QA.", "Testing", ["Browser", "Screenshots", "E2E"])],
    tags: ["Browser", "Testing", "Screenshots"],
    trust: "Official",
  }),
  listing({
    category: "Coding",
    components: ["agent", "skill"],
    description: "Feature development workflow with agents for exploration, implementation design, and review.",
    id: "feature-dev",
    installCount: 202749,
    name: "Feature Dev",
    permissions: [repoRead, repoWrite, agents],
    publisher: "Gilbert Codex",
    skills: [skill("feature-dev", "Feature development", "Plan and execute an end-to-end feature workflow.", "Coding", ["Feature", "Agents", "Plan"])],
    tags: ["Feature", "Agents", "Planning"],
    trust: "Verified",
  }),
  listing({
    category: "Code intelligence",
    components: ["lsp"],
    description: "TypeScript and JavaScript language server for enhanced code intelligence.",
    id: "typescript-lsp",
    installCount: 164111,
    name: "TypeScript LSP",
    permissions: [lsp, repoRead],
    publisher: "Gilbert Codex",
    skills: [],
    tags: ["TypeScript", "JavaScript", "LSP"],
    trust: "Verified",
  }),
  listing({
    category: "Security",
    components: ["hook", "skill"],
    description: "Security hook that warns about command injection, XSS, and unsafe code patterns while editing files.",
    id: "security-guidance",
    installCount: 153765,
    name: "Security Guidance",
    permissions: [hooks, securityScan],
    publisher: "Gilbert Codex",
    skills: [skill("security-guidance", "Security guidance", "Review edits for command injection, XSS, unsafe patterns, and risky flows.", "Security", ["Security", "Hooks"])],
    tags: ["Security", "Hooks", "SAST"],
    trust: "Verified",
  }),
  listing({
    category: "Coding",
    components: ["skill"],
    description: "Git commit workflows including commit, push, and pull request creation.",
    id: "commit-commands",
    installCount: 134812,
    name: "Commit Commands",
    permissions: [repoRead, repoWrite],
    publisher: "Gilbert Codex",
    skills: [skill("commit", "Commit workflow", "Prepare a commit, push branch, and draft a pull request.", "Coding", ["Git", "Commit", "PR"])],
    tags: ["Git", "Commit", "PR"],
    trust: "Verified",
  }),
  listing({
    category: "Design",
    components: ["mcp", "skill"],
    description: "Figma integration for design files, components, tokens, and translating designs into code.",
    id: "figma",
    installCount: 124825,
    name: "Figma",
    permissions: [designFiles, repoWrite],
    publisher: "Figma",
    skills: [skill("figma", "Figma implementation", "Read a Figma design and translate it into production UI.", "Design", ["Figma", "Design system", "Tokens"])],
    tags: ["Figma", "Design systems", "Tokens"],
    trust: "Community",
  }),
  listing({
    category: "Authoring",
    components: ["skill", "mcp", "agent", "hook", "monitor"],
    description: "Plugin toolkit with expert skills for hooks, MCP, commands, agents, validation, and best practices.",
    id: "plugin-developer-toolkit",
    installCount: 53357,
    name: "Plugin Developer Toolkit",
    permissions: [repoRead, repoWrite, hooks, agents, monitors],
    publisher: "Gilbert Codex",
    skills: [skill("plugin-dev", "Plugin development", "Create or validate plugin manifests, skills, hooks, MCP, agents, and LSP config.", "Authoring", ["Plugins", "MCP", "Hooks"])],
    tags: ["Plugins", "Authoring", "Validation"],
    trust: "Verified",
  }),
  listing({
    category: "Testing",
    components: ["mcp"],
    description: "Control and inspect a live Chrome browser, record performance traces, and analyze network requests.",
    id: "chrome-devtools",
    installCount: 57456,
    name: "Chrome DevTools",
    permissions: [browser],
    publisher: "Chrome DevTools",
    skills: [skill("chrome-devtools", "Chrome DevTools", "Inspect runtime browser state, performance, network, and screenshots.", "Testing", ["Chrome", "Performance", "Network"])],
    tags: ["Chrome", "Performance", "Network"],
    trust: "Community",
  }),
  listing({
    category: "Coding",
    components: ["agent", "skill"],
    description: "PR review agents for comments, tests, errors, types, quality, and simplification.",
    id: "pr-review-toolkit",
    installCount: 89671,
    name: "PR Review Toolkit",
    permissions: [repoRead, agents],
    publisher: "Gilbert Codex",
    skills: [skill("pr-review", "PR review", "Review a pull request with focused agents for tests, types, and quality.", "Coding", ["PR", "Review", "Agents"])],
    tags: ["PR", "Review", "Agents"],
    trust: "Verified",
  }),
  listing({
    category: "Apps & data",
    components: ["mcp"],
    description: "Supabase MCP for database operations, auth, storage, realtime projects, SQL, and backend management.",
    id: "supabase",
    installCount: 85973,
    name: "Supabase",
    permissions: [cloud],
    publisher: "Supabase",
    skills: [skill("supabase", "Supabase backend", "Inspect Supabase projects, run SQL, and manage backend resources.", "Apps & data", ["Database", "Auth", "SQL"])],
    tags: ["Database", "Auth", "SQL"],
    trust: "Community",
  }),
  listing({
    category: "Code intelligence",
    components: ["lsp"],
    description: "Python language server powered by Pyright for type checking and code intelligence.",
    id: "pyright-lsp",
    installCount: 84277,
    name: "Pyright LSP",
    permissions: [lsp, repoRead],
    publisher: "Gilbert Codex",
    skills: [],
    tags: ["Python", "Types", "LSP"],
    trust: "Verified",
  }),
  listing({
    category: "Code intelligence",
    components: ["mcp", "lsp"],
    description: "Semantic code analysis MCP server for intelligent code understanding, refactoring, and navigation via language server protocol.",
    id: "serena",
    installCount: 77850,
    name: "Serena",
    permissions: [repoRead, repoWrite, lsp],
    publisher: "Serena",
    skills: [skill("serena", "Semantic code analysis", "Navigate, understand, and refactor code through semantic code analysis.", "Code intelligence", ["Symbols", "Refactor", "MCP"])],
    tags: ["Symbols", "Refactor", "MCP"],
    trust: "Community",
  }),
  listing({
    category: "Apps & data",
    components: ["mcp"],
    description: "Official Slack MCP server for collaborative workflows, insights, message drafting, and team engagement.",
    id: "slack",
    installCount: 63343,
    name: "Slack",
    permissions: [messaging],
    publisher: "Slack",
    skills: [skill("slack", "Slack workflow", "Search Slack context, draft messages, and prepare collaboration updates.", "Apps & data", ["Slack", "Messages", "Team"])],
    tags: ["Slack", "Messaging", "Team"],
    trust: "Verified",
  }),
  listing({
    category: "Delivery",
    components: ["mcp"],
    description: "Vercel integration for deployments, builds, logs, domains, and frontend infrastructure.",
    id: "vercel",
    installCount: 115077,
    name: "Vercel",
    permissions: [cloud],
    publisher: "Vercel",
    skills: [skill("vercel", "Vercel deploy", "Inspect deployments, logs, domains, and frontend infrastructure.", "Delivery", ["Deploy", "Logs", "Frontend"])],
    tags: ["Deployments", "Logs", "Infrastructure"],
    trust: "Community",
  }),
  listing({
    category: "Apps & data",
    components: ["mcp", "skill"],
    description: "Stripe development plugin for payment, billing, subscription, customer, invoice, and integration workflows.",
    id: "stripe",
    installCount: 25832,
    name: "Stripe",
    permissions: [payments, docs],
    publisher: "Stripe",
    skills: [skill("stripe", "Stripe integration", "Design, inspect, or build payment and billing workflows.", "Apps & data", ["Payments", "Billing", "Subscriptions"])],
    tags: ["Payments", "Billing", "Subscriptions"],
    trust: "Official",
  }),
  listing({
    category: "Security",
    components: ["mcp", "agent"],
    description: "CodeRabbit AI code review with analyzers, AST parsing, security checks, and project guideline integration.",
    id: "coderabbit",
    installCount: 23759,
    name: "CodeRabbit",
    permissions: [repoRead, securityScan, agents],
    publisher: "CodeRabbit",
    skills: [skill("coderabbit", "CodeRabbit review", "Run AI review with analyzers, guideline checks, and security signals.", "Security", ["Review", "Security", "Quality"])],
    tags: ["Review", "Security", "Quality"],
    trust: "Community",
  }),
  listing({
    category: "Security",
    components: ["mcp", "hook", "skill"],
    description: "Semgrep security plugin that catches vulnerabilities and guides safer code from the start.",
    id: "semgrep",
    installCount: 14046,
    name: "Semgrep",
    permissions: [securityScan, hooks],
    publisher: "Semgrep",
    skills: [skill("semgrep", "Semgrep scan", "Scan code for security issues and use findings to guide fixes.", "Security", ["SAST", "Security", "Rules"])],
    tags: ["SAST", "Security", "Rules"],
    trust: "Verified",
  }),
  listing({
    category: "Authoring",
    components: ["skill", "mcp"],
    description: "Design and build MCP servers, including deployment, tools, auth, HTTP transports, MCPB, and local server patterns.",
    id: "mcp-server-dev",
    installCount: 12464,
    name: "MCP Server Dev",
    permissions: [docs, repoWrite],
    publisher: "Gilbert Codex",
    skills: [skill("mcp-server-dev", "MCP server development", "Design, build, and validate MCP servers and tool schemas.", "Authoring", ["MCP", "Tools", "Auth"])],
    tags: ["MCP", "Tools", "Auth"],
    trust: "Verified",
  }),
  listing({
    category: "Code intelligence",
    components: ["lsp"],
    description: "Go language server for code intelligence and refactoring.",
    id: "go-lsp",
    installCount: 32592,
    name: "Go LSP",
    permissions: [lsp, repoRead],
    publisher: "Gilbert Codex",
    skills: [],
    tags: ["Go", "gopls", "LSP"],
    trust: "Verified",
  }),
  listing({
    category: "Code intelligence",
    components: ["lsp"],
    description: "Rust Analyzer language server for code intelligence and Rust analysis.",
    id: "rust-analyzer-lsp",
    installCount: 27993,
    name: "Rust Analyzer LSP",
    permissions: [lsp, repoRead],
    publisher: "Gilbert Codex",
    skills: [],
    tags: ["Rust", "LSP", "Analysis"],
    trust: "Verified",
  }),
];

export const PLUGIN_SKILL_OPTIONS: PluginSkillOption[] = PLUGIN_LISTINGS.flatMap((plugin) => plugin.skills);

export function getPluginById(pluginId: string) {
  return PLUGIN_LISTINGS.find((plugin) => plugin.id === pluginId);
}

export function getSkillMentionMatches(query: string, limit = 7) {
  const normalizedQuery = normalizeSkillQuery(query);

  if (!normalizedQuery) {
    return PLUGIN_SKILL_OPTIONS.slice(0, limit);
  }

  return PLUGIN_SKILL_OPTIONS.filter((skillOption) => {
    const haystack = [
      skillOption.mention,
      ...skillOption.aliases,
      skillOption.title,
      skillOption.plugin,
      skillOption.description,
      skillOption.category,
      ...skillOption.tags,
    ].join(" ").toLowerCase();
    return haystack.includes(normalizedQuery);
  }).slice(0, limit);
}

export function formatInstallCount(count: number) {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: count >= 10000 ? 1 : 0,
    notation: count >= 10000 ? "compact" : "standard",
  }).format(count);
}

function listing(listingOptions: Omit<PluginListing, "homepage" | "installCommand" | "marketplace" | "source" | "sourceUrl" | "status" | "updated" | "version">): PluginListing {
  return {
    ...listingOptions,
    homepage: "https://github.com/UrbanWafflezz/GilbertCodex",
    installCommand: `/plugin install ${listingOptions.id}@gilbert-codex-curated`,
    marketplace: "Gilbert Codex curated",
    source: "gilbert-codex-curated",
    sourceUrl: "https://github.com/UrbanWafflezz/GilbertCodex",
    status: "available",
    updated: "2026-05-15",
    version: "latest",
  };
}

function skill(id: string, title: string, description: string, category: string, tags: string[]): PluginSkillOption {
  return {
    aliases: [`@${id}`],
    category,
    description,
    id,
    mention: `$${id}`,
    plugin: "",
    pluginId: "",
    status: "available",
    tags,
    title,
  };
}

function permission(
  id: string,
  label: string,
  detail: string,
  component: PluginComponentKind,
  sensitivity: PluginPermissionSensitivity,
): PluginPermission {
  return {
    component,
    detail,
    id,
    label,
    sensitivity,
  };
}

for (const plugin of PLUGIN_LISTINGS) {
  for (const skillOption of plugin.skills) {
    skillOption.plugin = plugin.name;
    skillOption.pluginId = plugin.id;
    skillOption.status = plugin.status;
  }
}

function normalizeSkillQuery(query: string) {
  return query.trim().replace(/^[$@]/, "").toLowerCase();
}
