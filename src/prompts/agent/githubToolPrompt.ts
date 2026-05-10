export type GithubPromptIntent =
  | "none"
  | "repository_inventory"
  | "repository_inspection"
  | "repository_mutation"
  | "branch_or_history"
  | "pull_request"
  | "status";

export interface GithubPromptAnalysis {
  explicitLocalContext: boolean;
  intent: GithubPromptIntent;
  isGithubRelated: boolean;
  ownerRepoHint?: string;
  repoHint?: string;
  shouldSkipLocalWorkspaceContext: boolean;
}

export interface GithubRoutingContextInput {
  connected: boolean;
  connectedAccount: string;
  prompt: string;
  scopes: string;
}

const REPO_HINT_STOP_WORDS = new Set([
  "a",
  "about",
  "access",
  "all",
  "an",
  "and",
  "available",
  "branch",
  "branches",
  "code",
  "codebase",
  "deep",
  "do",
  "does",
  "for",
  "have",
  "i",
  "in",
  "into",
  "list",
  "look",
  "mine",
  "my",
  "of",
  "on",
  "read",
  "repo",
  "repos",
  "repositories",
  "repository",
  "see",
  "show",
  "the",
  "what",
  "which",
  "with",
]);

export function analyzeGithubPrompt(prompt: string): GithubPromptAnalysis {
  const normalized = prompt.toLowerCase();
  const ownerRepoHint = extractOwnerRepoHint(prompt);
  const repoHint = ownerRepoHint ?? extractNamedRepoHint(prompt);
  const explicitLocalContext = /\b(local|workspace|folder|computer|pc|cloned?|on disk|this app|this project|current project|current workspace|files? here)\b/i.test(prompt)
    || /\b(push|commit|stage)\s+(this|these|my changes|the changes)\b/i.test(prompt);
  const mentionsGithub = isGithubSourceControlPrompt(prompt);
  const asksInventory = /\b(what|which|show|list|see|find|all|available|accessible|access|have|mine|my)\b/i.test(prompt)
    && /\b(repos?|repositories)\b/i.test(prompt);
  const asksStatus = /\b(status|connected|connection|logged\s+in|signed\s+in|scopes?|permissions?|access)\b/i.test(prompt)
    && /\b(github|git|oauth|token)\b/i.test(prompt);
  const asksPullRequest = /\b(pull\s+request|prs?\b|review|merge)\b/i.test(prompt);
  const asksMutation = /\b(commit|push|write|edit|change|modify|update|delete|create\s+branch|branch\s+off|open\s+pr|pull\s+request)\b/i.test(prompt);
  const asksBranchOrHistory = /\b(branches?|commits?|history|tags?|releases?)\b/i.test(prompt);
  const asksInspection = /\b(look\s+at|check\s+out|inspect|deep\s+dive|code\s*base|codebase|what\s+is|what's|tell\s+me\s+about|read|files?|tree|structure|stack|app|application|project)\b/i.test(prompt);
  let intent: GithubPromptIntent = "none";

  if (mentionsGithub) {
    if (asksPullRequest) {
      intent = "pull_request";
    } else if (asksMutation) {
      intent = "repository_mutation";
    } else if (asksBranchOrHistory) {
      intent = "branch_or_history";
    } else if (asksStatus) {
      intent = "status";
    } else if (repoHint || asksInspection) {
      intent = "repository_inspection";
    } else if (asksInventory) {
      intent = "repository_inventory";
    } else {
      intent = "repository_inspection";
    }
  }

  return {
    explicitLocalContext,
    intent,
    isGithubRelated: mentionsGithub,
    ownerRepoHint,
    repoHint,
    shouldSkipLocalWorkspaceContext: mentionsGithub && !explicitLocalContext,
  };
}

export function isGithubSourceControlPrompt(prompt: string) {
  const normalized = prompt.toLowerCase();

  if (/\bgithub\b|\bsource\s+control\b|\bpull\s+request\b|\bprs?\b/.test(normalized)) {
    return true;
  }

  if (/\bgit\b/.test(normalized) && /\b(repos?|repositories|branches?|commits?|push|pull|clone|remote|status|oauth|token)\b/.test(normalized)) {
    return true;
  }

  if (/\b(repos?|repositories)\b/.test(normalized) && /\b(my|mine|connected|available|accessible|access|list|show|see|find|have)\b/.test(normalized)) {
    return true;
  }

  return /\b(branches?|commits?|push|pull|merge)\b/.test(normalized) && /\b(repos?|repositories|github|git|remote)\b/.test(normalized);
}

export function createGithubRuntimeToolInstructions(prompt: string) {
  const analysis = analyzeGithubPrompt(prompt);
  const hint = analysis.ownerRepoHint
    ? `Current prompt repository hint: \`${analysis.ownerRepoHint}\`.`
    : analysis.repoHint
      ? `Current prompt repository hint: \`${analysis.repoHint}\` (owner can be inferred by the GitHub tool if needed).`
      : "";

  return [
    "GitHub source-control tools use the account connected in Settings through GitHub's API. Browser login requests full GitHub OAuth access. Local Git, Git Bash, and a local clone are not required for remote repository listing, inspection, branch creation, commits, or pull requests.",
    "Do not answer GitHub requests from guessed, cached, or hardcoded repository lists. Use github_* tool results for GitHub facts.",
    "GitHub routing: broad questions like 'what repos do I have' should call github_list_repositories. Repo-specific questions should not list every repo just because the user says 'my GitHub repo'.",
    "For a named repository, call github_get_repository, github_list_branches, github_list_tree, github_read_file, or github_search_code with repository=owner/repo when known. If only the repo name is known, pass repo=<name> so the GitHub tool can infer the owner from the connected account.",
    "For codebase deep dives, first call github_list_tree with recursive=true and a useful limit, then read concrete evidence with github_read_file such as README files, package manifests, config files, and entry points. Use github_search_code when the tree does not reveal enough. Synthesize only after those tool results arrive.",
    "For GitHub mutations, create an isolated branch with github_create_branch when appropriate, commit through github_commit_files, and open draft PRs with github_create_pull_request. Ask for missing repo, branch, or file details instead of guessing destructive changes.",
    "Use local computer tools only when the user explicitly asks for local workspace files, a local clone, this app/current project, or after GitHub results show local evidence is needed.",
    "GitHub answer format: use normal Markdown bullets, numbered lists, headings, and links. Avoid Markdown pipe tables for repository inventories unless the user explicitly asks for a table.",
    hint,
    analysis.isGithubRelated ? `Current GitHub intent: ${analysis.intent}.` : "",
  ].filter(Boolean).join("\n");
}

export function createGithubRoutingContext(input: GithubRoutingContextInput) {
  const analysis = analyzeGithubPrompt(input.prompt);
  const hint = analysis.ownerRepoHint
    ? `Repository hint: ${analysis.ownerRepoHint}`
    : analysis.repoHint
      ? `Repository hint: ${analysis.repoHint}`
      : "Repository hint: none detected";

  return [
    "GITHUB TOOL ROUTING",
    `Connected account: ${input.connectedAccount}`,
    `Token scopes: ${input.scopes}`,
    `Intent: ${analysis.intent}`,
    hint,
    "Use github_* tools for this GitHub/source-control request before local computer tools.",
    "If a repository is named, inspect that repository directly. Do not answer by listing every connected repository unless the user asks for a repo inventory.",
    "For a codebase/app deep dive, gather remote evidence with github_list_tree and github_read_file before summarizing.",
    input.connected
      ? "If GitHub returns missing scopes, SSO, 401, 403, or 404 errors, report the exact tool error and tell the user to reconnect or authorize access in GitHub."
      : "GitHub is not connected. Ask the user to connect GitHub in Settings before using GitHub tools.",
  ].join("\n");
}

function extractOwnerRepoHint(prompt: string) {
  const match = prompt.match(/\b([a-z0-9][a-z0-9_.-]*\/[a-z0-9][a-z0-9_.-]*)\b/i);
  return match?.[1];
}

function extractNamedRepoHint(prompt: string) {
  const patterns = [
    /\b(?:github|git)\s+(?:repo|repository)\s+(?:named\s+|called\s+|for\s+|about\s+)?([a-z0-9][a-z0-9_.-]{2,})\b/i,
    /\b(?:repo|repository)\s+(?:named\s+|called\s+|for\s+|about\s+)?([a-z0-9][a-z0-9_.-]{2,})\b/i,
  ];

  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    const candidate = match?.[1]?.trim();

    if (candidate && !REPO_HINT_STOP_WORDS.has(candidate.toLowerCase())) {
      return candidate;
    }
  }

  return undefined;
}
