import { invoke } from "@tauri-apps/api/core";
import { isTauriDesktopRuntime } from "./tauriClient";
import type {
  GithubBranch,
  GithubCodeSearchItem,
  GithubCommitFileInput,
  GithubCommitFilesResponse,
  GithubConnectionState,
  GithubDeviceLoginPollResponse,
  GithubDeviceLoginSession,
  GithubPullRequestResponse,
  GithubReadFileResponse,
  GithubRepository,
  GithubSearchCodeResponse,
  GithubTreeResponse,
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

export interface GithubBeginDeviceLoginRequest {
  clientId: string;
  scope?: string;
}

export interface GithubPollDeviceLoginRequest {
  clientId: string;
  deviceCode: string;
}

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

export function githubDesktopAvailable() {
  return isTauriDesktopRuntime();
}

export function getDefaultGithubOAuthClientId() {
  return (import.meta.env.VITE_GITHUB_OAUTH_CLIENT_ID ?? "").trim();
}

export function getDefaultGithubOAuthScope() {
  return DEFAULT_GITHUB_OAUTH_SCOPE;
}

export function getRequiredGithubOAuthScopes() {
  return [...GITHUB_FULL_ACCESS_OAUTH_SCOPES];
}

export function getMissingRequiredGithubOAuthScopes(scopes: string[]) {
  const grantedScopes = new Set(scopes.map(normalizeGithubOAuthScope));

  return getRequiredGithubOAuthScopes().filter((scope) => !isGithubOAuthScopeGranted(scope, grantedScopes));
}

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

export async function beginGithubDeviceLogin(request: GithubBeginDeviceLoginRequest): Promise<GithubDeviceLoginSession> {
  assertGithubDesktop();
  return invoke<GithubDeviceLoginSession>("github_begin_device_login", {
    request: {
      clientId: request.clientId,
      scope: request.scope || DEFAULT_GITHUB_OAUTH_SCOPE,
    },
  });
}

export async function openGithubDeviceLogin(verificationUri?: string): Promise<void> {
  assertGithubDesktop();
  return invoke<void>("github_open_device_login", {
    request: {
      verificationUri,
    },
  });
}

export async function pollGithubDeviceLogin(request: GithubPollDeviceLoginRequest): Promise<GithubDeviceLoginPollResponse> {
  assertGithubDesktop();
  return invoke<GithubDeviceLoginPollResponse>("github_poll_device_login", {
    request: {
      clientId: request.clientId,
      deviceCode: request.deviceCode,
    },
  });
}

export async function connectGithubWithToken(token: string): Promise<GithubConnectionState> {
  assertGithubDesktop();
  return invoke<GithubConnectionState>("github_connect_token", {
    request: {
      token,
    },
  });
}

export async function disconnectGithub(): Promise<GithubConnectionState> {
  assertGithubDesktop();
  return invoke<GithubConnectionState>("github_disconnect");
}

export async function listGithubRepositories(request: GithubListRepositoriesRequest = {}): Promise<GithubRepository[]> {
  assertGithubDesktop();
  return invoke<GithubRepository[]>("github_list_repositories", { request });
}

export async function getGithubRepository(request: GithubRepositoryRequest): Promise<GithubRepository> {
  assertGithubDesktop();
  return invoke<GithubRepository>("github_get_repository", { request });
}

export async function listGithubBranches(request: GithubListBranchesRequest): Promise<GithubBranch[]> {
  assertGithubDesktop();
  return invoke<GithubBranch[]>("github_list_branches", { request });
}

export async function listGithubTree(request: GithubListTreeRequest): Promise<GithubTreeResponse> {
  assertGithubDesktop();
  return invoke<GithubTreeResponse>("github_list_tree", { request });
}

export async function readGithubFile(request: GithubReadFileRequest): Promise<GithubReadFileResponse> {
  assertGithubDesktop();
  return invoke<GithubReadFileResponse>("github_read_file", { request });
}

export async function searchGithubCode(request: GithubSearchCodeRequest): Promise<GithubSearchCodeResponse> {
  assertGithubDesktop();
  return invoke<GithubSearchCodeResponse>("github_search_code", { request });
}

export async function createGithubBranch(request: GithubCreateBranchRequest): Promise<GithubBranch> {
  assertGithubDesktop();
  return invoke<GithubBranch>("github_create_branch", { request });
}

export async function commitGithubFiles(request: GithubCommitFilesRequest): Promise<GithubCommitFilesResponse> {
  assertGithubDesktop();
  return invoke<GithubCommitFilesResponse>("github_commit_files", { request });
}

export async function createGithubPullRequest(request: GithubCreatePullRequestRequest): Promise<GithubPullRequestResponse> {
  assertGithubDesktop();
  return invoke<GithubPullRequestResponse>("github_create_pull_request", { request });
}

export function summarizeGithubCodeSearchItems(items: GithubCodeSearchItem[]) {
  return items.map((item, index) => `${index + 1}. ${item.repositoryFullName}:${item.path} (${item.sha.slice(0, 7)})\n${item.htmlUrl}`).join("\n");
}

function assertGithubDesktop() {
  if (!githubDesktopAvailable()) {
    throw new Error("GitHub tools are available in the Tauri desktop app.");
  }
}
