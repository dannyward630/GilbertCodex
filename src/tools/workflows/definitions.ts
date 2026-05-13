import type { WorkflowDefinition, WorkflowPrimitiveStepDefinition, WorkflowStepDefinition } from "./types";
import { getWorkflowPrimitive } from "./primitiveRegistry";

function primitive(
  id: string,
  label: string,
  tool: WorkflowPrimitiveStepDefinition["tool"],
  args: Record<string, string> = {},
  options: Pick<WorkflowPrimitiveStepDefinition, "optional" | "retry"> = {},
): WorkflowPrimitiveStepDefinition {
  const primitiveDefinition = getWorkflowPrimitive(tool);

  return {
    args,
    family: primitiveDefinition?.family,
    id,
    kind: "primitive",
    label,
    optional: options.optional,
    retry: options.retry,
    tool,
  };
}

function note(id: string, label: string, detail: string): WorkflowStepDefinition {
  return {
    detail,
    id,
    kind: "note",
    label,
  };
}

function synthesize(id: string, label: string, detail: string): WorkflowStepDefinition {
  return {
    detail,
    id,
    kind: "model_synthesis",
    label,
  };
}

export const WORKFLOW_DEFINITIONS: WorkflowDefinition[] = [
  {
    description: "Inspect the real agent/tool/workflow surfaces and return implementation-grade evidence before changing code.",
    id: "agent-workflow-audit",
    mutates: false,
    requiredTools: ["fileSearch", "codeView"],
    steps: [
      {
        id: "workflow-runtime-discovery",
        kind: "parallel",
        label: "Discover workflow and tool runtime files",
        steps: [
          primitive("recall-runtime", "Recall runtime architecture notes", "recall_context", { query: "{{goal}}" }, { optional: true }),
          primitive("search-workflow", "Search workflow surfaces", "search_files", { query: "workflow_run WorkflowsPage runtimeToolPrompt toolSchemaAdapters executor registry" }),
          primitive("search-approval", "Search approval and tool-loop surfaces", "search_files", { query: "approval toolCalls AgentRun runLocalComputerToolCalls executeRegisteredTool" }),
        ],
      },
      primitive("read-package", "Read package manifest", "read_file", { path: "package.json" }, { optional: true }),
      primitive("read-workflows-page", "Read Workflows page", "view_code", { path: "src/pages/WorkflowsPage.tsx", start_line: "1", end_line: "220" }, { optional: true }),
      synthesize("audit-synthesis", "Synthesize audit findings", "Use the gathered evidence to rank workflow-layer gaps and name the exact implementation seams."),
    ],
    successCriteria: [
      "Names the current runtime surfaces from fresh file evidence.",
      "Separates missing workflow orchestration from existing primitive tool behavior.",
      "Produces an implementation-ready next step instead of generic architecture prose.",
    ],
    title: "Agent Workflow Audit",
    triggerHints: ["audit workflow", "workflow layer", "tool sprawl", "agent runtime", "inspect tools", "missing workflow"],
    version: 1,
  },
  {
    description: "Gather local evidence for a requested feature before the model patches and verifies through primitive tools.",
    id: "plan-patch-verify",
    mutates: false,
    requiredTools: ["fileSearch", "codeView"],
    steps: [
      {
        id: "feature-context",
        kind: "parallel",
        label: "Gather feature context",
        steps: [
          primitive("recall-feature", "Recall project context", "recall_context", { query: "{{goal}}" }, { optional: true }),
          primitive("search-feature", "Search relevant files", "search_files", { query: "{{goal}}" }),
          primitive("read-package", "Read package manifest", "read_file", { path: "package.json" }, { optional: true }),
        ],
      },
      synthesize("feature-handoff", "Prepare patch handoff", "Continue with direct primitive edits only after reading the exact target files and preserve unrelated work."),
    ],
    successCriteria: [
      "Finds the likely files before editing.",
      "Leaves mutation to guarded primitive tools after the evidence pass.",
      "Keeps verification explicit after edits.",
    ],
    title: "Plan, Patch, Verify",
    triggerHints: ["implement", "fix", "patch", "change", "make this", "build feature", "verify"],
    version: 1,
  },
  {
    description: "Combine current web evidence with local code context before implementing a docs- or ecosystem-sensitive change.",
    id: "research-backed-patch",
    mutates: false,
    requiredTools: ["webSearch", "fileSearch", "codeView"],
    steps: [
      {
        id: "research-context",
        kind: "parallel",
        label: "Gather web and local context",
        steps: [
          primitive("web-research", "Search current external docs", "web_search", { query: "{{goal}} official docs current behavior" }, { optional: true }),
          primitive("search-local", "Search local implementation", "search_files", { query: "{{goal}}" }),
          primitive("recall-local", "Recall local architecture", "recall_context", { query: "{{goal}}" }, { optional: true }),
        ],
      },
      synthesize("research-handoff", "Synthesize source-backed requirements", "Use only returned web URLs for live claims, then continue with guarded primitive edits if needed."),
    ],
    successCriteria: [
      "Collects current external evidence when facts can drift.",
      "Maps external findings to local files.",
      "Cites web sources in the final answer when used.",
    ],
    title: "Research-Backed Patch",
    triggerHints: ["research", "docs", "official", "latest", "current", "api", "provider", "library"],
    version: 1,
  },
  {
    description: "Inspect repository state and likely validation commands without mutating files or running shell checks yet.",
    id: "repo-health-sweep",
    mutates: false,
    requiredTools: ["sourceControl", "codeView"],
    steps: [
      primitive("git-status", "Inspect Git status", "git_status", {}),
      primitive("git-diff-stat", "Inspect Git diff summary", "git_diff", { include_untracked: "true", stat: "true" }, { optional: true }),
      primitive("read-package", "Read package manifest", "read_file", { path: "package.json" }, { optional: true }),
      primitive("read-readme", "Read README", "read_file", { path: "README.md" }, { optional: true }),
      synthesize("health-synthesis", "Summarize health sweep", "Name the likely checks to run next and any visible repository risks from the evidence."),
    ],
    successCriteria: [
      "Reports local Git state.",
      "Identifies likely validation scripts.",
      "Does not mutate or run terminal commands before user-visible evidence exists.",
    ],
    title: "Repo Health Sweep",
    triggerHints: ["health sweep", "run checks", "repo health", "validate", "before shipping", "build status"],
    version: 1,
  },
  {
    description: "Prepare local changes for review with complete Git evidence before staging, committing, pushing, or opening a PR.",
    id: "branch-pr-prep",
    mutates: false,
    requiredTools: ["sourceControl"],
    steps: [
      primitive("git-status", "Inspect local Git status", "git_status", {}),
      primitive("git-diff", "Inspect local Git diff", "git_diff", { include_untracked: "true" }),
      primitive("git-log", "Inspect recent Git history", "git_log", { limit: "12" }, { optional: true }),
      synthesize("pr-handoff", "Draft review context", "Group changes by behavior, list risky files, and ask for approval before mutating source control."),
    ],
    successCriteria: [
      "Uses local Git evidence, not only GitHub API state.",
      "Lists changed files from tool output.",
      "Keeps staging, committing, pushing, and PR creation behind explicit follow-up action.",
    ],
    title: "Branch And PR Prep",
    triggerHints: ["pr prep", "pull request", "branch prep", "commit prep", "push this", "source control review"],
    version: 1,
  },
  {
    description: "Discover MCP servers and available tools before selecting or calling a configured server tool.",
    id: "mcp-tool-usage",
    mutates: false,
    requiredTools: ["mcpServers"],
    steps: [
      primitive("list-mcp-servers", "List MCP servers", "mcp_list_servers", {}),
      primitive("list-mcp-tools", "List MCP tools", "mcp_list_tools", {}, { optional: true }),
      synthesize("mcp-synthesis", "Select MCP next action", "Use exact server labels and tool names from discovery before any mcp_call_tool request."),
    ],
    successCriteria: [
      "Discovers configured servers first.",
      "Uses exact MCP tool names and argument schemas.",
      "Does not mutate server settings without approval.",
    ],
    title: "MCP Tool Usage",
    triggerHints: ["mcp", "server tool", "connector", "external tool", "list tools"],
    version: 1,
  },
  {
    description: "Create a repeatable monitor brief while the recurring scheduler remains a separate future runtime.",
    id: "monitor-brief",
    mutates: false,
    requiredTools: ["workflowAutomation"],
    steps: [
      {
        id: "monitor-context",
        kind: "parallel",
        label: "Gather monitor signal context",
        steps: [
          primitive("recall-monitor", "Recall workspace context", "recall_context", { query: "{{goal}}" }, { optional: true }),
          primitive("search-monitor", "Search local monitor targets", "search_files", { query: "{{goal}}" }, { optional: true }),
        ],
      },
      note("scheduler-note", "Record scheduler boundary", "Recurring scheduling is not created by this workflow v1; this step produces the monitor contract only."),
      synthesize("monitor-synthesis", "Write monitor brief", "Define the signal, proof command/source, frequency idea, and notification condition."),
    ],
    successCriteria: [
      "Defines a repeatable signal and evidence source.",
      "Does not create a schedule in v1.",
      "Names what future automation should notify on.",
    ],
    title: "Manual Monitor Brief",
    triggerHints: ["monitor", "check repeatedly", "watch", "scheduled", "notify", "follow up"],
    version: 1,
  },
];

export function listWorkflowDefinitions() {
  return WORKFLOW_DEFINITIONS;
}

export function getWorkflowDefinition(id: string | undefined) {
  const normalized = normalizeWorkflowId(id);
  return WORKFLOW_DEFINITIONS.find((workflow) => workflow.id === normalized);
}

export function normalizeWorkflowId(value: string | undefined) {
  return (value ?? "").trim().toLowerCase().replace(/_/g, "-");
}
