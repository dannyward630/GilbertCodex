import type { LocalComputerToolName } from "../computer/executor/types";
import type { WorkflowPrimitiveDefinition, WorkflowPrimitiveFamily } from "./types";

function primitive(
  tool: LocalComputerToolName,
  family: WorkflowPrimitiveFamily,
  description: string,
  mutates = false,
  requiredTools: WorkflowPrimitiveDefinition["requiredTools"] = [],
): WorkflowPrimitiveDefinition {
  return {
    description,
    family,
    mutates,
    requiredTools,
    tool,
  };
}

export const WORKFLOW_PRIMITIVES: WorkflowPrimitiveDefinition[] = [
  primitive("recall_context", "workspace_read", "Recall project memory and indexed workspace context.", false, ["fileSearch"]),
  primitive("search_files", "workspace_read", "Search workspace files by name, content, and indexed relevance.", false, ["fileSearch"]),
  primitive("list_directory", "workspace_read", "List workspace directory contents.", false, ["fileBrowser"]),
  primitive("build_index", "workspace_read", "Refresh the local workspace index.", false, ["fileBrowser"]),
  primitive("read_file", "workspace_read", "Read a workspace file.", false, ["codeView"]),
  primitive("view_code", "workspace_read", "Read exact code or text windows.", false, ["codeView"]),

  primitive("edit_file", "workspace_mutate", "Edit an existing workspace file precisely.", true, ["codeEdit"]),
  primitive("edit_files", "workspace_mutate", "Batch precise edits across existing files.", true, ["codeEdit"]),
  primitive("write_file", "workspace_mutate", "Create or intentionally replace a file.", true, ["codeEdit"]),
  primitive("create_files", "workspace_mutate", "Create multiple files in one guarded batch.", true, ["fileCreation"]),
  primitive("create_vite_project", "workspace_mutate", "Create or repair a Vite React starter project.", true, ["fileCreation"]),
  primitive("delete_file", "workspace_mutate", "Delete one file through the file safety gate.", true, ["fileSafety"]),
  primitive("move_path", "workspace_mutate", "Move a file or folder inside enabled roots.", true, ["codeEdit"]),
  primitive("rename_path", "workspace_mutate", "Rename a file or folder inside enabled roots.", true, ["codeEdit"]),

  primitive("run_terminal", "terminal", "Run a local terminal command or managed background process.", true, ["terminal"]),
  primitive("create_tool", "terminal", "Create a reusable workspace helper under .gilbert/tools.", true, ["terminal", "codeEdit"]),
  primitive("run_tool", "terminal", "Run a reusable workspace helper.", true, ["terminal"]),

  primitive("web_search", "web", "Search live web sources for current facts or docs.", false, ["webSearch"]),
  primitive("weather", "web", "Fetch NOAA/NWS weather data.", false, ["weatherTools"]),
  primitive("lookup_color", "web", "Look up local color data.", false, ["colorTools"]),
  primitive("open_browser_preview", "web", "Open a URL in the in-app browser preview.", false, ["browserPreview"]),
  primitive("browser_automation", "web", "Inspect or interact with the in-app browser preview.", true, ["browserPreview"]),

  primitive("git_status", "source_control", "Inspect local Git branch and working tree state.", false, ["sourceControl"]),
  primitive("git_diff", "source_control", "Inspect local Git diff and untracked text.", false, ["sourceControl"]),
  primitive("git_log", "source_control", "Inspect local Git commit history.", false, ["sourceControl"]),
  primitive("git_init", "source_control", "Initialize a local Git repository.", true, ["sourceControl"]),
  primitive("git_stage", "source_control", "Stage local Git changes.", true, ["sourceControl"]),
  primitive("git_unstage", "source_control", "Unstage local Git changes.", true, ["sourceControl"]),
  primitive("git_commit", "source_control", "Commit staged local Git changes.", true, ["sourceControl"]),
  primitive("git_push", "source_control", "Push local Git commits.", true, ["sourceControl"]),
  primitive("git_pull", "source_control", "Pull remote Git changes.", true, ["sourceControl"]),
  primitive("git_fetch", "source_control", "Fetch remote Git refs.", true, ["sourceControl"]),
  primitive("git_branch", "source_control", "List, create, or delete local branches.", true, ["sourceControl"]),
  primitive("git_checkout", "source_control", "Switch local Git branches.", true, ["sourceControl"]),

  primitive("github_status", "source_control", "Inspect connected GitHub account state.", false, ["sourceControl"]),
  primitive("github_list_repositories", "source_control", "List GitHub repositories.", false, ["sourceControl"]),
  primitive("github_get_repository", "source_control", "Inspect a GitHub repository.", false, ["sourceControl"]),
  primitive("github_list_branches", "source_control", "List GitHub repository branches.", false, ["sourceControl"]),
  primitive("github_list_tree", "source_control", "List a GitHub repository tree.", false, ["sourceControl"]),
  primitive("github_read_file", "source_control", "Read a GitHub repository file.", false, ["sourceControl"]),
  primitive("github_search_code", "source_control", "Search GitHub code.", false, ["sourceControl"]),
  primitive("github_generate_release_notes", "source_control", "Generate GitHub release notes.", false, ["sourceControl"]),
  primitive("github_list_releases", "source_control", "List GitHub releases.", false, ["sourceControl"]),
  primitive("github_list_workflows", "source_control", "List GitHub Actions workflows.", false, ["sourceControl"]),
  primitive("github_list_workflow_runs", "source_control", "List GitHub Actions workflow runs.", false, ["sourceControl"]),
  primitive("github_create_branch", "source_control", "Create a GitHub branch.", true, ["sourceControl"]),
  primitive("github_commit_files", "source_control", "Commit files through the GitHub API.", true, ["sourceControl"]),
  primitive("github_create_pull_request", "source_control", "Create a GitHub pull request.", true, ["sourceControl"]),
  primitive("github_create_release", "source_control", "Create a GitHub release.", true, ["sourceControl"]),
  primitive("github_dispatch_workflow", "source_control", "Dispatch a GitHub Actions workflow.", true, ["sourceControl"]),

  primitive("mcp_list_servers", "mcp", "List configured MCP servers.", false, ["mcpServers"]),
  primitive("mcp_list_tools", "mcp", "List tools exposed by configured MCP servers.", false, ["mcpServers"]),
  primitive("mcp_call_tool", "mcp", "Call an MCP server tool.", true, ["mcpServers"]),
  primitive("mcp_set_server", "mcp", "Create or update an MCP server profile.", true, ["mcpServers"]),
  primitive("mcp_remove_server", "mcp", "Remove an MCP server profile.", true, ["mcpServers"]),

  primitive("run_subagents", "subagent", "Delegate bounded work to sub-agents when available.", false, ["workflowAutomation"]),
];

export const WORKFLOW_PRIMITIVE_REGISTRY = new Map<LocalComputerToolName, WorkflowPrimitiveDefinition>(
  WORKFLOW_PRIMITIVES.map((entry) => [entry.tool, entry]),
);

export function getWorkflowPrimitive(tool: LocalComputerToolName) {
  return WORKFLOW_PRIMITIVE_REGISTRY.get(tool);
}

export function isWorkflowPrimitiveTool(tool: LocalComputerToolName) {
  return WORKFLOW_PRIMITIVE_REGISTRY.has(tool);
}

export function listWorkflowPrimitiveNames() {
  return [...WORKFLOW_PRIMITIVE_REGISTRY.keys()];
}
