// Shared GitHub desktop contracts mirror Rust Tauri camelCase payloads, not raw REST fields.
export interface GithubUser {
  avatarUrl?: string;
  htmlUrl: string;
  id: number;
  login: string;
  name?: string;
}

/** Current local GitHub account state stored by the desktop command layer. */
export interface GithubConnectionState {
  connected: boolean;
  connectedAt?: number;
  pluginInstalled: boolean;
  pluginInstalledAt?: number;
  scopes: string[];
  user?: GithubUser;
}

/** Device-flow session details displayed while the user authorizes in a browser. */
export interface GithubDeviceLoginSession {
  deviceCode: string;
  expiresIn: number;
  interval: number;
  scope: string;
  userCode: string;
  verificationUri: string;
}

export type GithubDeviceLoginStatus = "authorized" | "denied" | "error" | "expired" | "pending" | "slowDown";

/** Poll response intentionally models pending/error states as data, not thrown errors. */
export interface GithubDeviceLoginPollResponse {
  connection?: GithubConnectionState;
  error?: string;
  interval?: number;
  message?: string;
  status: GithubDeviceLoginStatus;
}

export interface GithubRepositoryPermissions {
  admin: boolean;
  pull: boolean;
  push: boolean;
}

/** Repository summary normalized from GitHub REST responses for UI and tool output. */
export interface GithubRepository {
  archived?: boolean;
  defaultBranch: string;
  description?: string;
  disabled?: boolean;
  fork?: boolean;
  forksCount?: number;
  fullName: string;
  htmlUrl: string;
  language?: string;
  name: string;
  openIssuesCount?: number;
  ownerLogin: string;
  permissions: GithubRepositoryPermissions;
  private: boolean;
  pushedAt?: string;
  stargazersCount?: number;
  updatedAt?: string;
  watchersCount?: number;
}

export type GithubApiMethod = "DELETE" | "GET" | "PATCH" | "POST" | "PUT";

export interface GithubApiRequest {
  body?: unknown;
  method: GithubApiMethod;
  path: string;
  query?: Record<string, unknown>;
}

/** Generic GitHub REST response for advanced resources not modeled as dedicated contracts. */
export interface GithubApiResponse {
  data: unknown;
  message: string;
  method: GithubApiMethod;
  path: string;
  status: number;
}

/** Branch ref returned by list/create branch commands. */
export interface GithubBranch {
  commitSha: string;
  name: string;
  protected: boolean;
}

/** File tree entry from GitHub's Git Trees API after local result capping. */
export interface GithubTreeEntry {
  kind: string;
  mode?: string;
  path: string;
  sha: string;
  size?: number;
  url?: string;
}

export interface GithubTreeResponse {
  branch: string;
  commitSha: string;
  entries: GithubTreeEntry[];
  truncated: boolean;
}

/** Text-file read result; binary files are rejected before reaching the frontend. */
export interface GithubReadFileResponse {
  branch?: string;
  content: string;
  downloadUrl?: string;
  encoding?: string;
  htmlUrl?: string;
  name: string;
  path: string;
  sha: string;
  size: number;
  truncated: boolean;
}

export interface GithubCodeSearchItem {
  htmlUrl: string;
  name: string;
  path: string;
  repositoryFullName: string;
  score: number;
  sha: string;
}

export interface GithubSearchCodeResponse {
  incompleteResults: boolean;
  items: GithubCodeSearchItem[];
  totalCount: number;
}

/** One file mutation inside a GitHub API commit batch. */
export interface GithubCommitFileInput {
  content?: string;
  operation?: "delete" | "remove" | "upsert" | "write" | string;
  path: string;
}

export interface GithubCommitFilesResponse {
  branch: string;
  commitHtmlUrl: string;
  commitSha: string;
  filesChanged: number;
  parentSha: string;
}

export interface GithubPullRequestResponse {
  htmlUrl: string;
  number: number;
  state: string;
  title: string;
}

/** GitHub-generated Markdown release notes preview. */
export interface GithubReleaseNotesResponse {
  body: string;
  name: string;
}

/** Release metadata returned after create/list release commands. */
export interface GithubReleaseResponse {
  body?: string;
  draft: boolean;
  htmlUrl: string;
  id: number;
  name?: string;
  prerelease: boolean;
  publishedAt?: string;
  tagName: string;
}

/** GitHub Actions workflow metadata normalized for Settings/tool output. */
export interface GithubWorkflow {
  badgeUrl: string;
  createdAt: string;
  htmlUrl: string;
  id: number;
  name: string;
  path: string;
  state: string;
  updatedAt: string;
}

export interface GithubWorkflowListResponse {
  totalCount: number;
  workflows: GithubWorkflow[];
}

/** Confirmation payload after requesting a workflow_dispatch run. */
export interface GithubDispatchWorkflowResponse {
  refName: string;
  workflowId: string;
}

/** GitHub Actions run metadata for recent workflow-run inspection. */
export interface GithubWorkflowRun {
  branch?: string;
  conclusion?: string;
  createdAt: string;
  event: string;
  headSha: string;
  htmlUrl: string;
  id: number;
  name?: string;
  runNumber: number;
  status?: string;
  updatedAt: string;
}

export interface GithubWorkflowRunListResponse {
  runs: GithubWorkflowRun[];
  totalCount: number;
}
