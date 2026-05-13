import { normalizeToolRegistrySettings } from "../../../types/tools";
import type { ToolRegistrySettings } from "../../../types/tools";
import { isFileCreationToolName } from "../../fileCreation";
import { isGithubToolName } from "../../github";
import { executeBrowserAutomationHandler } from "./tools/browserAutomation";
import { executeColorHandler } from "./tools/color";
import { executeBuildIndexHandler } from "./tools/buildIndex";
import { executeCreateFilesHandler } from "./tools/createFiles";
import { executeCreateToolHandler } from "./tools/createTool";
import { executeCreateViteProjectHandler } from "./tools/createViteProject";
import { executeDeleteFileHandler } from "./tools/deleteFile";
import { executeEditFileHandler } from "./tools/editFile";
import { executeEditFilesHandler } from "./tools/editFiles";
import { executeGithubHandler } from "./tools/github";
import { executeListDirectoryHandler } from "./tools/listDirectory";
import { executeMcpHandler } from "./tools/mcp";
import { executeMovePathHandler } from "./tools/movePath";
import { executeOpenBrowserPreviewHandler } from "./tools/openBrowserPreview";
import { executeReadFileHandler } from "./tools/readFile";
import { executeRecallContextHandler } from "./tools/recallContext";
import { executeRenamePathHandler } from "./tools/renamePath";
import { executeRunTerminalHandler } from "./tools/runTerminal";
import { executeRunToolHandler } from "./tools/runTool";
import { executeSearchFilesHandler } from "./tools/searchFiles";
import { executeSubagentsHandler } from "./tools/subagents";
import { executeViewCodeHandler } from "./tools/viewCode";
import { executeWeatherHandler } from "./tools/weather";
import { executeWebSearchHandler } from "./tools/webSearch";
import { executeWorkflowRunHandler } from "./tools/workflowRun";
import { executeWriteFileHandler } from "./tools/writeFile";
import { executeGitBranchHandler } from "./tools/git/branch";
import { executeGitCheckoutHandler } from "./tools/git/checkout";
import { executeGitCommitHandler } from "./tools/git/commit";
import { executeGitDiffHandler } from "./tools/git/diff";
import { executeGitFetchHandler } from "./tools/git/fetch";
import { executeGitInitHandler } from "./tools/git/init";
import { executeGitLogHandler } from "./tools/git/log";
import { executeGitPullHandler } from "./tools/git/pull";
import { executeGitPushHandler } from "./tools/git/push";
import { executeGitStageHandler } from "./tools/git/stage";
import { executeGitStatusHandler } from "./tools/git/status";
import { executeGitUnstageHandler } from "./tools/git/unstage";
import { isLocalGitToolName } from "./toolNames";
import type { LocalComputerToolName, LocalToolHandler, ParsedLocalComputerToolCall, ToolHandlerContext } from "./types";

const GITHUB_HANDLER_TOOLS: LocalComputerToolName[] = [
  "github_status",
  "github_list_repositories",
  "github_get_repository",
  "github_list_branches",
  "github_list_tree",
  "github_read_file",
  "github_search_code",
  "github_create_branch",
  "github_commit_files",
  "github_create_pull_request",
  "github_generate_release_notes",
  "github_create_release",
  "github_list_releases",
  "github_list_workflows",
  "github_dispatch_workflow",
  "github_list_workflow_runs",
] as LocalComputerToolName[];

const SIMPLE_TOOL_HANDLERS = new Map<LocalComputerToolName, LocalToolHandler>([
  ["web_search", executeWebSearchHandler],
  ["workflow_run", executeWorkflowRunHandler],
  ["weather", executeWeatherHandler],
  ["browser_automation", executeBrowserAutomationHandler],
  ["lookup_color", executeColorHandler],
  ["run_subagents", executeSubagentsHandler],
  ["create_tool", executeCreateToolHandler],
  ["create_code_file", executeCreateFilesHandler],
  ["create_files", executeCreateFilesHandler],
  ["create_html_file", executeCreateFilesHandler],
  ["create_markdown_file", executeCreateFilesHandler],
  ["create_react_file", executeCreateFilesHandler],
  ["create_text_file", executeCreateFilesHandler],
  ["create_vite_project", executeCreateViteProjectHandler],
  ["delete_file", executeDeleteFileHandler],
  ["edit_file", executeEditFileHandler],
  ["edit_files", executeEditFilesHandler],
  ["git_branch", executeGitBranchHandler],
  ["git_checkout", executeGitCheckoutHandler],
  ["git_commit", executeGitCommitHandler],
  ["git_diff", executeGitDiffHandler],
  ["git_fetch", executeGitFetchHandler],
  ["git_init", executeGitInitHandler],
  ["git_log", executeGitLogHandler],
  ["git_pull", executeGitPullHandler],
  ["git_push", executeGitPushHandler],
  ["git_stage", executeGitStageHandler],
  ["git_status", executeGitStatusHandler],
  ["git_unstage", executeGitUnstageHandler],
  ["move_path", executeMovePathHandler],
  ["open_browser_preview", executeOpenBrowserPreviewHandler],
  ["rename_path", executeRenamePathHandler],
  ["write_file", executeWriteFileHandler],
  ["build_index", executeBuildIndexHandler],
  ["list_directory", executeListDirectoryHandler],
  ["mcp_call_tool", executeMcpHandler],
  ["mcp_list_servers", executeMcpHandler],
  ["mcp_list_tools", executeMcpHandler],
  ["mcp_remove_server", executeMcpHandler],
  ["mcp_set_server", executeMcpHandler],
  ["read_file", executeReadFileHandler],
  ["view_code", executeViewCodeHandler],
  ["run_terminal", executeRunTerminalHandler],
  ["run_tool", executeRunToolHandler],
  ["search_files", executeSearchFilesHandler],
  ["recall_context", executeRecallContextHandler],
  ...GITHUB_HANDLER_TOOLS.map((tool) => [tool, executeGithubHandler] as [LocalComputerToolName, LocalToolHandler]),
]);

export async function executeRegisteredTool(call: ParsedLocalComputerToolCall, context: ToolHandlerContext) {
  const handler = SIMPLE_TOOL_HANDLERS.get(call.tool);
  return handler ? await handler(call, context) : undefined;
}

export function hasRegisteredToolHandler(tool: LocalComputerToolName) {
  return SIMPLE_TOOL_HANDLERS.has(tool);
}

export function getDisabledToolReason(tool: LocalComputerToolName, settings: ToolRegistrySettings) {
  const tools = normalizeToolRegistrySettings(settings);

  if (tool === "web_search" && !tools.webSearch) {
    return "web_search is disabled in Toolbox.";
  }

  if (tool === "weather" && !tools.weatherTools) {
    return "weather is disabled in Toolbox.";
  }

  if (tool === "workflow_run" && !tools.workflowAutomation) {
    return "workflow automation is disabled in Toolbox.";
  }

  if (isGithubToolName(tool) && !tools.sourceControl) {
    return "GitHub source control is disabled in Toolbox.";
  }

  if (isLocalGitToolName(tool) && !tools.sourceControl) {
    return "Git source control is disabled in Toolbox.";
  }

  if (tool === "lookup_color" && !tools.colorTools) {
    return "color lookup is disabled in Toolbox.";
  }

  if ((tool === "run_terminal" || tool === "run_tool") && !tools.terminal) {
    return "terminal is disabled in Toolbox.";
  }

  if ((tool === "open_browser_preview" || tool === "browser_automation") && !tools.browserPreview) {
    return "browser preview is disabled in Toolbox.";
  }

  if ((isFileCreationToolName(tool) || tool === "create_vite_project") && !tools.fileCreation) {
    return "file creation is disabled in Toolbox.";
  }

  if (tool === "delete_file" && !tools.fileSafety) {
    return "file safety tools are disabled in Toolbox.";
  }

  if (tool === "create_tool" && (!tools.terminal || !tools.codeEdit)) {
    return "custom tool creation needs Terminal and Code Editor enabled in Toolbox.";
  }

  if ((tool === "recall_context" || tool === "search_files") && !tools.fileSearch) {
    return "file search is disabled in Toolbox.";
  }

  if ((tool === "build_index" || tool === "list_directory") && !tools.fileBrowser) {
    return "local file browsing is disabled in Toolbox.";
  }

  if ((tool === "read_file" || tool === "view_code") && !tools.codeView) {
    return "code viewing is disabled in Toolbox.";
  }

  if ((tool === "edit_file" || tool === "edit_files" || tool === "write_file" || tool === "move_path" || tool === "rename_path") && !tools.codeEdit) {
    return "code editing is disabled in Toolbox.";
  }

  if (
    (tool === "mcp_list_servers" || tool === "mcp_list_tools" || tool === "mcp_call_tool" || tool === "mcp_set_server" || tool === "mcp_remove_server")
    && !tools.mcpServers
  ) {
    return "MCP servers are disabled in Toolbox.";
  }

  return null;
}
