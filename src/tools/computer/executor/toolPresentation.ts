import { firstArg, limitInlineValue } from "./argHelpers";
import { MAX_TOOL_INPUT_PREVIEW_CHARS } from "./policy";
import { isLocalGitToolName } from "./toolNames";
import type { LocalComputerToolName, ParsedLocalComputerToolCall } from "./types";
export function formatToolName(tool: LocalComputerToolName) {
  const names = {
    build_index: "Build local index",
    browser_automation: "Browser automation",
    create_code_file: "Create code file",
    create_files: "Create files",
    create_html_file: "Create HTML file",
    create_markdown_file: "Create Markdown file",
    create_react_file: "Create React file",
    create_text_file: "Create text file",
    create_tool: "Create custom tool",
    create_vite_project: "Create Vite project",
    delete_file: "Delete file",
    edit_file: "Edit file",
    edit_files: "Edit files",
    list_directory: "List directory",
    lookup_color: "Color lookup",
    mcp_call_tool: "MCP call tool",
    mcp_list_servers: "MCP list servers",
    mcp_list_tools: "MCP list tools",
    mcp_remove_server: "MCP remove server",
    mcp_set_server: "MCP add/update server",
    move_path: "Move path",
    open_browser_preview: "Open browser preview",
    read_file: "Read file",
    rename_path: "Rename path",
    run_subagents: "Run sub-agents",
    run_terminal: "Run terminal command",
    run_tool: "Run custom tool",
    recall_context: "Recall context",
    search_files: "Search files",
    unknown: "Unknown tool",
    view_code: "View code",
    weather: "Weather",
    web_search: "Web search",
    workflow_run: "Run workflow",
    write_file: "Write file",
    git_branch: "Git branch",
    git_checkout: "Git checkout",
    git_commit: "Git commit",
    git_diff: "Git diff",
    git_fetch: "Git fetch",
    git_init: "Git init",
    git_log: "Git log",
    git_pull: "Git pull",
    git_push: "Git push",
    git_stage: "Git stage",
    git_status: "Git status",
    git_unstage: "Git unstage",
    github_commit_files: "GitHub commit files",
    github_create_branch: "GitHub create branch",
    github_create_pull_request: "GitHub create pull request",
    github_create_release: "GitHub create release",
    github_dispatch_workflow: "GitHub dispatch workflow",
    github_generate_release_notes: "GitHub release notes",
    github_get_repository: "GitHub repository",
    github_list_branches: "GitHub list branches",
    github_list_repositories: "GitHub list repositories",
    github_list_releases: "GitHub list releases",
    github_list_tree: "GitHub list tree",
    github_list_workflow_runs: "GitHub list workflow runs",
    github_list_workflows: "GitHub list workflows",
    github_read_file: "GitHub read file",
    github_search_code: "GitHub search code",
    github_status: "GitHub status",
  } satisfies Record<LocalComputerToolName, string>;

  return names[tool];
}

export function summarizeToolCall(call: ParsedLocalComputerToolCall) {
  const path = firstArg(call.args, ["project_path", "projectPath", "path", "from_path", "fromPath", "source_path", "source", "file_path", "directory_path", "folder_path", "file"]);
  const command = firstArg(call.args, ["command", "cmd", "input"]);
  const toolName = firstArg(call.args, ["tool_name", "name"]);
  const repository = firstArg(call.args, ["repository", "repo_full_name", "full_name"]);
  const owner = firstArg(call.args, ["owner", "org", "organization"]);
  const repo = firstArg(call.args, ["repo", "repository_name"]);
  const color = firstArg(call.args, ["color", "hex", "value"]);
  const query = firstArg(call.args, ["query", "q", "search", "text"]);
  const goal = firstArg(call.args, ["goal", "prompt", "task", "request"]);
  const workflowId = firstArg(call.args, ["workflow_id", "workflowId", "workflow", "id"]);
  const url = firstArg(call.args, ["url", "href", "address", "target", "page"]);
  const branch = firstArg(call.args, ["branch", "ref", "name", "new_branch", "newBranch"]);
  const message = firstArg(call.args, ["message", "commit_message", "commitMessage"]);

  if (path) {
    return path;
  }

  if (toolName) {
    return toolName;
  }

  if (repository) {
    return repository;
  }

  if (owner && repo) {
    return `${owner}/${repo}`;
  }

  if (isLocalGitToolName(call.tool)) {
    return [branch, message, path].filter(Boolean).join(" - ") || call.tool;
  }

  if (call.tool === "lookup_color" && color) {
    return color;
  }

  if (command) {
    return command;
  }

  if (query) {
    return query;
  }

  if (call.tool === "workflow_run") {
    return [workflowId, goal].filter(Boolean).join(" - ") || "workflow_run";
  }

  if (url) {
    return url;
  }

  return call.tool;
}

export function formatToolCallInput(call: ParsedLocalComputerToolCall) {
  const args = Object.entries(call.args)
    .map(([key, value]) => `${key}: ${limitInlineValue(value, MAX_TOOL_INPUT_PREVIEW_CHARS)}`)
    .join("\n");

  return args || call.raw;
}

export function limitToolCallOutput(content: string, maxChars: number | null) {
  if (maxChars === null || !Number.isFinite(maxChars) || content.length <= maxChars) {
    return content;
  }

  return `${content.slice(0, maxChars)}\n[Tool call output truncated.]`;
}
