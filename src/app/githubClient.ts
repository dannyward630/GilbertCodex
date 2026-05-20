import { invoke } from "@tauri-apps/api/core";
import { isTauriDesktopRuntime } from "./tauriClient";
import type {
  GithubBranch,
  GithubApiRequest,
  GithubApiResponse,
  GithubCodeSearchItem,
  GithubCommitFileInput,
  GithubCommitFilesResponse,
  GithubConnectionState,
  GithubDispatchWorkflowResponse,
  GithubDeviceLoginPollResponse,
  GithubDeviceLoginSession,
  GithubPullRequestResponse,
  GithubReadFileResponse,
  GithubReleaseNotesResponse,
  GithubReleaseResponse,
  GithubRepository,
  GithubSearchCodeResponse,
  GithubTreeResponse,
  GithubWorkflowListResponse,
  GithubWorkflowRunListResponse,
} from "../types/github";

export interface GithubListRepositoriesRequest {
  affiliation?: string;
  page?: number;
  perPage?: number;
  query?: string;
  sort?: string;
  visibility?: string;
}

export interface GithubRepositoryRequest {
  owner: string;
  repo: string;
}

export interface GithubListBranchesRequest extends GithubRepositoryRequest {
  page?: number;
  perPage?: number;
}

export interface GithubListTreeRequest extends GithubRepositoryRequest {
  branch?: string;
  limit?: number;
  recursive?: boolean;
}

export interface GithubReadFileRequest extends GithubRepositoryRequest {
  branch?: string;
  maxBytes?: number;
  path: string;
}

export interface GithubSearchCodeRequest {
  branch?: string;
  owner?: string;
  page?: number;
  perPage?: number;
  query: string;
  repo?: string;
}

export interface GithubCreateBranchRequest extends GithubRepositoryRequest {
  baseBranch?: string;
  newBranch: string;
}

export interface GithubCommitFilesRequest extends GithubRepositoryRequest {
  branch?: string;
  files: GithubCommitFileInput[];
  message: string;
}

export interface GithubCreatePullRequestRequest extends GithubRepositoryRequest {
  base: string;
  body?: string;
  draft?: boolean;
  head: string;
  title: string;
}

export interface GithubGenerateReleaseNotesRequest extends GithubRepositoryRequest {
  configurationFilePath?: string;
  previousTagName?: string;
  tagName: string;
  targetCommitish?: string;
}

export interface GithubCreateReleaseRequest extends GithubRepositoryRequest {
  body?: string;
  draft?: boolean;
  generateReleaseNotes?: boolean;
  makeLatest?: "false" | "legacy" | "true" | string;
  name?: string;
  prerelease?: boolean;
  tagName: string;
  targetCommitish?: string;
}

export interface GithubListReleasesRequest extends GithubRepositoryRequest {
  page?: number;
  perPage?: number;
}

export interface GithubListWorkflowsRequest extends GithubRepositoryRequest {
  page?: number;
  perPage?: number;
}

export interface GithubDispatchWorkflowRequest extends GithubRepositoryRequest {
  inputs?: Record<string, unknown>;
  ref: string;
  workflowId: string;
}

export interface GithubListWorkflowRunsRequest extends GithubRepositoryRequest {
  branch?: string;
  event?: string;
  page?: number;
  perPage?: number;
  status?: string;
  workflowId: string;
}

export interface GithubBeginDeviceLoginRequest {
  clientId: string;
  scope?: string;
}

export interface GithubPollDeviceLoginRequest {
  clientId: string;
  deviceCode: string;
}

// Broad GitHub OAuth scope bundle keeps integration actions usable while GitHub still enforces account policy.
export const GITHUB_FULL_ACCESS_OAUTH_SCOPES = [
  "repo",
  "workflow",
  "delete_repo",
  "admin:repo_hook",
  "admin:org",
  "admin:public_key",
  "admin:org_hook",
  "gist",
  "notifications",
  "user",
  "project",
  "write:packages",
  "read:packages",
  "delete:packages",
  "admin:gpg_key",
  "codespace",
  "read:audit_log",
  "security_events",
] as const;

const DEFAULT_GITHUB_OAUTH_SCOPE = GITHUB_FULL_ACCESS_OAUTH_SCOPES.join(" ");

/** Returns true when GitHub API actions can route through the Tauri command layer. */
export function githubDesktopAvailable() {
  return isTauriDesktopRuntime();
}

/** Reads the public OAuth App client ID used by device-flow sign-in. */
export function getDefaultGithubOAuthClientId() {
  return (import.meta.env.VITE_GITHUB_OAUTH_CLIENT_ID ?? "").trim();
}

/** Returns the space-delimited scope string sent to GitHub's device-flow endpoint. */
export function getDefaultGithubOAuthScope() {
  return DEFAULT_GITHUB_OAUTH_SCOPE;
}

/** Returns the app's preferred full-access scope list as individual tokens. */
export function getRequiredGithubOAuthScopes() {
  return [...GITHUB_FULL_ACCESS_OAUTH_SCOPES];
}

/** Compares granted token scopes against the app's preferred full-access bundle. */
export function getMissingRequiredGithubOAuthScopes(scopes: string[]) {
  const grantedScopes = new Set(scopes.map(normalizeGithubOAuthScope));

  return getRequiredGithubOAuthScopes().filter((scope) => !isGithubOAuthScopeGranted(scope, grantedScopes));
}

/** Handles GitHub's implied-scope behavior when deciding whether a reconnect is needed. */
export function isGithubOAuthScopeGranted(scope: string, grantedScopesInput: Iterable<string>) {
  const normalizedScope = normalizeGithubOAuthScope(scope);
  const grantedScopes = grantedScopesInput instanceof Set
    ? grantedScopesInput
    : new Set([...grantedScopesInput].map(normalizeGithubOAuthScope));

  if (grantedScopes.has(normalizedScope)) {
    return true;
  }

  if ((normalizedScope === "admin:repo_hook" || normalizedScope === "security_events") && grantedScopes.has("repo")) {
    return true;
  }

  // GitHub may return a normalized OAuth scope list with implied scopes omitted.
  if (normalizedScope === "read:packages" && grantedScopes.has("write:packages")) {
    return true;
  }

  return false;
}

function normalizeGithubOAuthScope(scope: string) {
  return scope.trim().toLowerCase();
}

export async function getGithubState(): Promise<GithubConnectionState> {
  assertGithubDesktop();
  return invoke<GithubConnectionState>("github_get_state");
}

/** Marks the first-party GitHub plugin installed locally without changing the account token. */
export async function installGithubPlugin(): Promise<GithubConnectionState> {
  assertGithubDesktop();
  return invoke<GithubConnectionState>("github_install_plugin");
}

/** Starts GitHub OAuth device flow and returns the user-code session to show in Settings. */
export async function beginGithubDeviceLogin(request: GithubBeginDeviceLoginRequest): Promise<GithubDeviceLoginSession> {
  assertGithubDesktop();
  return invoke<GithubDeviceLoginSession>("github_begin_device_login", {
    request: {
      clientId: request.clientId,
      scope: request.scope || DEFAULT_GITHUB_OAUTH_SCOPE,
    },
  });
}

/** Opens the verified GitHub device authorization URL in the user's browser. */
export async function openGithubDeviceLogin(verificationUri?: string): Promise<void> {
  assertGithubDesktop();
  return invoke<void>("github_open_device_login", {
    request: {
      verificationUri,
    },
  });
}

/** Polls GitHub device flow; pending authorization is returned as data. */
export async function pollGithubDeviceLogin(request: GithubPollDeviceLoginRequest): Promise<GithubDeviceLoginPollResponse> {
  assertGithubDesktop();
  return invoke<GithubDeviceLoginPollResponse>("github_poll_device_login", {
    request: {
      clientId: request.clientId,
      deviceCode: request.deviceCode,
    },
  });
}

/** Connects with a token pasted by the user and returns the persisted account state. */
export async function connectGithubWithToken(token: string): Promise<GithubConnectionState> {
  assertGithubDesktop();
  return invoke<GithubConnectionState>("github_connect_token", {
    request: {
      token,
    },
  });
}

/** Disconnects GitHub and clears the local token store. */
export async function disconnectGithub(): Promise<GithubConnectionState> {
  assertGithubDesktop();
  return invoke<GithubConnectionState>("github_disconnect");
}

/** Lists repositories visible to the connected account, with optional local filtering. */
export async function listGithubRepositories(request: GithubListRepositoriesRequest = {}): Promise<GithubRepository[]> {
  assertGithubDesktop();
  return invoke<GithubRepository[]>("github_list_repositories", { request });
}

/** Reads normalized metadata for a single repository. */
export async function getGithubRepository(request: GithubRepositoryRequest): Promise<GithubRepository> {
  assertGithubDesktop();
  return invoke<GithubRepository>("github_get_repository", { request });
}

/** Lists branch heads for a repository. */
export async function listGithubBranches(request: GithubListBranchesRequest): Promise<GithubBranch[]> {
  assertGithubDesktop();
  return invoke<GithubBranch[]>("github_list_branches", { request });
}

/** Lists a capped branch tree for remote file discovery. */
export async function listGithubTree(request: GithubListTreeRequest): Promise<GithubTreeResponse> {
  assertGithubDesktop();
  return invoke<GithubTreeResponse>("github_list_tree", { request });
}

/** Reads one text file from a repository branch. */
export async function readGithubFile(request: GithubReadFileRequest): Promise<GithubReadFileResponse> {
  assertGithubDesktop();
  return invoke<GithubReadFileResponse>("github_read_file", { request });
}

/** Searches code through GitHub's API and returns normalized source links. */
export async function searchGithubCode(request: GithubSearchCodeRequest): Promise<GithubSearchCodeResponse> {
  assertGithubDesktop();
  return invoke<GithubSearchCodeResponse>("github_search_code", { request });
}

/** Creates a branch from the default or selected base branch. */
export async function createGithubBranch(request: GithubCreateBranchRequest): Promise<GithubBranch> {
  assertGithubDesktop();
  return invoke<GithubBranch>("github_create_branch", { request });
}

/** Commits one or more file changes directly through GitHub's Git database API. */
export async function commitGithubFiles(request: GithubCommitFilesRequest): Promise<GithubCommitFilesResponse> {
  assertGithubDesktop();
  return invoke<GithubCommitFilesResponse>("github_commit_files", { request });
}

/** Opens a pull request, defaulting to draft behavior in the Rust command. */
export async function createGithubPullRequest(request: GithubCreatePullRequestRequest): Promise<GithubPullRequestResponse> {
  assertGithubDesktop();
  return invoke<GithubPullRequestResponse>("github_create_pull_request", { request });
}

/** Generates release notes through GitHub without creating a release. */
export async function generateGithubReleaseNotes(request: GithubGenerateReleaseNotesRequest): Promise<GithubReleaseNotesResponse> {
  assertGithubDesktop();
  return invoke<GithubReleaseNotesResponse>("github_generate_release_notes", { request });
}

/** Creates a GitHub release through the connected account. */
export async function createGithubRelease(request: GithubCreateReleaseRequest): Promise<GithubReleaseResponse> {
  assertGithubDesktop();
  return invoke<GithubReleaseResponse>("github_create_release", { request });
}

/** Lists releases visible to the connected account. */
export async function listGithubReleases(request: GithubListReleasesRequest): Promise<GithubReleaseResponse[]> {
  assertGithubDesktop();
  return invoke<GithubReleaseResponse[]>("github_list_releases", { request });
}

/** Lists GitHub Actions workflows for a repository. */
export async function listGithubWorkflows(request: GithubListWorkflowsRequest): Promise<GithubWorkflowListResponse> {
  assertGithubDesktop();
  return invoke<GithubWorkflowListResponse>("github_list_workflows", { request });
}

/** Dispatches a workflow_dispatch workflow for a ref and optional inputs. */
export async function dispatchGithubWorkflow(request: GithubDispatchWorkflowRequest): Promise<GithubDispatchWorkflowResponse> {
  assertGithubDesktop();
  return invoke<GithubDispatchWorkflowResponse>("github_dispatch_workflow", { request });
}

/** Lists recent runs for a selected workflow. */
export async function listGithubWorkflowRuns(request: GithubListWorkflowRunsRequest): Promise<GithubWorkflowRunListResponse> {
  assertGithubDesktop();
  return invoke<GithubWorkflowRunListResponse>("github_list_workflow_runs", { request });
}

/** Uses the connected account for advanced GitHub REST API resources not covered by a specific wrapper. */
export async function requestGithubApi(request: GithubApiRequest): Promise<GithubApiResponse> {
  assertGithubDesktop();
  return invoke<GithubApiResponse>("github_api", { request });
}

/** Formats search hits for model-visible output without leaking raw API JSON. */
export function summarizeGithubCodeSearchItems(items: GithubCodeSearchItem[]) {
  return items.map((item, index) => `${index + 1}. ${item.repositoryFullName}:${item.path} (${item.sha.slice(0, 7)})\n${item.htmlUrl}`).join("\n");
}

function assertGithubDesktop() {
  if (!githubDesktopAvailable()) {
    throw new Error("GitHub integration is available in the Tauri desktop app.");
  }
}
