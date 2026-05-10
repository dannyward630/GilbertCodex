export interface GithubUser {
  avatarUrl?: string;
  htmlUrl: string;
  id: number;
  login: string;
  name?: string;
}

export interface GithubConnectionState {
  connected: boolean;
  connectedAt?: number;
  scopes: string[];
  user?: GithubUser;
}

export interface GithubDeviceLoginSession {
  deviceCode: string;
  expiresIn: number;
  interval: number;
  scope: string;
  userCode: string;
  verificationUri: string;
}

export type GithubDeviceLoginStatus = "authorized" | "denied" | "error" | "expired" | "pending" | "slowDown";

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

export interface GithubRepository {
  defaultBranch: string;
  description?: string;
  fullName: string;
  htmlUrl: string;
  name: string;
  ownerLogin: string;
  permissions: GithubRepositoryPermissions;
  private: boolean;
  pushedAt?: string;
  updatedAt?: string;
}

export interface GithubBranch {
  commitSha: string;
  name: string;
  protected: boolean;
}

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
