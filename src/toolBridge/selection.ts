import type { ToolDefinition } from "./types";

export interface SelectAdvertisedBridgeToolsOptions {
  browserPreviewEnabled?: boolean;
  includeDiagnostics?: boolean;
  memoryEnabled?: boolean;
  prompt: string;
  terminalEnabled?: boolean;
  webSearchEnabled?: boolean;
}

const FILE_PATH_PATTERN = /(?:^|[\s"'`])[\w./\\-]+\.(?:astro|c|cpp|cs|css|dart|go|html|java|js|jsx|json|kt|kts|md|mdx|php|py|rb|rs|scss|sh|sql|svelte|swift|toml|ts|tsx|txt|vue|xml|ya?ml)\b/i;
const FILE_CONTEXT_PATTERN = /\b(app|code|codebase|component|config(?:uration)?|debug|dir|directory|file|folder|line|local|model|providers?|registry|runtime|service|settings?|source|support(?:ed)?|tool|bridge|project|read|repo|repository|workspace)\b/i;
const INSPECT_PROMPT_PATTERN = /\b(audit|check|count|find|grep|inspect|list|look at|read|review|search|show|tree|where)\b/i;
const EDIT_PROMPT_PATTERN = /\b(add|append|change|delete|edit|fix|implement|improve|insert|patch|polish|refactor|remove|replace|restyle|revamp|style|update|upgrade|write)\b/i;
const DESIGN_EDIT_PROMPT_PATTERN = /\b(?:better|cleaner|clearer|design|layout|party|polished?|readable|readability|theme|ui|visual)\b/i;
const MAKE_BETTER_PROMPT_PATTERN = /\bmake\s+(?:it|this|that|the\s+app|the\s+page|the\s+site|the\s+ui|the\s+design)?\s*(?:look\s+|feel\s+|more\s+)?(?:better|cleaner|clearer|party|polished|readable)\b/i;
const CREATE_FOLDER_PATTERN = /\b(create|make|add)\s+(?:a\s+|an\s+|the\s+)?(?:dir|directory|folder)\b|\bmkdir\b/i;
const MOVE_PROMPT_PATTERN = /\b(move|rename)\b/i;
const TERMINAL_PROMPT_PATTERN = /\b(build|cargo|compile|dev server|install|npm|pnpm|run|script|serve|start|terminal|test|tsc|vite|yarn)\b/i;
const LOCAL_GIT_PROMPT_PATTERN = /\b(branch|commit|diff|git|pull|push|stage|status)\b/i;
const LOCAL_GIT_CHANGE_REVIEW_PATTERN =
  /\b(?:what(?:'s| is| all)?|which|show|list|summari[sz]e|explain|review|audit|check|tell(?: me)?)\b[\s\S]{0,180}\b(?:changed|changes|modified|uncommitted|dirty\s+tree|working[-\s]?tree|worktree|diff|status|done\s+so\s+far|files?\s+changed)\b/i;
const GITHUB_PROMPT_PATTERN = /\b(github|pull request|pr|release|workflow|actions?|remote repos?|repository on github)\b/i;
const WEB_PROMPT_PATTERN = /\b(api docs?|browse|changelog|cite|citations?|current|date-sensitive|docs?|documentation|external|internet|latest|live web|look up|news|official|online|prices?|pricing|recent|release notes?|research|search(?:\s+the)?\s+(?:internet|online|web)|source-backed|source backed|sources|standard|today|up[- ]to[- ]date|verify|web)\b|(?:\b(?:release|launch)\s+(?:date|daye?|schedule|timing|window)\b)|(?:\b(?:comes?|coming)\s+out\b)|(?:\b(?:scheduled|slated)\s+(?:for|to|release|launch)\b)/i;
const LOCAL_DOCS_ONLY_PATTERN = /\b(?:local|repo|repository|project|workspace)\s+(?:docs?|documentation|files?|source|source code|code)\b|\b(?:docs?|documentation)\s+(?:in|inside|from)\s+(?:the\s+)?(?:local|repo|repository|project|workspace)\b/i;
const EXTERNAL_WEB_EVIDENCE_PATTERN = /\b(api docs?|browse|changelog|cite|citations?|current|date-sensitive|external|internet|latest|live web|look up|news|official|online|prices?|pricing|recent|release notes?|research|search(?:\s+the)?\s+(?:internet|online|web)|source-backed|source backed|sources|standard|today|up[- ]to[- ]date|verify|web)\b|(?:\b(?:release|launch)\s+(?:date|daye?|schedule|timing|window)\b)|(?:\b(?:comes?|coming)\s+out\b)|(?:\b(?:scheduled|slated)\s+(?:for|to|release|launch)\b)/i;
const BROWSER_PROMPT_PATTERN = /\b(browser|browser error|click|console|devtools|inspect|localhost|local site|open preview|page|preview|screenshot|site|ui|visual|webview|website)\b/i;
const DIAGNOSTIC_PROMPT_PATTERN = /\b(bridge_echo|bridge_sum|diagnostic|smoke test|tool_smoke_test|tool smoke)\b/i;
const MEMORY_PROMPT_PATTERN = /\b(memory|remember|previous|prior|earlier|decision|lesson|preference|history|project context)\b/i;

const INSPECT_TOOL_IDS = new Set([
  "files_read",
  "files_read_many",
  "files_read_range",
  "files_list",
  "files_tree_summary",
  "files_search",
  "files_stat",
  "files_count_lines",
]);

const EDIT_TOOL_IDS = new Set([
  "files_edit_many",
  "files_apply_patch",
  "files_write_many",
]);

const LOCAL_GIT_TOOL_IDS = new Set([
  "git_status",
  "git_diff",
  "git_stage",
  "git_commit",
  "git_branch",
  "git_push",
  "git_pull",
  "git_init",
]);

const LOCAL_GIT_REVIEW_TOOL_IDS = new Set([
  "git_status",
  "git_diff",
]);

export function selectAdvertisedBridgeTools(
  tools: ToolDefinition[],
  options: SelectAdvertisedBridgeToolsOptions,
) {
  const prompt = options.prompt.trim();
  const includeDiagnostics = options.includeDiagnostics === true || DIAGNOSTIC_PROMPT_PATTERN.test(prompt);
  const selectedToolIds = selectToolIds(prompt, {
    includeDiagnostics,
    memoryEnabled: options.memoryEnabled !== false,
    webSearchEnabled: options.webSearchEnabled === true,
  });

  return tools.filter((tool) => {
    const family = tool.executorMetadata?.family;

    if (family === "diagnostic") {
      return includeDiagnostics && selectedToolIds.has(tool.id);
    }

    if (family === "web") {
      return options.webSearchEnabled === true && selectedToolIds.has(tool.id);
    }

    if (family === "terminal") {
      return options.terminalEnabled !== false && selectedToolIds.has(tool.id);
    }

    if (family === "browser") {
      return options.browserPreviewEnabled !== false && selectedToolIds.has(tool.id);
    }

    if (family === "memory") {
      return options.memoryEnabled !== false && selectedToolIds.has(tool.id);
    }

    if (!family) {
      return selectedToolIds.has(tool.id);
    }

    return selectedToolIds.has(tool.id);
  });
}

function selectToolIds(
  prompt: string,
  options: { includeDiagnostics: boolean; memoryEnabled: boolean; webSearchEnabled: boolean },
) {
  const ids = new Set<string>();
  const looksLikeFileWork = FILE_PATH_PATTERN.test(prompt) || FILE_CONTEXT_PATTERN.test(prompt);
  const conversationOnlyPrompt = /\b(?:summarize|recap)\b.*\b(?:conversation|chat|thread)\b/i.test(prompt) && !looksLikeFileWork;
  const looksLikeInspectWork = !conversationOnlyPrompt && (looksLikeFileWork || INSPECT_PROMPT_PATTERN.test(prompt));
  const looksLikeGitHubWork = GITHUB_PROMPT_PATTERN.test(prompt);
  const looksLikeLocalGitReviewWork = LOCAL_GIT_CHANGE_REVIEW_PATTERN.test(prompt);
  const looksLikeLocalGitWork = LOCAL_GIT_PROMPT_PATTERN.test(prompt) || looksLikeGitHubWork;
  const gitOnlyPrompt = looksLikeLocalGitWork && !FILE_PATH_PATTERN.test(prompt) && !/\b(code|file|folder|workspace|src|edit|fix|implement|refactor|test|build)\b/i.test(prompt);
  const looksLikeDesignEditWork = DESIGN_EDIT_PROMPT_PATTERN.test(prompt) && /\b(?:app|card|component|css|design|file|layout|page|screen|style|theme|ui|visual|workspace|src[\\/]|\.css\b|\.jsx?\b|\.tsx?\b)\b/i.test(prompt);
  const looksLikeEditWork = !gitOnlyPrompt && (EDIT_PROMPT_PATTERN.test(prompt) || looksLikeDesignEditWork || MAKE_BETTER_PROMPT_PATTERN.test(prompt) || CREATE_FOLDER_PATTERN.test(prompt) || MOVE_PROMPT_PATTERN.test(prompt));

  if (options.memoryEnabled && (looksLikeInspectWork || looksLikeEditWork || looksLikeLocalGitWork || looksLikeLocalGitReviewWork || TERMINAL_PROMPT_PATTERN.test(prompt) || MEMORY_PROMPT_PATTERN.test(prompt))) {
    ids.add("memory_search");
  }

  if (looksLikeInspectWork || looksLikeEditWork || TERMINAL_PROMPT_PATTERN.test(prompt)) {
    addAll(ids, INSPECT_TOOL_IDS);
  }

  if (looksLikeEditWork) {
    addAll(ids, EDIT_TOOL_IDS);

    if (CREATE_FOLDER_PATTERN.test(prompt)) {
      ids.add("files_create_directory");
    }

    if (MOVE_PROMPT_PATTERN.test(prompt)) {
      ids.add("files_move");
    }

  }

  if (TERMINAL_PROMPT_PATTERN.test(prompt)) {
    ids.add("terminal_run");
  }

  if (looksLikeLocalGitWork) {
    addAll(ids, LOCAL_GIT_TOOL_IDS);
  } else if (looksLikeLocalGitReviewWork) {
    addAll(ids, LOCAL_GIT_REVIEW_TOOL_IDS);
  }

  if (BROWSER_PROMPT_PATTERN.test(prompt)) {
    ids.add("browser_preview_open");
    ids.add("browser_console_read");
  }

  if (options.webSearchEnabled && shouldAttachWebSearch(prompt)) {
    ids.add("web_search");
  }

  if (options.includeDiagnostics) {
    ids.add("bridge_echo");
    ids.add("bridge_sum");
    ids.add("tool_smoke_test");
  }

  addGitHubToolIds(ids, prompt, looksLikeGitHubWork);

  return ids;
}

export function shouldAttachWebSearch(prompt: string) {
  if (!WEB_PROMPT_PATTERN.test(prompt)) {
    return false;
  }

  return !LOCAL_DOCS_ONLY_PATTERN.test(prompt) || EXTERNAL_WEB_EVIDENCE_PATTERN.test(prompt);
}

function addGitHubToolIds(ids: Set<string>, prompt: string, looksLikeGitHubWork: boolean) {
  if (!looksLikeGitHubWork) {
    return;
  }

  ids.add("github_account");

  if (/\b(repo|repository|repositories|github)\b/i.test(prompt)) {
    ids.add("github_list_repositories");
    ids.add("github_get_repository");
  }

  if (/\b(branch|pr|pull request|release|workflow|actions?|commit|file|tree|search)\b/i.test(prompt)) {
    ids.add("github_get_repository");
    ids.add("github_list_branches");
  }

  if (/\b(file|tree|search|code)\b/i.test(prompt)) {
    ids.add("github_list_tree");
    ids.add("github_read_file");
    ids.add("github_search_code");
  }

  if (/\b(branch)\b/i.test(prompt)) {
    ids.add("github_create_branch");
  }

  if (/\b(commit|write files|update files)\b/i.test(prompt)) {
    ids.add("github_commit_files");
  }

  if (/\b(pr|pull request)\b/i.test(prompt)) {
    ids.add("github_create_pull_request");
  }

  if (/\brelease\b/i.test(prompt)) {
    ids.add("github_generate_release_notes");
    ids.add("github_list_releases");
    ids.add("github_create_release");
  }

  if (/\b(workflow|actions?)\b/i.test(prompt)) {
    ids.add("github_list_workflows");
    ids.add("github_list_workflow_runs");
    ids.add("github_dispatch_workflow");
  }
}

function addAll(ids: Set<string>, nextIds: Set<string>) {
  for (const id of nextIds) {
    ids.add(id);
  }
}
