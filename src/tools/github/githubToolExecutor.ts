import type { ChatSource } from "../../types/chat";
import { analyzeGithubPrompt } from "../../prompts/agent/githubToolPrompt";
import {
  commitGithubFiles,
  createGithubBranch,
  createGithubPullRequest,
  getGithubRepository,
  getGithubState,
  getMissingRequiredGithubOAuthScopes,
  listGithubBranches,
  listGithubRepositories,
  listGithubTree,
  readGithubFile,
  searchGithubCode,
} from "../../app/githubClient";
import type { GithubCommitFileInput, GithubRepository } from "../../types/github";

export type GithubToolName =
  | "github_commit_files"
  | "github_create_branch"
  | "github_create_pull_request"
  | "github_get_repository"
  | "github_list_branches"
  | "github_list_repositories"
  | "github_list_tree"
  | "github_read_file"
  | "github_search_code"
  | "github_status";

export interface GithubToolExecutionResult {
  content: string;
  directAnswer?: string;
  executed: boolean;
  sources?: ChatSource[];
}

export interface GithubToolExecutionContext {
  userPrompt?: string;
}

interface RepositoryArgs {
  owner: string;
  repo: string;
}

const GITHUB_TOOL_NAMES = new Set<GithubToolName>([
  "github_commit_files",
  "github_create_branch",
  "github_create_pull_request",
  "github_get_repository",
  "github_list_branches",
  "github_list_repositories",
  "github_list_tree",
  "github_read_file",
  "github_search_code",
  "github_status",
]);

export function isGithubToolName(value: string): value is GithubToolName {
  return GITHUB_TOOL_NAMES.has(value as GithubToolName);
}

export async function executeGithubTool(tool: GithubToolName, args: Record<string, string>, context: GithubToolExecutionContext = {}): Promise<GithubToolExecutionResult> {
  switch (tool) {
    case "github_status": {
      const state = await getGithubState();
      const user = state.user?.login ?? "none";
      const scopes = state.scopes.length > 0 ? state.scopes.join(", ") : "not reported";
      const missingScopes = getMissingGithubFullAccessScopes(state.scopes);

      return {
        content: [`Connected: ${state.connected ? "yes" : "no"}`, `User: ${user}`, `Scopes: ${scopes}`, state.connected && missingScopes.length > 0 ? `Missing full-access scopes: ${missingScopes.join(", ")}` : ""].filter(Boolean).join("\n"),
        directAnswer: state.connected
          ? missingScopes.length > 0
            ? `GitHub is connected as **${state.user?.login ?? "GitHub"}**, but the token is missing full-access scopes: ${missingScopes.join(", ")}. Reconnect GitHub in Settings to upgrade the token.`
            : `GitHub is connected as **${state.user?.login ?? "GitHub"}** with full GitHub access. Scopes: ${scopes}.`
          : "GitHub is not connected yet. Open Settings and connect GitHub first.",
        executed: true,
      };
    }
    case "github_list_repositories": {
      const repos = await listGithubRepositories({
        affiliation: firstArg(args, ["affiliation"]),
        page: numberArg(args, ["page"]),
        perPage: numberArg(args, ["per_page", "perPage", "limit"]),
        query: firstArg(args, ["query", "q", "search"]),
        sort: firstArg(args, ["sort"]),
        visibility: firstArg(args, ["visibility"]),
      });
      const directInventory = shouldDirectAnswerRepositoryList(context.userPrompt);

      return {
        content: directInventory
          ? formatRepositoryList(repos)
          : [
              formatRepositoryList(repos),
              "",
              "Repo-specific request detected. Use this list only to resolve the owner/name, then continue with repo-specific GitHub tools before answering.",
            ].join("\n"),
        directAnswer: directInventory ? formatRepositoryListAnswer(repos) : undefined,
        executed: true,
        sources: directInventory ? repos.slice(0, 12).map((repo) => ({ title: repo.fullName, url: repo.htmlUrl })) : undefined,
      };
    }
    case "github_get_repository": {
      const repo = await resolveRepositoryArgs(args, context);

      if (!repo) {
        return createMissingRepositoryResult("show repository details");
      }

      const repository = await getGithubRepository(repo);

      return {
        content: formatRepositoryDetail(repository),
        directAnswer: formatRepositoryDetailAnswer(repository),
        executed: true,
        sources: [{ title: repository.fullName, url: repository.htmlUrl }],
      };
    }
    case "github_list_branches": {
      const repo = await resolveRepositoryArgs(args, context);

      if (!repo) {
        return createMissingRepositoryResult("list branches");
      }

      const branches = await listGithubBranches({
        ...repo,
        page: numberArg(args, ["page"]),
        perPage: numberArg(args, ["per_page", "perPage", "limit"]),
      });

      return {
        content: formatBranchList(repo.owner, repo.repo, branches),
        directAnswer: formatBranchListAnswer(repo.owner, repo.repo, branches),
        executed: true,
      };
    }
    case "github_list_tree": {
      const repo = await resolveRepositoryArgs(args, context);

      if (!repo) {
        return createMissingRepositoryResult("show remote files");
      }

      const tree = await listGithubTree({
        ...repo,
        branch: firstArg(args, ["branch", "ref"]),
        limit: numberArg(args, ["limit", "max_results", "maxResults"]),
        recursive: booleanArg(args, ["recursive"], true),
      });

      return {
        content: formatTree(tree),
        directAnswer: formatTreeAnswer(repo.owner, repo.repo, tree),
        executed: true,
      };
    }
    case "github_read_file": {
      const repo = await resolveRepositoryArgs(args, context);

      if (!repo) {
        return createMissingRepositoryResult("read a file");
      }

      const path = requiredArg(args, ["path", "file_path", "file"]);
      const file = await readGithubFile({
        ...repo,
        branch: firstArg(args, ["branch", "ref"]),
        maxBytes: numberArg(args, ["max_bytes", "maxBytes", "bytes"]),
        path,
      });

      return {
        content: formatReadFile(file),
        executed: true,
        sources: file.htmlUrl ? [{ title: `${repo.owner}/${repo.repo}:${file.path}`, url: file.htmlUrl }] : undefined,
      };
    }
    case "github_search_code": {
      const maybeRepo = await maybeRepositoryArgsWithInference(args, context);
      const result = await searchGithubCode({
        ...maybeRepo,
        branch: firstArg(args, ["branch", "ref"]),
        page: numberArg(args, ["page"]),
        perPage: numberArg(args, ["per_page", "perPage", "limit"]),
        query: requiredArg(args, ["query", "q", "search", "text"]),
      });

      return {
        content: formatCodeSearch(result),
        executed: true,
        sources: result.items.slice(0, 12).map((item) => ({ title: `${item.repositoryFullName}:${item.path}`, url: item.htmlUrl })),
      };
    }
    case "github_create_branch": {
      const repo = await getRepositoryArgs(args, context);
      const branch = await createGithubBranch({
        ...repo,
        baseBranch: firstArg(args, ["base_branch", "baseBranch", "from", "source_branch"]),
        newBranch: requiredArg(args, ["new_branch", "newBranch", "branch", "name"]),
      });

      return {
        content: [`Branch: ${branch.name}`, `Commit: ${branch.commitSha}`, `Protected: ${branch.protected ? "yes" : "no"}`].join("\n"),
        executed: true,
      };
    }
    case "github_commit_files": {
      const repo = await getRepositoryArgs(args, context);
      const commit = await commitGithubFiles({
        ...repo,
        branch: firstArg(args, ["branch", "ref"]),
        files: parseCommitFiles(args),
        message: requiredArg(args, ["message", "commit_message", "commitMessage", "title"]),
      });

      return {
        content: [`Branch: ${commit.branch}`, `Commit: ${commit.commitSha}`, `Parent: ${commit.parentSha}`, `Files changed: ${commit.filesChanged}`, `URL: ${commit.commitHtmlUrl}`].join("\n"),
        executed: true,
        sources: [{ title: `Commit ${commit.commitSha.slice(0, 7)}`, url: commit.commitHtmlUrl }],
      };
    }
    case "github_create_pull_request": {
      const repo = await getRepositoryArgs(args, context);
      const pullRequest = await createGithubPullRequest({
        ...repo,
        base: requiredArg(args, ["base", "base_branch", "baseBranch"]),
        body: firstArg(args, ["body", "description", "summary"]),
        draft: booleanArg(args, ["draft"], true),
        head: requiredArg(args, ["head", "head_branch", "headBranch", "branch"]),
        title: requiredArg(args, ["title", "name"]),
      });

      return {
        content: [`PR #${pullRequest.number}: ${pullRequest.title}`, `State: ${pullRequest.state}`, `URL: ${pullRequest.htmlUrl}`].join("\n"),
        executed: true,
        sources: [{ title: `PR #${pullRequest.number}`, url: pullRequest.htmlUrl }],
      };
    }
  }
}

async function getRepositoryArgs(args: Record<string, string>, context: GithubToolExecutionContext): Promise<RepositoryArgs> {
  const maybeRepo = await resolveRepositoryArgs(args, context);

  if (!maybeRepo) {
    throw new Error("GitHub needs a specific repository. Include repository=owner/repo, or ask with the repository name.");
  }

  return maybeRepo;
}

async function resolveRepositoryArgs(args: Record<string, string>, context: GithubToolExecutionContext): Promise<RepositoryArgs | undefined> {
  const maybeRepo = maybeRepositoryArgs(args);

  if (maybeRepo.owner && maybeRepo.repo) {
    return {
      owner: maybeRepo.owner,
      repo: maybeRepo.repo,
    };
  }

  const hintText = collectRepositoryHintText(args, context);

  if (!hintText) {
    return undefined;
  }

  const repos = await listGithubRepositories({
    perPage: 100,
    sort: "updated",
    visibility: "all",
  });
  const inferredRepo = inferRepositoryFromText(repos, hintText);

  if (!inferredRepo) {
    return undefined;
  }

  return {
    owner: inferredRepo.ownerLogin,
    repo: inferredRepo.name,
  };
}

async function maybeRepositoryArgsWithInference(args: Record<string, string>, context: GithubToolExecutionContext): Promise<{ owner?: string; repo?: string }> {
  const explicit = maybeRepositoryArgs(args);

  if (explicit.owner && explicit.repo) {
    return explicit;
  }

  return (await resolveRepositoryArgs(args, context)) ?? explicit;
}

function maybeRepositoryArgs(args: Record<string, string>): { owner?: string; repo?: string } {
  const repository = firstArg(args, ["repository", "repo_full_name", "full_name", "fullName"]);
  const split = repository?.split("/");
  const owner = firstArg(args, ["owner", "org", "organization"]) || (split?.length === 2 ? split[0] : undefined);
  const repo = firstArg(args, ["repo", "repository_name", "name"]) || (split?.length === 2 ? split[1] : undefined);

  return {
    owner,
    repo,
  };
}

async function createMissingRepositoryResult(purpose: string): Promise<GithubToolExecutionResult> {
  const repos = await listGithubRepositories({
    perPage: 100,
    sort: "updated",
    visibility: "all",
  });
  const directAnswer = formatRepositorySelectionAnswer(purpose, repos);

  return {
    content: directAnswer,
    directAnswer,
    executed: true,
    sources: repos.slice(0, 12).map((repo) => ({ title: repo.fullName, url: repo.htmlUrl })),
  };
}

function collectRepositoryHintText(args: Record<string, string>, context: GithubToolExecutionContext) {
  return [
    firstArg(args, ["repository", "repo_full_name", "full_name", "fullName", "repo", "repository_name", "name", "query", "q", "search"]),
    Object.values(args).join(" "),
    context.userPrompt,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
}

function inferRepositoryFromText(repos: GithubRepository[], hintText: string) {
  if (repos.length === 1) {
    return repos[0];
  }

  const lowerHint = hintText.toLowerCase();
  const normalizedHint = normalizeRepositoryHint(hintText);
  const scored = repos
    .map((repo) => ({
      repo,
      score: scoreRepositoryMatch(repo, lowerHint, normalizedHint),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  const second = scored[1];

  if (!best) {
    return undefined;
  }

  if (best.score >= 85 || (best.score >= 55 && best.score - (second?.score ?? 0) >= 15)) {
    return best.repo;
  }

  return undefined;
}

function scoreRepositoryMatch(repo: GithubRepository, lowerHint: string, normalizedHint: string) {
  const fullName = repo.fullName.toLowerCase();
  const ownerSlashName = `${repo.ownerLogin}/${repo.name}`.toLowerCase();
  const repoName = repo.name.toLowerCase();
  const fullNameNormalized = normalizeRepositoryHint(repo.fullName);
  const ownerSlashNameNormalized = normalizeRepositoryHint(`${repo.ownerLogin}/${repo.name}`);
  const repoNameNormalized = normalizeRepositoryHint(repo.name);
  let score = 0;

  if (hasPhraseMatch(lowerHint, fullName) || hasPhraseMatch(lowerHint, ownerSlashName)) {
    score += 120;
  }

  if (normalizedHint.includes(fullNameNormalized) || normalizedHint.includes(ownerSlashNameNormalized)) {
    score += 110;
  }

  if (hasPhraseMatch(lowerHint, repoName)) {
    score += 90;
  }

  if (repoNameNormalized.length >= 5 && normalizedHint.includes(repoNameNormalized)) {
    score += 80;
  }

  return score;
}

function hasPhraseMatch(text: string, phrase: string) {
  const trimmedPhrase = phrase.trim();

  if (!trimmedPhrase) {
    return false;
  }

  const escaped = trimmedPhrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[\\/_.-]+/g, "[\\\\/_.\\-\\s]*");
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, "i").test(text);
}

function normalizeRepositoryHint(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function getMissingGithubFullAccessScopes(scopes: string[]) {
  return getMissingRequiredGithubOAuthScopes(scopes);
}

function shouldDirectAnswerRepositoryList(prompt?: string) {
  if (!prompt?.trim()) {
    return true;
  }

  return analyzeGithubPrompt(prompt).intent === "repository_inventory";
}

function parseCommitFiles(args: Record<string, string>): GithubCommitFileInput[] {
  const rawFiles = firstArg(args, ["files_json", "files", "changes", "items"]);

  if (rawFiles) {
    const parsed = JSON.parse(rawFiles) as unknown;
    const items = Array.isArray(parsed)
      ? parsed
      : typeof parsed === "object" && parsed && Array.isArray((parsed as { files?: unknown }).files)
        ? (parsed as { files: unknown[] }).files
        : [];
    const files = items.map(parseCommitFileItem);

    if (files.length > 0) {
      return files;
    }
  }

  const path = firstArg(args, ["path", "file_path", "file"]);

  if (!path) {
    throw new Error("GitHub commit needs files_json or path/content.");
  }

  return [
    {
      content: firstArg(args, ["content", "text", "body"]),
      operation: firstArg(args, ["operation", "action"]) || "upsert",
      path,
    },
  ];
}

function parseCommitFileItem(item: unknown): GithubCommitFileInput {
  if (typeof item !== "object" || !item) {
    throw new Error("Each GitHub commit file must be an object.");
  }

  const value = item as Record<string, unknown>;
  const path = stringify(value.path ?? value.file_path ?? value.file);

  if (!path) {
    throw new Error("Each GitHub commit file needs a path.");
  }

  return {
    content: stringify(value.content ?? value.text ?? value.body),
    operation: stringify(value.operation ?? value.action) || "upsert",
    path,
  };
}

function formatRepositoryList(repos: Awaited<ReturnType<typeof listGithubRepositories>>) {
  if (repos.length === 0) {
    return "No repositories matched.";
  }

  return [
    `Repositories: ${repos.length}`,
    ...repos.map((repo, index) => `${index + 1}. ${repo.fullName} (${repo.private ? "private" : "public"}, default ${repo.defaultBranch})\n   ${repo.htmlUrl}\n   Permissions: ${formatPermissions(repo.permissions)}`),
  ].join("\n");
}

function formatRepositoryListAnswer(repos: Awaited<ReturnType<typeof listGithubRepositories>>) {
  if (repos.length === 0) {
    return "No GitHub repositories matched that request.";
  }

  const owner = commonOwner(repos);
  const heading = owner
    ? `You have ${repos.length} GitHub ${pluralize("repository", repos.length)} under **${owner}**:`
    : `You have ${repos.length} GitHub ${pluralize("repository", repos.length)}:`;

  return [
    heading,
    "",
    ...repos.map((repo, index) => `${index + 1}. **[${repo.fullName}](${repo.htmlUrl})** - ${repo.private ? "Private" : "Public"}, default branch \`${repo.defaultBranch}\`, permissions: ${formatPermissions(repo.permissions)}.`),
  ].join("\n");
}

function formatRepositorySelectionAnswer(purpose: string, repos: GithubRepository[]) {
  if (repos.length === 0) {
    return `I can reach GitHub, but no accessible repositories were returned. I need a specific repository to ${purpose}.`;
  }

  const visibleRepos = repos.slice(0, 20);
  const hiddenCount = Math.max(repos.length - visibleRepos.length, 0);

  return [
    `I need a specific repository to ${purpose}. I can see ${repos.length} accessible GitHub ${pluralize("repository", repos.length)}:`,
    "",
    ...visibleRepos.map((repo, index) => `${index + 1}. **[${repo.fullName}](${repo.htmlUrl})** - ${repo.private ? "Private" : "Public"}, default branch \`${repo.defaultBranch}\`.`),
    hiddenCount > 0 ? `\n${hiddenCount} more repositories are available. Ask with the repo name or \`owner/repo\`.` : "",
    "",
    `Try: \`${purpose} for ${repos[0].fullName}\`.`,
  ].filter(Boolean).join("\n");
}

function formatRepositoryDetail(repo: Awaited<ReturnType<typeof getGithubRepository>>) {
  return [
    `Repository: ${repo.fullName}`,
    `Visibility: ${repo.private ? "private" : "public"}`,
    `Default branch: ${repo.defaultBranch}`,
    `Permissions: ${formatPermissions(repo.permissions)}`,
    repo.description ? `Description: ${repo.description}` : "",
    `URL: ${repo.htmlUrl}`,
  ].filter(Boolean).join("\n");
}

function formatRepositoryDetailAnswer(repo: Awaited<ReturnType<typeof getGithubRepository>>) {
  return [
    `**${repo.fullName}**`,
    "",
    `- Visibility: ${repo.private ? "Private" : "Public"}`,
    `- Default branch: \`${repo.defaultBranch}\``,
    `- Permissions: ${formatPermissions(repo.permissions)}`,
    repo.description ? `- Description: ${repo.description}` : "",
    `- URL: [${repo.htmlUrl}](${repo.htmlUrl})`,
  ].filter(Boolean).join("\n");
}

function formatBranchList(owner: string, repo: string, branches: Awaited<ReturnType<typeof listGithubBranches>>) {
  if (branches.length === 0) {
    return `No branches returned for ${owner}/${repo}.`;
  }

  return [
    `Repository: ${owner}/${repo}`,
    `Branches: ${branches.length}`,
    ...branches.map((branch, index) => `${index + 1}. ${branch.name} (${branch.commitSha.slice(0, 12)}${branch.protected ? ", protected" : ""})`),
  ].join("\n");
}

function formatBranchListAnswer(owner: string, repo: string, branches: Awaited<ReturnType<typeof listGithubBranches>>) {
  if (branches.length === 0) {
    return `No branches were returned for **${owner}/${repo}**.`;
  }

  return [
    `Branches in **${owner}/${repo}**:`,
    "",
    ...branches.map((branch, index) => `${index + 1}. \`${branch.name}\` - ${branch.commitSha.slice(0, 12)}${branch.protected ? ", protected" : ""}.`),
  ].join("\n");
}

function formatTree(tree: Awaited<ReturnType<typeof listGithubTree>>) {
  const rows = tree.entries.map((entry, index) => {
    const size = typeof entry.size === "number" ? ` ${entry.size} bytes` : "";
    return `${index + 1}. [${entry.kind}] ${entry.path}${size} ${entry.sha.slice(0, 12)}`;
  });

  return [
    `Branch: ${tree.branch}`,
    `Commit: ${tree.commitSha}`,
    `Entries: ${tree.entries.length}${tree.truncated ? " (truncated)" : ""}`,
    ...rows,
  ].join("\n");
}

function formatTreeAnswer(owner: string, repo: string, tree: Awaited<ReturnType<typeof listGithubTree>>) {
  const entries = tree.entries.slice(0, 80);
  const hiddenCount = Math.max(tree.entries.length - entries.length, 0);

  return [
    `Remote files in **${owner}/${repo}** on \`${tree.branch}\`:`,
    "",
    ...entries.map((entry, index) => `${index + 1}. \`${entry.path}\` - ${entry.kind}${typeof entry.size === "number" ? `, ${entry.size} bytes` : ""}.`),
    hiddenCount > 0 ? `\n${hiddenCount} more entries were returned but hidden here for readability.` : "",
    tree.truncated ? "\nGitHub marked this tree response as truncated." : "",
  ].filter(Boolean).join("\n");
}

function formatReadFile(file: Awaited<ReturnType<typeof readGithubFile>>) {
  return [
    `Path: ${file.path}`,
    `SHA: ${file.sha}`,
    `Size: ${file.size} bytes${file.truncated ? " (truncated)" : ""}`,
    file.htmlUrl ? `URL: ${file.htmlUrl}` : "",
    "",
    file.content,
  ].filter((line) => line !== undefined).join("\n");
}

function formatCodeSearch(result: Awaited<ReturnType<typeof searchGithubCode>>) {
  if (result.items.length === 0) {
    return `Matches: 0\nTotal count: ${result.totalCount}`;
  }

  return [
    `Matches returned: ${result.items.length}`,
    `Total count: ${result.totalCount}${result.incompleteResults ? " (incomplete)" : ""}`,
    ...result.items.map((item, index) => `${index + 1}. ${item.repositoryFullName}:${item.path} (${item.sha.slice(0, 12)})\n   ${item.htmlUrl}`),
  ].join("\n");
}

function formatPermissions(permissions: { admin: boolean; pull: boolean; push: boolean }) {
  return [
    permissions.pull ? "pull" : "",
    permissions.push ? "push" : "",
    permissions.admin ? "admin" : "",
  ].filter(Boolean).join(", ") || "metadata";
}

function commonOwner(repos: Awaited<ReturnType<typeof listGithubRepositories>>) {
  const owner = repos[0]?.ownerLogin;

  if (!owner) {
    return undefined;
  }

  return repos.every((repo) => repo.ownerLogin === owner) ? owner : undefined;
}

function pluralize(label: string, count: number) {
  return count === 1 ? label : `${label}s`;
}

function requiredArg(args: Record<string, string>, names: string[]) {
  const value = firstArg(args, names);

  if (!value) {
    throw new Error(`Missing required GitHub argument: ${names[0]}.`);
  }

  return value;
}

function firstArg(args: Record<string, string>, names: string[]) {
  for (const name of names) {
    const value = args[normalizeArgName(name)];

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function numberArg(args: Record<string, string>, names: string[]) {
  const raw = firstArg(args, names);
  const value = raw ? Number(raw) : undefined;

  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanArg(args: Record<string, string>, names: string[], fallback: boolean) {
  const raw = firstArg(args, names);

  if (!raw) {
    return fallback;
  }

  return ["1", "true", "yes", "y"].includes(raw.toLowerCase());
}

function stringify(value: unknown) {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value);
}

function normalizeArgName(name: string) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s.-]+/g, "_")
    .toLowerCase();
}
