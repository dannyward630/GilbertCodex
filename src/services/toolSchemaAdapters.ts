/**
 * Native-function-calling schema registry + provider-specific adapters.
 *
 * The model client passes `tools` to providers that support native function
 * calling. When a tool isn't in this registry (or the provider/model doesn't
 * support native tools), the existing XML-prompt path takes over — both
 * paths funnel into the same `parseLocalComputerToolCalls` downstream.
 *
 * Schemas are hand-rolled JSON Schema 7. No ajv/zod dep — we have ~25 tools
 * and the shapes are flat (`type: "string|integer|boolean"`, no `$ref`s).
 */

import type { ProviderSettings } from "../types/settings";
import { isOpenRouterFreeModel } from "../lib/models";
import { openRouterModelHasReliableNativeTools } from "./openRouterRouting";
import { normalizeToolRegistrySettings } from "../types/tools";

export type JsonSchemaScalar = "string" | "integer" | "number" | "boolean";
export type JsonSchemaType = JsonSchemaScalar | "object" | "array";

export interface JsonSchemaProperty {
  description?: string;
  enum?: Array<string | number>;
  items?: JsonSchemaProperty;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  type: JsonSchemaType;
}

export interface JsonSchemaObject {
  additionalProperties?: boolean;
  description?: string;
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
  type: "object";
}

export interface ToolSchemaEntry {
  description: string;
  name: string;
  parameters: JsonSchemaObject;
}

export interface AnthropicTool {
  description: string;
  input_schema: JsonSchemaObject;
  name: string;
}

export interface OpenAITool {
  function: {
    description: string;
    name: string;
    parameters: JsonSchemaObject;
  };
  type: "function";
}

export interface OpenAIResponsesFunctionTool {
  description: string;
  name: string;
  parameters: JsonSchemaObject;
  type: "function";
}

const PATH_PROP: JsonSchemaProperty = {
  description: "Absolute or workspace-relative path to the target file or folder.",
  type: "string",
};

const GIT_PATHS_PROP: JsonSchemaProperty = {
  description: "Workspace-relative pathspecs to stage, unstage, or diff.",
  items: { type: "string" },
  type: "array",
};

function obj(properties: Record<string, JsonSchemaProperty>, required: string[] = []): JsonSchemaObject {
  return {
    additionalProperties: true,
    properties,
    required,
    type: "object",
  };
}

/**
 * The full set of tools we expose natively. Tools not in this map still
 * work — they fall back to the XML-prompt path. Adding a tool here is a
 * pure improvement (cheap models will use the structured call).
 */
const LOCAL_TOOL_SCHEMAS: Record<string, ToolSchemaEntry> = {
  web_search: {
    description:
      "Search the web for current facts, official docs, package behavior, error messages, or external sources. Use only when local files cannot answer.",
    name: "web_search",
    parameters: obj(
      {
        max_results: {
          description: "Maximum number of results to return. Default 8.",
          type: "integer",
        },
        query: {
          description: "Natural-language search query.",
          type: "string",
        },
      },
      ["query"],
    ),
  },
  lookup_color: {
    description:
      "Look up a color by name or hex from the local color database. Returns RGB/HSL, aliases, and nearest named colors.",
    name: "lookup_color",
    parameters: obj({
      hex: { description: "Hex color code, e.g. \"#ff8800\".", type: "string" },
      name: { description: "Color name, e.g. \"crimson\" or \"slate gray\".", type: "string" },
      rgb: { description: "RGB string, e.g. \"255, 136, 0\".", type: "string" },
    }),
  },
  view_code: {
    description:
      "Read exact code/text from one file and return a sha256 guard for full reads. Omit line/window arguments to return the whole file; use start_line/end_line or offset+limit only when you intentionally want a window.",
    name: "view_code",
    parameters: obj(
      {
        count: { description: "Alias for limit: number of lines to show from start_line/offset.", type: "integer" },
        end_char: { description: "Inclusive end character index (UTF-16 code units).", type: "integer" },
        end_line: { description: "Inclusive end line number (1-based).", type: "integer" },
        from: { description: "Alias for start_line. Use 1 for the first line.", type: "integer" },
        limit: { description: "Number of lines to show from start_line/offset. Omit for the rest of the file.", type: "integer" },
        max_lines: { description: "Alias for limit.", type: "integer" },
        lines: { description: "Alias for limit.", type: "integer" },
        mode: {
          description: "View shape: \"lines\" (default), \"characters\", or \"words\".",
          enum: ["lines", "characters", "words"],
          type: "string",
        },
        offset: { description: "1-based line offset alias for start_line. offset=260 starts at line 260.", type: "integer" },
        path: PATH_PROP,
        skip: { description: "Alias for start_line/offset.", type: "integer" },
        start_char: { description: "Start character index (UTF-16 code units, 0-based).", type: "integer" },
        start_line: { description: "Start line number (1-based).", type: "integer" },
      },
      ["path"],
    ),
  },
  read_file: {
    description: "Read a file's full contents by default and return a sha256 guard for full reads. max_bytes/start_line/end_line/offset/limit are explicit narrowing controls only.",
    name: "read_file",
    parameters: obj(
      {
        count: { description: "Alias for limit when requesting a line window.", type: "integer" },
        end_line: { description: "Inclusive end line number (1-based) when requesting a line window.", type: "integer" },
        from: { description: "Alias for start_line/offset.", type: "integer" },
        limit: { description: "Number of lines to return from start_line/offset. Omit for the full file.", type: "integer" },
        max_bytes: { description: "Optional explicit cap on bytes read. Omit to read the whole text file.", type: "integer" },
        max_lines: { description: "Alias for limit.", type: "integer" },
        offset: { description: "1-based line offset alias for start_line. offset=260 starts at line 260.", type: "integer" },
        path: PATH_PROP,
        skip: { description: "Alias for start_line/offset.", type: "integer" },
        start_line: { description: "Start line number (1-based) when requesting a line window.", type: "integer" },
      },
      ["path"],
    ),
  },
  list_directory: {
    description: "List every file and folder inside a workspace directory by default. limit is an explicit narrowing control only.",
    name: "list_directory",
    parameters: obj({
      limit: { description: "Optional maximum entries to return. Omit to return all readable entries.", type: "integer" },
      path: { description: "Workspace-relative or absolute directory path. Defaults to the workspace root.", type: "string" },
    }),
  },
  search_files: {
    description: "Search the workspace file index by name or content keywords. In full-computer scope, pass directory_path/root for a specific folder; Gilbert will not search or index whole drives automatically.",
    name: "search_files",
    parameters: obj(
      {
        directory_path: { description: "Optional focused directory/root to search, especially in full-computer scope.", type: "string" },
        folder_path: { description: "Alias for directory_path.", type: "string" },
        limit: { description: "Optional maximum results to return. Omit to return every indexed match.", type: "integer" },
        query: { description: "Search query (substrings, symbol names, or natural language).", type: "string" },
        root: { description: "Alias for directory_path.", type: "string" },
      },
      ["query"],
    ),
  },
  recall_context: {
    description: "Recall project memory + index entries relevant to the query. In full-computer scope, pass directory_path/root for a specific folder; Gilbert will not search or index whole drives automatically.",
    name: "recall_context",
    parameters: obj({
      directory_path: { description: "Optional focused directory/root to recall from, especially in full-computer scope.", type: "string" },
      folder_path: { description: "Alias for directory_path.", type: "string" },
      limit: { description: "Optional maximum results to return. Omit to return every indexed match plus relevant project memory.", type: "integer" },
      query: { description: "Search query. Defaults to the latest user prompt.", type: "string" },
      root: { description: "Alias for directory_path.", type: "string" },
    }),
  },
  build_index: {
    description: "Rebuild the local workspace file index. Use when the index is empty or stale.",
    name: "build_index",
    parameters: obj({}),
  },
  edit_file: {
    description:
      "Edit an existing file with a precise replacement, whitespace-aware multi-line replacement, line insert/range, or character range. Use this for normal changes to existing files. Provide old_text/new_text OR start_line/end_line/content OR insert_at_line/content OR start_char/end_char/content.",
    name: "edit_file",
    parameters: obj(
      {
        content: { description: "New content for a line- or character-range replacement.", type: "string" },
        end_char: { description: "Exclusive end character index for character-range edits.", type: "integer" },
        end_line: { description: "Inclusive end line number for line-range edits.", type: "integer" },
        expected_replacements: {
          description: "Number of matches you expect old_text to have. Edit refuses if the count differs.",
          type: "integer",
        },
        expected_text: {
          description: "Current text in the targeted range. Line-range edits tolerate whitespace-only drift but refuse semantic differences.",
          type: "string",
        },
        insert_at_line: {
          description: "Insert content before this line number, leaving surrounding lines untouched.",
          type: "integer",
        },
        insert_line: {
          description: "Anthropic-style insert alias: insert after this 1-based line number, or 0 for the start of file.",
          type: "integer",
        },
        new_str: { description: "Alias for new_text.", type: "string" },
        new_text: { description: "Replacement text for old_text-style edits.", type: "string" },
        occurrence: {
          description: "1-based occurrence to replace when old_text appears multiple times.",
          type: "integer",
        },
        old_str: { description: "Alias for old_text.", type: "string" },
        old_text: { description: "Text to find. Exact matches are used first; unique multi-line whitespace-only drift can be recovered safely.", type: "string" },
        path: PATH_PROP,
        replace_all: { description: "Replace every occurrence of old_text.", type: "boolean" },
        start_char: { description: "Start character index for character-range edits.", type: "integer" },
        start_line: { description: "Start line number for line-range edits.", type: "integer" },
      },
      ["path"],
    ),
  },
  inline_edit: {
    description: "Alias for edit_file. Performs the same surgical edit, including unique multi-line whitespace-drift recovery.",
    name: "inline_edit",
    parameters: obj(
      {
        content: { type: "string" },
        end_char: { type: "integer" },
        end_line: { type: "integer" },
        expected_replacements: { type: "integer" },
        expected_text: { type: "string" },
        insert_at_line: { type: "integer" },
        insert_line: { type: "integer" },
        new_str: { type: "string" },
        new_text: { type: "string" },
        occurrence: { type: "integer" },
        old_str: { type: "string" },
        old_text: { type: "string" },
        path: PATH_PROP,
        replace_all: { type: "boolean" },
        start_char: { type: "integer" },
        start_line: { type: "integer" },
      },
      ["path"],
    ),
  },
  write_file: {
    description:
      "Create a new single file. Existing files are refused unless this is an intentional whole-file replacement with replace_entire_file=true and expected_sha256 from a fresh read_file/view_code result. Prefer edit_file for existing files.",
    name: "write_file",
    parameters: obj(
      {
        content: { description: "Full file contents.", type: "string" },
        create_parent_dirs: { description: "Create missing parent directories. Default true.", type: "boolean" },
        expected_sha256: { description: "Required for replacing an existing file: sha256 returned by the latest full read_file/view_code of that file.", type: "string" },
        overwrite: { description: "Overwrite an existing file. Default true.", type: "boolean" },
        path: PATH_PROP,
        replace_entire_file: { description: "Set true only when intentionally replacing the whole current file. Normal edits must use edit_file instead.", type: "boolean" },
      },
      ["path", "content"],
    ),
  },
  delete_file: {
    description: "Delete a file. Refuses directories. Cannot be undone.",
    name: "delete_file",
    parameters: obj({ path: PATH_PROP }, ["path"]),
  },
  move_path: {
    description: "Move or rename a file or folder inside the enabled workspace roots. Destination must not already exist.",
    name: "move_path",
    parameters: obj(
      {
        create_parent_dirs: { description: "Create missing destination parent folders. Default true.", type: "boolean" },
        from_path: { description: "Current file or folder path, absolute or workspace-relative.", type: "string" },
        to_path: { description: "Destination file or folder path, absolute or workspace-relative.", type: "string" },
      },
      ["from_path", "to_path"],
    ),
  },
  rename_path: {
    description: "Rename a file or folder inside its current parent directory.",
    name: "rename_path",
    parameters: obj(
      {
        new_name: { description: "New file or folder name only, not a full path.", type: "string" },
        path: PATH_PROP,
      },
      ["path", "new_name"],
    ),
  },
  create_pdf_file: {
    description:
      "Create a clean PDF file from Markdown content. Headings/lists/tables/code render as document structure; avoid decorative divider spam. In regular chat with no selected workspace, omit path to return a downloadable chat artifact.",
    name: "create_pdf_file",
    parameters: obj(
      {
        content: { description: "Markdown-like content to render into the PDF.", type: "string" },
        duplicate_strategy: { description: "When the target exists: fail, increment, or skip. Default fail; regular-chat PDF fallback defaults to increment.", type: "string" },
        markdown: { description: "Alternative Markdown content field. Use semantic Markdown headings and lists instead of decorative separators.", type: "string" },
        overwrite: { description: "Whether an existing file may be overwritten. Default false.", type: "boolean" },
        path: PATH_PROP,
        title: { description: "Document title and default filename stem when path is omitted.", type: "string" },
      },
    ),
  },
  create_chat_pdf: {
    description:
      "Export chat, notes, or Markdown-backed content as a clean PDF. Works in regular chat without a selected workspace by returning a downloadable chat artifact.",
    name: "create_chat_pdf",
    parameters: obj(
      {
        content: { description: "Chat transcript, notes, or Markdown-like body to render.", type: "string" },
        duplicate_strategy: { description: "When the target exists: fail, increment, or skip. Default increment when path is omitted.", type: "string" },
        overwrite: { description: "Whether an existing file may be overwritten. Default false.", type: "boolean" },
        path: PATH_PROP,
        title: { description: "PDF title and default filename stem when path is omitted.", type: "string" },
      },
    ),
  },
  list_pdfs: {
    description:
      "List PDFs saved in the app PDF library, including uploaded PDFs and AI-generated PDFs. Use before reading or editing a PDF by id.",
    name: "list_pdfs",
    parameters: obj({
      all: { description: "When true, include PDFs that are not enabled as context. Default true.", type: "boolean" },
      include_disabled: { description: "When true, include PDFs that are not enabled as context. Default true.", type: "boolean" },
      project: { description: "Optional project name to filter by.", type: "string" },
    }),
  },
  read_pdf: {
    description:
      "Read PDF library metadata, guidance, and editable/source text when available. Use id from list_pdfs when possible.",
    name: "read_pdf",
    parameters: obj({
      id: { description: "PDF library id from list_pdfs.", type: "string" },
      title: { description: "PDF title or filename fallback when id is unknown.", type: "string" },
    }),
  },
  edit_pdf_text: {
    description:
      "Edit a source-backed PDF in the app library by exact text replacement, then regenerate the downloadable PDF. Supports single-letter and punctuation edits. Refuses uploaded PDFs that have no stored editable source text.",
    name: "edit_pdf_text",
    parameters: obj(
      {
        all: { description: "Replace every occurrence of search text.", type: "boolean" },
        expected_replacements: { description: "Refuse if the actual match count differs.", type: "integer" },
        id: { description: "PDF library id from list_pdfs.", type: "string" },
        occurrence: { description: "1-based occurrence to replace when search appears multiple times.", type: "integer" },
        replace: { description: "Replacement text. Empty string deletes the search text.", type: "string" },
        search: { description: "Exact text to find. Single letters and punctuation are allowed.", type: "string" },
        title: { description: "PDF title fallback when id is unknown.", type: "string" },
      },
      ["search"],
    ),
  },
  create_files: {
    description:
      "Create multiple new files in one call. files_json is a JSON array of {path, content, createParentDirs?, overwrite?} entries. Missing parent folders are created by default.",
    name: "create_files",
    parameters: obj(
      {
        files_json: {
          description: "JSON-encoded array of file specs.",
          type: "string",
        },
      },
      ["files_json"],
    ),
  },
  create_vite_project: {
    description:
      "Create a complete runnable Vite React project scaffold in one operation. Use this for new React/Vite apps instead of hand-writing package.json, index.html, src/main, src/App, and CSS one file at a time. Defaults to the selected workspace folder; pass project_path only when the user explicitly wants a child or different folder. Existing projects are preserved; use repair_missing=true only to fill missing starter files. After a new scaffold succeeds, run npm install, npm run build, and npm run dev from the returned project path.",
    name: "create_vite_project",
    parameters: obj(
      {
        author: { description: "Optional byline shown in the starter App component.", type: "string" },
        repair_missing: { description: "When true and package.json already exists, create only missing starter files and preserve every existing file. Default false.", type: "boolean" },
        project_name: { description: "Project/package name. Does not create a child folder when project_path is omitted.", type: "string" },
        project_path: { description: "Absolute or workspace-relative project folder to create. Omit this to scaffold directly in the selected workspace root. Required when using Full computer scope.", type: "string" },
        subtitle: { description: "Optional starter subtitle text.", type: "string" },
        title: { description: "Optional starter heading text.", type: "string" },
        variant: { description: "react/javascript/js for JavaScript or react-ts/typescript/ts for TypeScript. Default react.", enum: ["react", "react-ts", "javascript", "typescript", "js", "ts"], type: "string" },
      },
    ),
  },
  run_terminal: {
    description:
      "Run a command in the workspace shell. Long-running dev servers, watchers, and hot-reloaders are managed as background terminal sessions and return a live session plus any detected localhost URL.",
    name: "run_terminal",
    parameters: obj(
      {
        background: { description: "Run as a managed background session. Dev servers/watchers are auto-backgrounded even when this is omitted.", type: "boolean" },
        command: { description: "The command to run.", type: "string" },
        cwd: { description: "Working directory. Must be inside a workspace root.", type: "string" },
        host: { description: "Preferred host for managed dev servers. Defaults to localhost.", type: "string" },
        port: { description: "Preferred port for managed dev servers. If occupied, the runtime tries the next free port.", type: "integer" },
        shell: {
          description: "Override shell: pwsh / powershell / cmd / bash / zsh / sh.",
          enum: ["pwsh", "powershell", "cmd", "bash", "zsh", "sh"],
          type: "string",
        },
        timeout: { description: "Timeout in seconds. Use 300+ for installs.", type: "integer" },
      },
      ["command"],
    ),
  },
  run_tests: {
    description: "Run the project's test command. Optional command override.",
    name: "run_tests",
    parameters: obj({
      command: { description: "Optional explicit test command.", type: "string" },
      cwd: { description: "Working directory.", type: "string" },
    }),
  },
  typescript_check: {
    description: "Run the project's TypeScript typecheck command.",
    name: "typescript_check",
    parameters: obj({ cwd: { type: "string" } }),
  },
  git_status: {
    description: "Show the local git status (branch, staged, unstaged, untracked).",
    name: "git_status",
    parameters: obj({
      cwd: { description: "Working directory. Defaults to the selected workspace root.", type: "string" },
    }),
  },
  git_init: {
    description: "Initialize Git in a local workspace folder. Use this before status/stage/commit/push for a brand-new local project.",
    name: "git_init",
    parameters: obj({
      cwd: { description: "Working directory to initialize. Must be inside a workspace root.", type: "string" },
      initial_branch: { description: "Initial branch name. Defaults to main.", type: "string" },
    }),
  },
  git_diff: {
    description: "Show local git diff for the workspace. Defaults to full tracked patch plus untracked file text for exhaustive local change review.",
    name: "git_diff",
    parameters: obj({
      cwd: { description: "Working directory. Defaults to the selected workspace root.", type: "string" },
      include_untracked: { description: "Include untracked file names/text when showing the working-tree diff. Defaults true unless staged=true.", type: "boolean" },
      path: { description: "Optional path to limit the diff.", type: "string" },
      paths: GIT_PATHS_PROP,
      staged: { description: "Show the staged diff instead of the working tree.", type: "boolean" },
      stat: { description: "Show only the diff summary/stat. Leave false for exhaustive patch review.", type: "boolean" },
    }),
  },
  git_log: {
    description: "Show commits on the current branch. Omit limit for the full log; pass limit only when intentionally narrowing.",
    name: "git_log",
    parameters: obj({
      cwd: { description: "Working directory. Defaults to the selected workspace root.", type: "string" },
      limit: { description: "Optional maximum commits to return.", type: "integer" },
    }),
  },
  git_stage: {
    description: "Stage local workspace changes. Use paths for specific files or all=true for every change.",
    name: "git_stage",
    parameters: obj({
      all: { description: "Stage all tracked, modified, deleted, and untracked files.", type: "boolean" },
      cwd: { description: "Working directory. Defaults to the selected workspace root.", type: "string" },
      path: { description: "Single workspace-relative pathspec to stage.", type: "string" },
      paths: GIT_PATHS_PROP,
      paths_json: { description: "JSON-encoded array of pathspec strings.", type: "string" },
    }),
  },
  git_unstage: {
    description: "Unstage local workspace changes. Use paths for specific files or all=true for every staged change.",
    name: "git_unstage",
    parameters: obj({
      all: { description: "Unstage every staged file.", type: "boolean" },
      cwd: { description: "Working directory. Defaults to the selected workspace root.", type: "string" },
      path: { description: "Single workspace-relative pathspec to unstage.", type: "string" },
      paths: GIT_PATHS_PROP,
      paths_json: { description: "JSON-encoded array of pathspec strings.", type: "string" },
    }),
  },
  git_commit: {
    description: "Create a commit from already staged changes.",
    name: "git_commit",
    parameters: obj(
      {
        cwd: { description: "Working directory. Defaults to the selected workspace root.", type: "string" },
        message: { description: "Commit message.", type: "string" },
      },
      ["message"],
    ),
  },
  git_push: {
    description: "Push the current branch or an explicit branch to a remote.",
    name: "git_push",
    parameters: obj({
      branch: { description: "Branch to push.", type: "string" },
      cwd: { description: "Working directory. Defaults to the selected workspace root.", type: "string" },
      force_with_lease: { description: "Use --force-with-lease.", type: "boolean" },
      remote: { description: "Remote name. Defaults to origin when branch is set.", type: "string" },
      set_upstream: { description: "Use --set-upstream.", type: "boolean" },
    }),
  },
  git_pull: {
    description: "Pull from a remote and optional branch.",
    name: "git_pull",
    parameters: obj({
      branch: { description: "Branch to pull.", type: "string" },
      cwd: { description: "Working directory. Defaults to the selected workspace root.", type: "string" },
      rebase: { description: "Use --rebase.", type: "boolean" },
      remote: { description: "Remote name.", type: "string" },
    }),
  },
  git_fetch: {
    description: "Fetch remote refs.",
    name: "git_fetch",
    parameters: obj({
      cwd: { description: "Working directory. Defaults to the selected workspace root.", type: "string" },
      prune: { description: "Prune deleted remote refs. Defaults true.", type: "boolean" },
      remote: { description: "Remote name.", type: "string" },
    }),
  },
  git_branch: {
    description: "List, create, or delete local branches.",
    name: "git_branch",
    parameters: obj({
      base: { description: "Optional base branch when creating a branch.", type: "string" },
      create: { description: "Create the branch named by name/new_branch.", type: "boolean" },
      cwd: { description: "Working directory. Defaults to the selected workspace root.", type: "string" },
      delete: { description: "Delete the branch named by name/delete_branch.", type: "boolean" },
      delete_branch: { description: "Branch name to delete.", type: "string" },
      force: { description: "Force branch deletion with -D.", type: "boolean" },
      name: { description: "Branch name to create, delete, or filter in the list.", type: "string" },
      new_branch: { description: "Branch name to create.", type: "string" },
    }),
  },
  git_checkout: {
    description: "Switch branches using git switch. Use create=true to create and switch.",
    name: "git_checkout",
    parameters: obj({
      base: { description: "Optional base branch when create=true.", type: "string" },
      branch: { description: "Branch or ref to switch to.", type: "string" },
      create: { description: "Create the branch before switching.", type: "boolean" },
      cwd: { description: "Working directory. Defaults to the selected workspace root.", type: "string" },
      name: { description: "Branch or ref to switch to.", type: "string" },
    }),
  },
  open_browser_preview: {
    description:
      "Open a URL or web search in the in-app browser. Use when the user asks to open, pull up, navigate to, or view a site such as Google, YouTube, docs, localhost, or a source link. When guessing localhost without a printed URL, use only common dev-server ports; uncommon ports require an explicit user request or tracked dev-server session.",
    name: "open_browser_preview",
    parameters: obj({
      query: { description: "Search terms to open in the browser when no direct URL is provided.", type: "string" },
      search_engine: {
        description: "Search engine for query searches.",
        enum: ["google", "youtube", "github", "duckduckgo"],
        type: "string",
      },
      url: { description: "URL or bare domain to open.", type: "string" },
    }),
  },
  mcp_list_servers: {
    description:
      "List MCP servers configured on the MCP page. Returns labels, transports, URLs/commands, enabled state, and approval policy. Use this before suggesting MCP changes so you do not duplicate or overwrite existing servers.",
    name: "mcp_list_servers",
    parameters: obj({}),
  },
  mcp_list_tools: {
    description:
      "List tools exposed by configured MCP servers. With no server_label, queries every enabled remote server. Local stdio servers are skipped because in-app stdio spawning is not yet wired.",
    name: "mcp_list_tools",
    parameters: obj({
      force_refresh: { description: "Bypass the per-server tool cache.", type: "boolean" },
      server_label: { description: "Only list tools from this server label.", type: "string" },
    }),
  },
  mcp_call_tool: {
    description:
      "Invoke a tool on a remote MCP server. Honors the server's approval policy (always = approval card, never = direct). Use mcp_list_tools first to discover exact names + argument schemas.",
    name: "mcp_call_tool",
    parameters: obj(
      {
        arguments_json: {
          description: "JSON-encoded object with the tool arguments. Defaults to {} when omitted.",
          type: "string",
        },
        server_label: { description: "MCP server label as shown on the MCP page.", type: "string" },
        tool_name: { description: "Exact MCP tool name (case-sensitive).", type: "string" },
      },
      ["server_label", "tool_name"],
    ),
  },
  mcp_set_server: {
    description:
      "Create or update an MCP server config. Provide label + transport + required fields (server_url for remote, command for stdio). On existing labels, only the fields you pass are patched. Mutating operations always require user approval.",
    name: "mcp_set_server",
    parameters: obj(
      {
        allowed_tools: {
          description: "Optional comma or newline separated tool allow-list.",
          type: "string",
        },
        args: { description: "Stdio command arguments (one per line for stdio).", type: "string" },
        authorization: { description: "Bearer token / OAuth value for remote servers.", type: "string" },
        command: { description: "Stdio command (e.g. npx).", type: "string" },
        defer_loading: { description: "Defer tool loading until first use (remote only).", type: "boolean" },
        description: { description: "Short purpose blurb shown in the agent prompt.", type: "string" },
        enabled: { description: "Whether the server is enabled.", type: "boolean" },
        env: { description: "Stdio environment variables, KEY=VALUE per line.", type: "string" },
        label: { description: "Stable label for the server (alphanumerics, underscores, dashes).", type: "string" },
        require_approval: {
          description: "Approval policy for remote tool calls.",
          enum: ["always", "never"],
          type: "string",
        },
        server_url: { description: "HTTPS MCP endpoint for remote servers.", type: "string" },
        transport: {
          description: "Server transport.",
          enum: ["remote", "stdio"],
          type: "string",
        },
      },
      ["label"],
    ),
  },
  mcp_remove_server: {
    description: "Remove an MCP server configuration by label. Asks for user approval before applying.",
    name: "mcp_remove_server",
    parameters: obj({ label: { description: "MCP server label to remove.", type: "string" } }, ["label"]),
  },
};

export function getToolSchema(name: string): ToolSchemaEntry | undefined {
  return LOCAL_TOOL_SCHEMAS[name];
}

export function listKnownToolNames(): string[] {
  return Object.keys(LOCAL_TOOL_SCHEMAS);
}

export function toAnthropicTools(toolNames: string[]): AnthropicTool[] {
  return toolNames
    .map((name) => LOCAL_TOOL_SCHEMAS[name])
    .filter((entry): entry is ToolSchemaEntry => Boolean(entry))
    .map((entry) => ({
      description: entry.description,
      input_schema: entry.parameters,
      name: entry.name,
    }));
}

export function toOpenAITools(toolNames: string[]): OpenAITool[] {
  return toolNames
    .map((name) => LOCAL_TOOL_SCHEMAS[name])
    .filter((entry): entry is ToolSchemaEntry => Boolean(entry))
    .map((entry) => ({
      function: {
        description: entry.description,
        name: entry.name,
        parameters: entry.parameters,
      },
      type: "function" as const,
    }));
}

export function toOpenAIResponsesTools(toolNames: string[]): OpenAIResponsesFunctionTool[] {
  return toolNames
    .map((name) => LOCAL_TOOL_SCHEMAS[name])
    .filter((entry): entry is ToolSchemaEntry => Boolean(entry))
    .map((entry) => ({
      description: entry.description,
      name: entry.name,
      parameters: entry.parameters,
      type: "function" as const,
    }));
}

/** Lightweight validation result — used by the corrective-retry path. */
export interface ToolArgsValidation {
  errors: string[];
  ok: boolean;
}

/**
 * Hand-rolled JSON Schema validator. Covers `required`, top-level
 * `type`, and `enum` — sufficient for our flat schemas. Unknown keys are
 * tolerated so model variations don't hard-fail the call.
 */
export function validateToolArgs(toolName: string, args: Record<string, unknown>): ToolArgsValidation {
  const schema = LOCAL_TOOL_SCHEMAS[toolName];
  if (!schema) {
    return { errors: [], ok: true };
  }

  const errors: string[] = [];
  const required = schema.parameters.required ?? [];

  for (const key of required) {
    const value = args[key];
    if (value === undefined || value === null || value === "") {
      errors.push(`missing required argument \`${key}\``);
    }
  }

  for (const [key, property] of Object.entries(schema.parameters.properties)) {
    const value = args[key];
    if (value === undefined || value === null) {
      continue;
    }
    const typeError = checkType(key, value, property.type);
    if (typeError) {
      errors.push(typeError);
      continue;
    }
    if (property.enum && !property.enum.includes(value as string | number)) {
      errors.push(`\`${key}\` must be one of ${JSON.stringify(property.enum)} (got ${JSON.stringify(value)})`);
    }
  }

  return { errors, ok: errors.length === 0 };
}

function checkType(key: string, value: unknown, expected: JsonSchemaType): string | null {
  switch (expected) {
    case "string":
      return typeof value === "string" ? null : `\`${key}\` must be a string`;
    case "integer":
      if (typeof value === "number" && Number.isInteger(value)) return null;
      if (typeof value === "string" && /^-?\d+$/.test(value)) return null; // tolerate stringified ints
      return `\`${key}\` must be an integer`;
    case "number":
      if (typeof value === "number") return null;
      if (typeof value === "string" && !Number.isNaN(Number(value))) return null;
      return `\`${key}\` must be a number`;
    case "boolean":
      if (typeof value === "boolean") return null;
      if (typeof value === "string" && /^(true|false|1|0|yes|no)$/i.test(value)) return null;
      return `\`${key}\` must be a boolean`;
    case "array":
      return Array.isArray(value) ? null : `\`${key}\` must be an array`;
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value) ? null : `\`${key}\` must be an object`;
    default:
      return null;
  }
}

/**
 * Returns the list of tool names eligible for native function calling for the
 * current request. Filtered by which tools the user has enabled in Toolbox,
 * intersected with the schemas we've authored.
 */
export function selectNativeToolNames(settings: ProviderSettings): string[] {
  const tools = normalizeToolRegistrySettings(settings.tools);
  const allKnown = listKnownToolNames();
  return allKnown.filter((name) => isToolEnabledForRequest(name, tools));
}

function isToolEnabledForRequest(name: string, tools: ReturnType<typeof normalizeToolRegistrySettings>): boolean {
  if (name === "web_search") return tools.webSearch;
  if (name === "lookup_color") return tools.colorTools;
  if (name === "open_browser_preview") return tools.browserPreview;
  if (name === "view_code" || name === "read_file") return tools.codeView;
  if (name === "list_directory" || name === "build_index") return tools.fileBrowser;
  if (name === "search_files" || name === "recall_context") return tools.fileSearch;
  if (name === "edit_file" || name === "inline_edit" || name === "write_file" || name === "move_path" || name === "rename_path") {
    return tools.codeEdit;
  }
  if (name === "create_files" || name === "create_pdf_file" || name === "create_vite_project") return tools.fileCreation;
  if (name === "create_chat_pdf" || name === "list_pdfs" || name === "read_pdf" || name === "edit_pdf_text") return tools.pdfTools;
  if (name === "delete_file") return tools.fileSafety;
  if (name === "run_terminal") return tools.terminal;
  if (name === "run_tests") return tools.testingTools;
  if (name === "typescript_check") return tools.typescriptTools;
  if (name.startsWith("git_") || name.startsWith("github_")) return tools.sourceControl;
  if (name.startsWith("mcp_")) return tools.mcpServers;
  return true;
}

/**
 * Whether the current provider+model is known to support native function
 * calling well. When false, the caller skips the native path and the model
 * falls back to the existing XML-prompt route. (Cheap free models tend to
 * choke on the native API even when the provider claims support.)
 */
export function modelSupportsNativeTools(settings: ProviderSettings, model: string): boolean {
  if (isNativeToolsDisabledByEnv()) {
    return false;
  }

  const provider = settings.provider;
  const normalized = model.trim().toLowerCase();

  // Anthropic native tools are first-class — every modern Claude supports them.
  if (provider === "anthropic") {
    return true;
  }

  // OpenAI: GPT-4 / GPT-4o / GPT-4.1 / o-series all support function calling.
  if (provider === "openai") {
    return true;
  }

  // OpenRouter: free models are flaky. Use the curated allow-list of known
  // native-tools-capable model families; anything not on the list falls back
  // to the XML-prompt path.
  if (provider === "openrouter") {
    if (isOpenRouterFreeModel(normalized)) {
      return false;
    }
    return openRouterModelHasReliableNativeTools(normalized);
  }

  // DeepSeek, Groq, xAI: most chat-completions-compatible models work, but
  // there are exceptions. We accept native by default; if the call fails the
  // caller can flip the env kill-switch.
  return true;
}

function isNativeToolsDisabledByEnv(): boolean {
  const raw = (import.meta as unknown as { env?: Record<string, string | undefined> }).env
    ?.VITE_GILBERT_CODEX_DISABLE_NATIVE_TOOLS;
  return raw === "1" || raw === "true" || raw === "TRUE";
}
