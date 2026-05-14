import type { JsonValue, ToolDefinition, ToolExecutionResult } from "../../types";
import type { GithubBackend } from "./backend";
import {
  booleanArg,
  createDryRunData,
  createErrorResult,
  formatGithubRepository,
  formatRepositoryList,
  integerArg,
  optionalStringArg,
  readErrorMessage,
  stringArg,
} from "./format";

export function createGithubTools(backend: GithubBackend): ToolDefinition[] {
  return [
    createGithubAccountTool(backend),
    createGithubListRepositoriesTool(backend),
    createGithubGetRepositoryTool(backend),
    createGithubListBranchesTool(backend),
    createGithubListTreeTool(backend),
    createGithubReadFileTool(backend),
    createGithubSearchCodeTool(backend),
    createGithubCreateBranchTool(backend),
    createGithubCommitFilesTool(backend),
    createGithubCreatePullRequestTool(backend),
    createGithubGenerateReleaseNotesTool(backend),
    createGithubListReleasesTool(backend),
    createGithubCreateReleaseTool(backend),
    createGithubListWorkflowsTool(backend),
    createGithubListWorkflowRunsTool(backend),
    createGithubDispatchWorkflowTool(backend),
  ];
}

function createGithubAccountTool(backend: GithubBackend): ToolDefinition {
  return githubReadTool({
    description: "Inspect the connected GitHub account state without exposing tokens.",
    execute: async () => {
      try {
        const state = await backend.account();
        return {
          content: state.connected && state.user
            ? `GitHub connected as ${state.user.login}. Scopes: ${state.scopes.join(", ") || "none reported"}.`
            : "GitHub is not connected in Settings.",
          data: state as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not read GitHub account state."));
      }
    },
    id: "github_account",
    inputSchema: { additionalProperties: false, properties: {}, type: "object" },
    title: "Check GitHub account",
  });
}

function createGithubListRepositoriesTool(backend: GithubBackend): ToolDefinition {
  return githubReadTool({
    description: "List repositories visible to the connected GitHub account.",
    execute: async (args) => {
      try {
        const repos = await backend.listRepositories({
          affiliation: optionalStringArg(args.affiliation),
          page: integerArg(args.page),
          perPage: integerArg(args.perPage),
          query: optionalStringArg(args.query),
          sort: optionalStringArg(args.sort),
          visibility: optionalStringArg(args.visibility),
        });
        return {
          content: formatRepositoryList(repos),
          data: { repositories: repos } as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not list GitHub repositories."));
      }
    },
    id: "github_list_repositories",
    inputSchema: {
      additionalProperties: false,
      properties: {
        affiliation: { description: "owner, collaborator, organization_member, or comma-separated values.", minLength: 1, type: "string" },
        page: { minimum: 1, type: "integer" },
        perPage: { minimum: 1, type: "integer" },
        query: { description: "Optional local repository-name filter.", minLength: 1, type: "string" },
        sort: { description: "GitHub repository sort option.", minLength: 1, type: "string" },
        visibility: { description: "all, public, or private.", minLength: 1, type: "string" },
      },
      type: "object",
    },
    title: "List GitHub repositories",
  });
}

function createGithubGetRepositoryTool(backend: GithubBackend): ToolDefinition {
  return githubReadTool({
    description: "Read metadata for one GitHub repository.",
    execute: async (args) => {
      const repo = readRepositoryArgs(args);
      if ("error" in repo) {
        return repo.error;
      }

      try {
        const repository = await backend.getRepository(repo);
        return {
          content: formatGithubRepository(repository),
          data: repository as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not read GitHub repository."));
      }
    },
    id: "github_get_repository",
    inputSchema: repositorySchema(),
    title: "Get GitHub repository",
  });
}

function createGithubListBranchesTool(backend: GithubBackend): ToolDefinition {
  return githubReadTool({
    description: "List branch heads for a GitHub repository.",
    execute: async (args) => {
      const repo = readRepositoryArgs(args);
      if ("error" in repo) {
        return repo.error;
      }

      try {
        const branches = await backend.listBranches({
          ...repo,
          page: integerArg(args.page),
          perPage: integerArg(args.perPage),
        });
        return {
          content: branches.length
            ? branches.map((branch, index) => `${index + 1}. ${branch.name} (${branch.commitSha.slice(0, 7)}${branch.protected ? ", protected" : ""})`).join("\n")
            : "No branches returned.",
          data: { branches } as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not list GitHub branches."));
      }
    },
    id: "github_list_branches",
    inputSchema: repositorySchema({
      page: { minimum: 1, type: "integer" },
      perPage: { minimum: 1, type: "integer" },
    }),
    title: "List GitHub branches",
  });
}

function createGithubListTreeTool(backend: GithubBackend): ToolDefinition {
  return githubReadTool({
    description: "List a repository file tree for remote project discovery.",
    execute: async (args) => {
      const repo = readRepositoryArgs(args);
      if ("error" in repo) {
        return repo.error;
      }

      try {
        const tree = await backend.listTree({
          ...repo,
          branch: optionalStringArg(args.branch),
          limit: integerArg(args.limit),
          recursive: args.recursive !== false,
        });
        const entries = tree.entries.map((entry, index) => `${index + 1}. ${entry.kind} ${entry.path}${entry.size ? ` (${entry.size} bytes)` : ""}`);
        return {
          content: [
            `Tree for ${repo.owner}/${repo.repo}@${tree.branch} (${tree.commitSha.slice(0, 7)}):`,
            ...entries,
            tree.truncated ? "Result was truncated by the GitHub tree command." : undefined,
          ].filter(Boolean).join("\n"),
          data: tree as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not list GitHub repository tree."));
      }
    },
    id: "github_list_tree",
    inputSchema: repositorySchema({
      branch: { minLength: 1, type: "string" },
      limit: { minimum: 1, type: "integer" },
      recursive: { type: "boolean" },
    }),
    title: "List GitHub repository tree",
  });
}

function createGithubReadFileTool(backend: GithubBackend): ToolDefinition {
  return githubReadTool({
    description: "Read one text file from a GitHub repository branch.",
    execute: async (args) => {
      const repo = readRepositoryArgs(args);
      if ("error" in repo) {
        return repo.error;
      }

      const path = stringArg(args.path);
      if (!path) {
        return createErrorResult("A GitHub file path is required.");
      }

      try {
        const file = await backend.readFile({
          ...repo,
          branch: optionalStringArg(args.branch),
          maxBytes: integerArg(args.maxBytes),
          path,
        });
        return {
          content: [
            `Read ${repo.owner}/${repo.repo}:${file.path}${file.branch ? ` on ${file.branch}` : ""}${file.truncated ? " (truncated)" : ""}.`,
            "",
            file.content,
          ].join("\n"),
          data: file as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not read GitHub file."));
      }
    },
    id: "github_read_file",
    inputSchema: repositorySchema({
      branch: { minLength: 1, type: "string" },
      maxBytes: { minimum: 1, type: "integer" },
      path: { minLength: 1, type: "string" },
    }, ["owner", "repo", "path"]),
    title: "Read GitHub file",
  });
}

function createGithubSearchCodeTool(backend: GithubBackend): ToolDefinition {
  return githubReadTool({
    description: "Search code through the GitHub API. Scope with owner, repo, and branch when possible.",
    execute: async (args) => {
      const query = stringArg(args.query);
      if (!query) {
        return createErrorResult("A GitHub code search query is required.");
      }

      try {
        const response = await backend.searchCode({
          branch: optionalStringArg(args.branch),
          owner: optionalStringArg(args.owner),
          page: integerArg(args.page),
          perPage: integerArg(args.perPage),
          query,
          repo: optionalStringArg(args.repo),
        });
        return {
          content: response.items.length
            ? [
                `GitHub code search returned ${response.items.length} of ${response.totalCount} result${response.totalCount === 1 ? "" : "s"}${response.incompleteResults ? " (incomplete)" : ""}.`,
                "",
                backend.summarizeCodeSearchItems(response.items),
              ].join("\n")
            : "No GitHub code search results matched.",
          data: response as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not search GitHub code."));
      }
    },
    id: "github_search_code",
    inputSchema: {
      additionalProperties: false,
      properties: {
        branch: { minLength: 1, type: "string" },
        owner: { minLength: 1, type: "string" },
        page: { minimum: 1, type: "integer" },
        perPage: { minimum: 1, type: "integer" },
        query: { minLength: 1, type: "string" },
        repo: { minLength: 1, type: "string" },
      },
      required: ["query"],
      type: "object",
    },
    title: "Search GitHub code",
  });
}

function createGithubCreateBranchTool(backend: GithubBackend): ToolDefinition {
  return githubPublishTool({
    description: "Create a branch in a GitHub repository from the default branch or a selected base branch.",
    execute: async (args) => {
      const repo = readRepositoryArgs(args);
      if ("error" in repo) {
        return repo.error;
      }
      const newBranch = stringArg(args.newBranch);
      if (!newBranch) {
        return createErrorResult("newBranch is required.");
      }
      const request = { ...repo, baseBranch: optionalStringArg(args.baseBranch), newBranch };

      try {
        if (booleanArg(args.dryRun)) {
          return dryRunResult(`Dry run: would create branch ${newBranch} in ${repo.owner}/${repo.repo}.`, request);
        }
        const branch = await backend.createBranch(request);
        return {
          content: `Created branch ${branch.name} at ${branch.commitSha.slice(0, 7)}.`,
          data: branch as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not create GitHub branch."));
      }
    },
    id: "github_create_branch",
    inputSchema: repositorySchema({
      baseBranch: { minLength: 1, type: "string" },
      dryRun: { type: "boolean" },
      newBranch: { minLength: 1, type: "string" },
    }, ["owner", "repo", "newBranch"]),
    title: "Create GitHub branch",
  });
}

function createGithubCommitFilesTool(backend: GithubBackend): ToolDefinition {
  return githubPublishTool({
    description: "Commit one or more file writes/deletes directly through the GitHub API. Supports dryRun approval previews.",
    execute: async (args) => {
      const repo = readRepositoryArgs(args);
      if ("error" in repo) {
        return repo.error;
      }
      const message = stringArg(args.message);
      const files = normalizeCommitFiles(args.files);
      if (!message) {
        return createErrorResult("A commit message is required.");
      }
      if (files.length === 0) {
        return createErrorResult("At least one file change is required.");
      }
      const request = { ...repo, branch: optionalStringArg(args.branch), files, message };

      try {
        if (booleanArg(args.dryRun)) {
          return dryRunResult(`Dry run: would commit ${files.length} file${files.length === 1 ? "" : "s"} to ${repo.owner}/${repo.repo}${request.branch ? ` on ${request.branch}` : ""}.`, {
            ...request,
            files: files.map((file) => ({ operation: file.operation ?? "write", path: file.path })),
          });
        }
        const result = await backend.commitFiles(request);
        return {
          content: `Committed ${result.filesChanged} file${result.filesChanged === 1 ? "" : "s"} to ${repo.owner}/${repo.repo}@${result.branch}: ${result.commitHtmlUrl}`,
          data: result as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not commit files to GitHub."));
      }
    },
    id: "github_commit_files",
    inputSchema: repositorySchema({
      branch: { minLength: 1, type: "string" },
      dryRun: { type: "boolean" },
      files: {
        items: {
          additionalProperties: false,
          properties: {
            content: { type: "string" },
            operation: { enum: ["delete", "remove", "upsert", "write"], type: "string" },
            path: { minLength: 1, type: "string" },
          },
          required: ["path"],
          type: "object",
        },
        minItems: 1,
        type: "array",
      },
      message: { minLength: 1, type: "string" },
    }, ["owner", "repo", "files", "message"]),
    title: "Commit GitHub files",
  });
}

function createGithubCreatePullRequestTool(backend: GithubBackend): ToolDefinition {
  return githubPublishTool({
    description: "Create a GitHub pull request, defaulting to draft when requested.",
    execute: async (args) => {
      const repo = readRepositoryArgs(args);
      if ("error" in repo) {
        return repo.error;
      }
      const base = stringArg(args.base);
      const head = stringArg(args.head);
      const title = stringArg(args.title);
      if (!base || !head || !title) {
        return createErrorResult("base, head, and title are required.");
      }
      const request = {
        ...repo,
        base,
        body: optionalStringArg(args.body),
        draft: args.draft !== false,
        head,
        title,
      };

      try {
        if (booleanArg(args.dryRun)) {
          return dryRunResult(`Dry run: would open ${request.draft ? "draft " : ""}PR ${head} -> ${base} in ${repo.owner}/${repo.repo}.`, request);
        }
        const pr = await backend.createPullRequest(request);
        return {
          content: `Created PR #${pr.number}: ${pr.title}\n${pr.htmlUrl}`,
          data: pr as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not create GitHub pull request."));
      }
    },
    id: "github_create_pull_request",
    inputSchema: repositorySchema({
      base: { minLength: 1, type: "string" },
      body: { type: "string" },
      draft: { type: "boolean" },
      dryRun: { type: "boolean" },
      head: { minLength: 1, type: "string" },
      title: { minLength: 1, type: "string" },
    }, ["owner", "repo", "base", "head", "title"]),
    title: "Create GitHub pull request",
  });
}

function createGithubGenerateReleaseNotesTool(backend: GithubBackend): ToolDefinition {
  return githubReadTool({
    description: "Generate GitHub release notes for a tag without creating the release.",
    execute: async (args) => {
      const repo = readRepositoryArgs(args);
      if ("error" in repo) {
        return repo.error;
      }
      const tagName = stringArg(args.tagName);
      if (!tagName) {
        return createErrorResult("tagName is required.");
      }

      try {
        const notes = await backend.generateReleaseNotes({
          ...repo,
          configurationFilePath: optionalStringArg(args.configurationFilePath),
          previousTagName: optionalStringArg(args.previousTagName),
          tagName,
          targetCommitish: optionalStringArg(args.targetCommitish),
        });
        return {
          content: [`Release notes for ${tagName}:`, "", notes.body].join("\n"),
          data: notes as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not generate GitHub release notes."));
      }
    },
    id: "github_generate_release_notes",
    inputSchema: releaseNotesSchema(),
    title: "Generate GitHub release notes",
  });
}

function createGithubListReleasesTool(backend: GithubBackend): ToolDefinition {
  return githubReadTool({
    description: "List releases for a GitHub repository.",
    execute: async (args) => {
      const repo = readRepositoryArgs(args);
      if ("error" in repo) {
        return repo.error;
      }

      try {
        const releases = await backend.listReleases({
          ...repo,
          page: integerArg(args.page),
          perPage: integerArg(args.perPage),
        });
        return {
          content: releases.length
            ? releases.map((release, index) => `${index + 1}. ${release.tagName}${release.name ? ` - ${release.name}` : ""}${release.draft ? " (draft)" : ""}\n${release.htmlUrl}`).join("\n")
            : "No releases returned.",
          data: { releases } as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not list GitHub releases."));
      }
    },
    id: "github_list_releases",
    inputSchema: repositorySchema({
      page: { minimum: 1, type: "integer" },
      perPage: { minimum: 1, type: "integer" },
    }),
    title: "List GitHub releases",
  });
}

function createGithubCreateReleaseTool(backend: GithubBackend): ToolDefinition {
  return githubPublishTool({
    description: "Create a GitHub release through the connected account.",
    execute: async (args) => {
      const repo = readRepositoryArgs(args);
      if ("error" in repo) {
        return repo.error;
      }
      const tagName = stringArg(args.tagName);
      if (!tagName) {
        return createErrorResult("tagName is required.");
      }
      const request = {
        ...repo,
        body: optionalStringArg(args.body),
        draft: args.draft !== false,
        generateReleaseNotes: booleanArg(args.generateReleaseNotes),
        makeLatest: optionalStringArg(args.makeLatest),
        name: optionalStringArg(args.name),
        prerelease: booleanArg(args.prerelease),
        tagName,
        targetCommitish: optionalStringArg(args.targetCommitish),
      };

      try {
        if (booleanArg(args.dryRun)) {
          return dryRunResult(`Dry run: would create ${request.draft ? "draft " : ""}release ${tagName} in ${repo.owner}/${repo.repo}.`, request);
        }
        const release = await backend.createRelease(request);
        return {
          content: `Created release ${release.tagName}: ${release.htmlUrl}`,
          data: release as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not create GitHub release."));
      }
    },
    id: "github_create_release",
    inputSchema: repositorySchema({
      body: { type: "string" },
      draft: { type: "boolean" },
      dryRun: { type: "boolean" },
      generateReleaseNotes: { type: "boolean" },
      makeLatest: { minLength: 1, type: "string" },
      name: { minLength: 1, type: "string" },
      prerelease: { type: "boolean" },
      tagName: { minLength: 1, type: "string" },
      targetCommitish: { minLength: 1, type: "string" },
    }, ["owner", "repo", "tagName"]),
    title: "Create GitHub release",
  });
}

function createGithubListWorkflowsTool(backend: GithubBackend): ToolDefinition {
  return githubReadTool({
    description: "List GitHub Actions workflows for a repository.",
    execute: async (args) => {
      const repo = readRepositoryArgs(args);
      if ("error" in repo) {
        return repo.error;
      }

      try {
        const result = await backend.listWorkflows({
          ...repo,
          page: integerArg(args.page),
          perPage: integerArg(args.perPage),
        });
        return {
          content: result.workflows.length
            ? result.workflows.map((workflow, index) => `${index + 1}. ${workflow.name} (${workflow.state}) ${workflow.path}\n${workflow.htmlUrl}`).join("\n")
            : "No workflows returned.",
          data: result as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not list GitHub workflows."));
      }
    },
    id: "github_list_workflows",
    inputSchema: repositorySchema({
      page: { minimum: 1, type: "integer" },
      perPage: { minimum: 1, type: "integer" },
    }),
    title: "List GitHub workflows",
  });
}

function createGithubListWorkflowRunsTool(backend: GithubBackend): ToolDefinition {
  return githubReadTool({
    description: "List recent GitHub Actions workflow runs.",
    execute: async (args) => {
      const repo = readRepositoryArgs(args);
      if ("error" in repo) {
        return repo.error;
      }
      const workflowId = stringArg(args.workflowId);
      if (!workflowId) {
        return createErrorResult("workflowId is required.");
      }

      try {
        const result = await backend.listWorkflowRuns({
          ...repo,
          branch: optionalStringArg(args.branch),
          event: optionalStringArg(args.event),
          page: integerArg(args.page),
          perPage: integerArg(args.perPage),
          status: optionalStringArg(args.status),
          workflowId,
        });
        return {
          content: result.runs.length
            ? result.runs.map((run, index) => `${index + 1}. #${run.runNumber} ${run.name ?? workflowId} - ${run.status ?? "unknown"}${run.conclusion ? `/${run.conclusion}` : ""} ${run.branch ? `on ${run.branch}` : ""}\n${run.htmlUrl}`).join("\n")
            : "No workflow runs returned.",
          data: result as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not list GitHub workflow runs."));
      }
    },
    id: "github_list_workflow_runs",
    inputSchema: repositorySchema({
      branch: { minLength: 1, type: "string" },
      event: { minLength: 1, type: "string" },
      page: { minimum: 1, type: "integer" },
      perPage: { minimum: 1, type: "integer" },
      status: { minLength: 1, type: "string" },
      workflowId: { minLength: 1, type: "string" },
    }, ["owner", "repo", "workflowId"]),
    title: "List GitHub workflow runs",
  });
}

function createGithubDispatchWorkflowTool(backend: GithubBackend): ToolDefinition {
  return githubPublishTool({
    description: "Dispatch a GitHub Actions workflow_dispatch workflow for a selected ref.",
    execute: async (args) => {
      const repo = readRepositoryArgs(args);
      if ("error" in repo) {
        return repo.error;
      }
      const workflowId = stringArg(args.workflowId);
      const ref = stringArg(args.ref);
      if (!workflowId || !ref) {
        return createErrorResult("workflowId and ref are required.");
      }
      const inputs = args.inputs && typeof args.inputs === "object" && !Array.isArray(args.inputs)
        ? args.inputs as Record<string, unknown>
        : undefined;
      const request = { ...repo, inputs, ref, workflowId };

      try {
        if (booleanArg(args.dryRun)) {
          return dryRunResult(`Dry run: would dispatch workflow ${workflowId} on ${ref} in ${repo.owner}/${repo.repo}.`, request);
        }
        const result = await backend.dispatchWorkflow(request);
        return {
          content: `Dispatched workflow ${result.workflowId} on ${result.refName}.`,
          data: result as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        return createErrorResult(readErrorMessage(error, "Could not dispatch GitHub workflow."));
      }
    },
    id: "github_dispatch_workflow",
    inputSchema: repositorySchema({
      dryRun: { type: "boolean" },
      inputs: { additionalProperties: true, type: "object" },
      ref: { minLength: 1, type: "string" },
      workflowId: { minLength: 1, type: "string" },
    }, ["owner", "repo", "workflowId", "ref"]),
    title: "Dispatch GitHub workflow",
  });
}

function githubReadTool(tool: Omit<ToolDefinition, "executorMetadata" | "permission" | "risk">): ToolDefinition {
  return {
    ...tool,
    executorMetadata: { family: "git", version: 1 },
    permission: "read-only",
    risk: "read",
  };
}

function githubPublishTool(tool: Omit<ToolDefinition, "executorMetadata" | "permission" | "risk">): ToolDefinition {
  return {
    ...tool,
    executorMetadata: { family: "git", version: 1 },
    permission: "publish",
    risk: "publish",
  };
}

function readRepositoryArgs(args: Record<string, unknown>): { owner: string; repo: string } | { error: ToolExecutionResult } {
  const owner = stringArg(args.owner);
  const repo = stringArg(args.repo);

  if (!owner || !repo) {
    return { error: createErrorResult("owner and repo are required.") };
  }

  return { owner, repo };
}

function repositorySchema(extraProperties: Record<string, unknown> = {}, required: string[] = ["owner", "repo"]) {
  return {
    additionalProperties: false,
    properties: {
      owner: { description: "Repository owner or organization.", minLength: 1, type: "string" },
      repo: { description: "Repository name.", minLength: 1, type: "string" },
      ...extraProperties,
    },
    required,
    type: "object",
  };
}

function releaseNotesSchema() {
  return repositorySchema({
    configurationFilePath: { minLength: 1, type: "string" },
    previousTagName: { minLength: 1, type: "string" },
    tagName: { minLength: 1, type: "string" },
    targetCommitish: { minLength: 1, type: "string" },
  }, ["owner", "repo", "tagName"]);
}

function normalizeCommitFiles(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return [];
    }

    const record = item as Record<string, unknown>;
    const path = stringArg(record.path);

    if (!path) {
      return [];
    }

    return [{
      content: typeof record.content === "string" ? record.content : undefined,
      operation: optionalStringArg(record.operation),
      path,
    }];
  });
}

function dryRunResult(content: string, request: Record<string, unknown>): ToolExecutionResult {
  return {
    content,
    data: createDryRunData(request) as JsonValue,
    ok: true,
  };
}
