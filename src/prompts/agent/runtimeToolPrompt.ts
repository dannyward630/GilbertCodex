import { isDeepResearchThinking } from "../../types/settings";
import { normalizeToolRegistrySettings } from "../../types/tools";
import { describeCodingTools } from "../../tools/coding";
import { describeColorTools } from "../../tools/color";
import { describeFileCreationTools } from "../../tools/fileCreation";
import type { ProviderSettings } from "../../types/settings";
import { createGithubRuntimeToolInstructions } from "./githubToolPrompt";

export interface RuntimeToolPromptInput {
  hasLocalComputerContext: boolean;
  hasWebContext: boolean;
  latestUserPrompt: string;
  selectedChunkIds: Set<string>;
  settings: ProviderSettings;
}

export function createRuntimeToolPrompt({ hasLocalComputerContext, hasWebContext, latestUserPrompt, selectedChunkIds, settings }: RuntimeToolPromptInput) {
  const tools = normalizeToolRegistrySettings(settings.tools);
  const localTools = createLocalToolNames(settings);
  const enabledTools = [tools.webSearch ? "web_search" : "", ...localTools].filter(Boolean);

  if (enabledTools.length === 0) {
    return "Runtime tool calling is disabled in Toolbox. Answer from the provided conversation and context only.";
  }

  const sections = [
    "Runtime tools are available through compact tool_call blocks. Use them when they materially improve correctness, especially for bug fixing, code edits, current facts, official docs, changelogs, APIs, command evidence, color accuracy, design data, or source-backed answers.",
    `Enabled runtime tools: ${enabledTools.join(", ")}.`,
    isDeepResearchThinking(settings.thinking)
      ? "Deep Research mode is active. The app can run many focused web_search and local tool calls in batches. Avoid repeated equivalent searches, gather enough evidence to act, then synthesize instead of asking for tools forever."
      : "Standard thinking mode should use the fewest focused tool calls that can answer correctly, then synthesize from the results.",
    tools.webSearch
      ? "web_search is available on demand for current facts, official docs, provider/model data, package behavior, API behavior, source-backed claims, and external design data. After WEB TOOL RESULTS arrive, use those results directly instead of repeating the same search."
      : "web_search is disabled in Toolbox.",
    localTools.length > 0 ? `Runtime action tools enabled: ${localTools.join(", ")}.` : "Local workspace and source-control tools are disabled in Toolbox.",
    tools.sourceControl
      ? createGithubRuntimeToolInstructions(latestUserPrompt)
      : "",
    tools.sourceControl ? "" : "GitHub source-control tools are disabled in Toolbox.",
    hasWebContext
      ? "A web-search context or web_search result is present. Treat it as live web evidence. Cite supported claims with Markdown links using only listed URLs. If results are insufficient, say that instead of filling gaps from memory."
      : "",
    hasLocalComputerContext
      ? [
          "A local computer file tool context is present. Treat it as real filesystem access supplied by the app.",
          "When AGENT TOOL RESULTS or LOCAL COMPUTER TOOL RESULTS are present, produce a normal final answer from those results instead of replying only that you will inspect more files.",
        ].join("\n")
      : "",
    selectedChunkIds.has("tool.file-creation") && tools.fileCreation ? describeFileCreationTools() : "",
    selectedChunkIds.has("skill.frontend-product-quality") && tools.colorTools ? describeColorTools() : "",
    selectedChunkIds.has("skill.coding-agent-workflow") ? describeCodingTools() : "",
    tools.fileSearch ? "Use recall_context for architecture notes or previous project instructions. Prefer search_files before guessing file names or locations." : "",
    tools.codeView ? "Prefer view_code with start_line/end_line or start_char/end_char before precise edits." : "",
    tools.codeEdit
      ? "edit_file supports exact replacement, line-range replacement, line inserts, and character edits. Include expected_text for targeted edits when possible so stale edits are refused instead of guessed."
      : "",
    tools.fileCreation ? "Use create_files for multi-file batches with files_json instead of emitting many separate write_file calls." : "",
    tools.terminal
      ? "run_terminal executes the local platform shell inside an enabled local workspace root: PowerShell/cmd on Windows, or Bash/Zsh/sh on macOS and Linux. Use it for tests, builds, package installs, formatters, setup checks, and command evidence. Set cwd instead of prepending cd/chdir."
      : "",
    tools.terminal
      ? "Do not use terminal here-strings, Set-Content, Out-File, redirection, or replacement scripts for source edits while edit_file/write_file/create_files are enabled."
      : "",
    tools.browserPreview ? "open_browser_preview opens an HTTP(S) URL in the in-app browser preview. Use it after starting a dev server or when visual verification matters." : "",
    tools.terminal && tools.codeEdit
      ? "create_tool can write a reusable platform shell script under .gilbert/tools in the workspace; run_tool executes it. Use this only when a reusable helper materially helps."
      : "",
    createRelevantToolExamples(settings, latestUserPrompt),
    "After tool results arrive, continue from the evidence and do not print raw tool calls.",
    "Visible answers should be normal Markdown: concise headings, bullets or numbered lists, Markdown links, and fenced code blocks for code, logs, diffs, or command output.",
  ].filter(Boolean);

  return sections.join("\n");
}

export function createLocalToolNames(settings: ProviderSettings) {
  const tools = normalizeToolRegistrySettings(settings.tools);

  return [
    tools.fileSearch ? "recall_context" : "",
    tools.fileSearch ? "search_files" : "",
    tools.codeView ? "view_code" : "",
    tools.codeView ? "read_file" : "",
    tools.fileBrowser ? "list_directory" : "",
    tools.fileBrowser ? "build_index" : "",
    tools.codeEdit ? "edit_file" : "",
    tools.codeEdit ? "write_file" : "",
    tools.fileCreation ? "create_text_file" : "",
    tools.fileCreation ? "create_markdown_file" : "",
    tools.fileCreation ? "create_code_file" : "",
    tools.fileCreation ? "create_react_file" : "",
    tools.fileCreation ? "create_html_file" : "",
    tools.fileCreation ? "create_pdf_file" : "",
    tools.fileCreation ? "create_files" : "",
    tools.fileSafety ? "delete_file" : "",
    tools.fileSafety ? "check_duplicate_file" : "",
    tools.fileSafety ? "prevent_duplicate_file_create" : "",
    tools.pdfTools ? "create_chat_pdf" : "",
    tools.codeEdit ? "inline_edit" : "",
    tools.colorTools ? "lookup_color" : "",
    tools.vectorTools ? "vector_embed_text" : "",
    tools.vectorTools ? "vector_search" : "",
    tools.testingTools ? "run_tests" : "",
    tools.testingTools ? "create_unit_test" : "",
    tools.typescriptTools ? "typescript_check" : "",
    tools.sqlTools ? "create_sql_schema" : "",
    tools.sqlTools ? "create_sql_migration" : "",
    tools.reactNativeTools ? "create_react_native_screen" : "",
    tools.reactNativeTools ? "react_native_setup_check" : "",
    tools.codeGeneration ? "codebase_health_scan" : "",
    tools.codeGeneration ? "dependency_audit" : "",
    tools.codeGeneration ? "create_api_route" : "",
    tools.sourceControl ? "github_status" : "",
    tools.sourceControl ? "github_list_repositories" : "",
    tools.sourceControl ? "github_get_repository" : "",
    tools.sourceControl ? "github_list_branches" : "",
    tools.sourceControl ? "github_list_tree" : "",
    tools.sourceControl ? "github_read_file" : "",
    tools.sourceControl ? "github_search_code" : "",
    tools.sourceControl ? "github_create_branch" : "",
    tools.sourceControl ? "github_commit_files" : "",
    tools.sourceControl ? "github_create_pull_request" : "",
    tools.terminal ? "run_terminal" : "",
    tools.browserPreview ? "open_browser_preview" : "",
    tools.terminal && tools.codeEdit ? "create_tool" : "",
    tools.terminal ? "run_tool" : "",
  ].filter(Boolean);
}

function createRelevantToolExamples(settings: ProviderSettings, latestUserPrompt: string) {
  const tools = normalizeToolRegistrySettings(settings.tools);
  const examples: string[] = [];

  if (tools.webSearch && /\b(web|search|research|latest|current|official|docs?|source|cite|api|model|provider)\b/i.test(latestUserPrompt)) {
    examples.push("web_search example:\n<tool_call>\nweb_search\n<arg_key>query</arg_key><arg_value>official docs query</arg_value>\n</tool_call>");
  }

  if (tools.sourceControl && /\b(github|repo|repository|branch|commit|push|pull|pr|pull request|source control)\b/i.test(latestUserPrompt)) {
    examples.push("github_list_tree example:\n<tool_call>\ngithub_list_tree\n<arg_key>repo</arg_key><arg_value>repo-name-if-owner-unknown</arg_value>\n<arg_key>recursive</arg_key><arg_value>true</arg_value>\n<arg_key>limit</arg_key><arg_value>500</arg_value>\n</tool_call>");
    examples.push("github_read_file example:\n<tool_call>\ngithub_read_file\n<arg_key>repository</arg_key><arg_value>owner/repo</arg_value>\n<arg_key>path</arg_key><arg_value>README.md</arg_value>\n</tool_call>");
    examples.push("github_commit_files example:\n<tool_call>\ngithub_commit_files\n<arg_key>repository</arg_key><arg_value>owner/repo</arg_value>\n<arg_key>branch</arg_key><arg_value>codex/my-change</arg_value>\n<arg_key>message</arg_key><arg_value>feat: update docs</arg_value>\n<arg_key>files_json</arg_key><arg_value>[{\"path\":\"README.md\",\"content\":\"...\"}]</arg_value>\n</tool_call>");
  }

  if (tools.terminal && /\b(test|build|check|install|run|command|terminal|server|dev)\b/i.test(latestUserPrompt)) {
    examples.push("run_terminal example:\n<tool_call>\nrun_terminal\n<arg_key>command</arg_key><arg_value>npm run build</arg_value>\n<arg_key>cwd</arg_key><arg_value>C:\\path\\to\\project</arg_value>\n</tool_call>");
  }

  if (tools.browserPreview && /\b(browser|preview|visual|localhost|screen|ui)\b/i.test(latestUserPrompt)) {
    examples.push("open_browser_preview example:\n<tool_call>\nopen_browser_preview\n<arg_key>url</arg_key><arg_value>http://localhost:5173/</arg_value>\n</tool_call>");
  }

  if (tools.colorTools && /\b(color|colour|palette|css|brand|hex)\b/i.test(latestUserPrompt)) {
    examples.push("lookup_color example:\n<tool_call>\nlookup_color\n<arg_key>color</arg_key><arg_value>rebeccapurple</arg_value>\n</tool_call>");
  }

  return examples.join("\n\n");
}
