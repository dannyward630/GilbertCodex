//! GitHub desktop commands.
//!
//! This module owns the native side of the GitHub integration: local token
//! storage, OAuth device flow, REST API normalization, and source-control
//! operations that do not require a local clone or GitHub CLI installation.

use crate::{
    commands::auth,
    core::storage::{self, SYSTEM_NAMESPACE},
};
use base64::{engine::general_purpose, Engine as _};
use reqwest::Method;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    path::PathBuf,
    process::Command,
    sync::Mutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::Manager;

const GITHUB_API_URL: &str = "https://api.github.com";
const GITHUB_API_VERSION: &str = "2022-11-28";
const GITHUB_DEVICE_CODE_URL: &str = "https://github.com/login/device/code";
const GITHUB_DEVICE_VERIFICATION_URL: &str = "https://github.com/login/device";
const GITHUB_OAUTH_TOKEN_URL: &str = "https://github.com/login/oauth/access_token";
const GITHUB_DATABASE_FILE: &str = "github-account.json";
const GITHUB_DATABASE_STORAGE_KEY: &str = "github-account.v1";
const GITHUB_DATABASE_GENERATION: u32 = 1;
const USER_AGENT: &str = "GilbertCodex/0.1 (desktop source control)";
const DEFAULT_OAUTH_SCOPE: &str = "repo workflow delete_repo admin:repo_hook admin:org admin:public_key admin:org_hook gist notifications user project write:packages read:packages delete:packages admin:gpg_key codespace read:audit_log security_events";
const DEFAULT_PER_PAGE: usize = 30;
const MAX_PER_PAGE: usize = 100;
const DEFAULT_TREE_LIMIT: usize = 900;
const MAX_TREE_LIMIT: usize = 5_000;
const DEFAULT_READ_BYTES: usize = 1024 * 1024;
const MAX_READ_BYTES: usize = 16 * 1024 * 1024;
const GITHUB_HTTP_TIMEOUT_SECS: u64 = 18;
const GITHUB_HTTP_CONNECT_TIMEOUT_SECS: u64 = 8;

/// Shared lock for the local GitHub account store.
#[derive(Default)]
pub struct GithubState {
    lock: Mutex<()>,
}

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct GithubDatabase {
    connected_at: Option<u64>,
    database_generation: u32,
    scopes: Vec<String>,
    token: Option<String>,
    user: Option<GithubUser>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubUser {
    pub avatar_url: Option<String>,
    pub html_url: String,
    pub id: u64,
    pub login: String,
    pub name: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubConnectionState {
    pub connected: bool,
    pub connected_at: Option<u64>,
    pub scopes: Vec<String>,
    pub user: Option<GithubUser>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubConnectTokenRequest {
    pub token: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubBeginDeviceLoginRequest {
    pub client_id: String,
    pub scope: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubDeviceLoginSession {
    pub device_code: String,
    pub expires_in: u64,
    pub interval: u64,
    pub scope: String,
    pub user_code: String,
    pub verification_uri: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubOpenDeviceLoginRequest {
    pub verification_uri: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubPollDeviceLoginRequest {
    pub client_id: String,
    pub device_code: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubDeviceLoginPollResponse {
    pub connection: Option<GithubConnectionState>,
    pub error: Option<String>,
    pub interval: Option<u64>,
    pub message: Option<String>,
    pub status: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubListRepositoriesRequest {
    pub affiliation: Option<String>,
    pub page: Option<usize>,
    pub per_page: Option<usize>,
    pub query: Option<String>,
    pub sort: Option<String>,
    pub visibility: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubRepository {
    pub default_branch: String,
    pub description: Option<String>,
    pub full_name: String,
    pub html_url: String,
    pub name: String,
    pub owner_login: String,
    pub permissions: GithubRepositoryPermissions,
    pub private: bool,
    pub pushed_at: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubRepositoryPermissions {
    pub admin: bool,
    pub pull: bool,
    pub push: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubRepositoryRequest {
    pub owner: String,
    pub repo: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubBranch {
    pub name: String,
    pub commit_sha: String,
    pub protected: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubListBranchesRequest {
    pub owner: String,
    pub page: Option<usize>,
    pub per_page: Option<usize>,
    pub repo: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubListTreeRequest {
    pub branch: Option<String>,
    pub limit: Option<usize>,
    pub owner: String,
    pub recursive: Option<bool>,
    pub repo: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubTreeResponse {
    pub branch: String,
    pub commit_sha: String,
    pub entries: Vec<GithubTreeEntry>,
    pub truncated: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubTreeEntry {
    pub mode: Option<String>,
    pub path: String,
    pub sha: String,
    pub size: Option<u64>,
    pub kind: String,
    pub url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubReadFileRequest {
    pub branch: Option<String>,
    pub max_bytes: Option<usize>,
    pub owner: String,
    pub path: String,
    pub repo: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubReadFileResponse {
    pub branch: Option<String>,
    pub content: String,
    pub download_url: Option<String>,
    pub encoding: Option<String>,
    pub html_url: Option<String>,
    pub name: String,
    pub path: String,
    pub sha: String,
    pub size: u64,
    pub truncated: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubSearchCodeRequest {
    pub branch: Option<String>,
    pub owner: Option<String>,
    pub page: Option<usize>,
    pub per_page: Option<usize>,
    pub query: String,
    pub repo: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubSearchCodeResponse {
    pub incomplete_results: bool,
    pub items: Vec<GithubCodeSearchItem>,
    pub total_count: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubCodeSearchItem {
    pub html_url: String,
    pub name: String,
    pub path: String,
    pub repository_full_name: String,
    pub score: f64,
    pub sha: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubCreateBranchRequest {
    pub base_branch: Option<String>,
    pub new_branch: String,
    pub owner: String,
    pub repo: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubCommitFilesRequest {
    pub branch: Option<String>,
    pub files: Vec<GithubCommitFileRequest>,
    pub message: String,
    pub owner: String,
    pub repo: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubCommitFileRequest {
    pub content: Option<String>,
    pub operation: Option<String>,
    pub path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubCommitFilesResponse {
    pub branch: String,
    pub commit_html_url: String,
    pub commit_sha: String,
    pub files_changed: usize,
    pub parent_sha: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubCreatePullRequestRequest {
    pub base: String,
    pub body: Option<String>,
    pub draft: Option<bool>,
    pub head: String,
    pub owner: String,
    pub repo: String,
    pub title: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubPullRequestResponse {
    pub html_url: String,
    pub number: u64,
    pub state: String,
    pub title: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubGenerateReleaseNotesRequest {
    pub configuration_file_path: Option<String>,
    pub owner: String,
    pub previous_tag_name: Option<String>,
    pub repo: String,
    pub tag_name: String,
    pub target_commitish: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubReleaseNotesResponse {
    pub body: String,
    pub name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubCreateReleaseRequest {
    pub body: Option<String>,
    pub draft: Option<bool>,
    pub generate_release_notes: Option<bool>,
    pub make_latest: Option<String>,
    pub name: Option<String>,
    pub owner: String,
    pub prerelease: Option<bool>,
    pub repo: String,
    pub tag_name: String,
    pub target_commitish: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubListReleasesRequest {
    pub owner: String,
    pub page: Option<usize>,
    pub per_page: Option<usize>,
    pub repo: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubReleaseResponse {
    pub body: Option<String>,
    pub draft: bool,
    pub html_url: String,
    pub id: u64,
    pub name: Option<String>,
    pub prerelease: bool,
    pub published_at: Option<String>,
    pub tag_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubListWorkflowsRequest {
    pub owner: String,
    pub page: Option<usize>,
    pub per_page: Option<usize>,
    pub repo: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubWorkflowListResponse {
    pub total_count: u64,
    pub workflows: Vec<GithubWorkflow>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubWorkflow {
    pub badge_url: String,
    pub created_at: String,
    pub html_url: String,
    pub id: u64,
    pub name: String,
    pub path: String,
    pub state: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubDispatchWorkflowRequest {
    pub inputs: Option<Value>,
    pub owner: String,
    #[serde(rename = "ref")]
    pub ref_name: String,
    pub repo: String,
    pub workflow_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubDispatchWorkflowResponse {
    pub ref_name: String,
    pub workflow_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubListWorkflowRunsRequest {
    pub branch: Option<String>,
    pub event: Option<String>,
    pub owner: String,
    pub page: Option<usize>,
    pub per_page: Option<usize>,
    pub repo: String,
    pub status: Option<String>,
    pub workflow_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubWorkflowRunListResponse {
    pub runs: Vec<GithubWorkflowRun>,
    pub total_count: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubWorkflowRun {
    pub branch: Option<String>,
    pub conclusion: Option<String>,
    pub created_at: String,
    pub event: String,
    pub head_sha: String,
    pub html_url: String,
    pub id: u64,
    pub name: Option<String>,
    pub run_number: u64,
    pub status: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
struct GithubUserApi {
    avatar_url: Option<String>,
    html_url: String,
    id: u64,
    login: String,
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GithubDeviceCodeApi {
    device_code: String,
    expires_in: u64,
    interval: u64,
    user_code: String,
    verification_uri: String,
}

#[derive(Debug, Deserialize)]
struct GithubOAuthTokenApi {
    access_token: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
    interval: Option<u64>,
    scope: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GithubRepositoryApi {
    default_branch: Option<String>,
    description: Option<String>,
    full_name: String,
    html_url: String,
    name: String,
    owner: GithubOwnerApi,
    permissions: Option<GithubRepositoryPermissions>,
    private: bool,
    pushed_at: Option<String>,
    updated_at: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GithubOwnerApi {
    login: String,
}

#[derive(Debug, Deserialize)]
struct GithubBranchApi {
    commit: GithubShaApi,
    name: String,
    protected: bool,
}

#[derive(Debug, Deserialize)]
struct GithubShaApi {
    sha: String,
}

#[derive(Debug, Deserialize)]
struct GithubCommitApi {
    html_url: Option<String>,
    sha: String,
    tree: GithubShaApi,
}

#[derive(Debug, Deserialize)]
struct GithubTreeApi {
    tree: Vec<GithubTreeEntryApi>,
    truncated: bool,
}

#[derive(Debug, Deserialize)]
struct GithubTreeEntryApi {
    mode: Option<String>,
    path: String,
    sha: Option<String>,
    size: Option<u64>,
    #[serde(rename = "type")]
    kind: String,
    url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GithubContentFileApi {
    content: Option<String>,
    download_url: Option<String>,
    encoding: Option<String>,
    html_url: Option<String>,
    name: String,
    path: String,
    sha: String,
    size: u64,
    #[serde(rename = "type")]
    kind: String,
}

#[derive(Debug, Deserialize)]
struct GithubCodeSearchApi {
    incomplete_results: bool,
    items: Vec<GithubCodeSearchItemApi>,
    total_count: u64,
}

#[derive(Debug, Deserialize)]
struct GithubCodeSearchItemApi {
    html_url: String,
    name: String,
    path: String,
    repository: GithubSearchRepositoryApi,
    score: f64,
    sha: String,
}

#[derive(Debug, Deserialize)]
struct GithubSearchRepositoryApi {
    full_name: String,
}

#[derive(Debug, Deserialize)]
struct GithubPullRequestApi {
    html_url: String,
    number: u64,
    state: String,
    title: String,
}

#[derive(Debug, Deserialize)]
struct GithubReleaseNotesApi {
    body: String,
    name: String,
}

#[derive(Debug, Deserialize)]
struct GithubReleaseApi {
    body: Option<String>,
    draft: bool,
    html_url: String,
    id: u64,
    name: Option<String>,
    prerelease: bool,
    published_at: Option<String>,
    tag_name: String,
}

#[derive(Debug, Deserialize)]
struct GithubWorkflowListApi {
    total_count: u64,
    workflows: Vec<GithubWorkflowApi>,
}

#[derive(Debug, Deserialize)]
struct GithubWorkflowApi {
    badge_url: String,
    created_at: String,
    html_url: String,
    id: u64,
    name: String,
    path: String,
    state: String,
    updated_at: String,
}

#[derive(Debug, Deserialize)]
struct GithubWorkflowRunListApi {
    total_count: u64,
    workflow_runs: Vec<GithubWorkflowRunApi>,
}

#[derive(Debug, Deserialize)]
struct GithubWorkflowRunApi {
    conclusion: Option<String>,
    created_at: String,
    event: String,
    head_branch: Option<String>,
    head_sha: String,
    html_url: String,
    id: u64,
    name: Option<String>,
    run_number: u64,
    status: Option<String>,
    updated_at: String,
}

/// Returns the saved GitHub connection without exposing the access token.
#[tauri::command]
pub fn github_get_state(
    app: tauri::AppHandle,
    state: tauri::State<'_, GithubState>,
) -> Result<GithubConnectionState, String> {
    let _guard = state
        .lock
        .lock()
        .map_err(|_| "The GitHub account store is busy. Try again in a moment.".to_string())?;
    let database = load_database(&app)?;

    Ok(create_connection_state(&database))
}

/// Validates a manually supplied token and persists the normalized account state.
#[tauri::command]
pub async fn github_connect_token(
    app: tauri::AppHandle,
    state: tauri::State<'_, GithubState>,
    request: GithubConnectTokenRequest,
) -> Result<GithubConnectionState, String> {
    let token = normalize_token(&request.token)?;
    let client = github_client()?;
    let database = validate_and_create_database(&client, token).await?;

    {
        let _guard = state
            .lock
            .lock()
            .map_err(|_| "The GitHub account store is busy. Try again in a moment.".to_string())?;
        save_database(&app, &database)?;
    }

    Ok(create_connection_state(&database))
}

/// Starts GitHub OAuth device flow and returns the user-code session.
#[tauri::command]
pub async fn github_begin_device_login(
    request: GithubBeginDeviceLoginRequest,
) -> Result<GithubDeviceLoginSession, String> {
    let client_id = normalize_oauth_client_id(&request.client_id)?;
    let scope = normalize_oauth_scope(request.scope.as_deref())?;
    let client = github_client()?;
    let body = encode_form_body(&[("client_id", client_id.as_str()), ("scope", scope.as_str())]);
    let response = client
        .post(GITHUB_DEVICE_CODE_URL)
        .header("Accept", "application/json")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(body)
        .send()
        .await
        .map_err(|error| {
            format!("GitHub browser login could not reach {GITHUB_DEVICE_CODE_URL}: {error}")
        })?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("Could not read GitHub browser login response: {error}"))?;

    if !status.is_success() {
        return Err(format_github_error(status.as_u16(), &body));
    }

    let session = serde_json::from_str::<GithubDeviceCodeApi>(&body)
        .map_err(|error| format!("Could not parse GitHub browser login response: {error}"))?;

    Ok(GithubDeviceLoginSession {
        device_code: session.device_code,
        expires_in: session.expires_in,
        interval: session.interval.max(1),
        scope,
        user_code: session.user_code,
        verification_uri: session.verification_uri,
    })
}

/// Opens only GitHub's official device authorization page in the system browser.
#[tauri::command]
pub fn github_open_device_login(request: GithubOpenDeviceLoginRequest) -> Result<(), String> {
    let verification_uri = request
        .verification_uri
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(GITHUB_DEVICE_VERIFICATION_URL);

    if verification_uri != GITHUB_DEVICE_VERIFICATION_URL {
        return Err(
            "GitHub browser login can only open the official device authorization page."
                .to_string(),
        );
    }

    open_external_url(GITHUB_DEVICE_VERIFICATION_URL)
}

/// Polls device-flow authorization and stores the token once GitHub authorizes it.
#[tauri::command]
pub async fn github_poll_device_login(
    app: tauri::AppHandle,
    state: tauri::State<'_, GithubState>,
    request: GithubPollDeviceLoginRequest,
) -> Result<GithubDeviceLoginPollResponse, String> {
    let client_id = normalize_oauth_client_id(&request.client_id)?;
    let device_code = normalize_device_code(&request.device_code)?;
    let client = github_client()?;
    let body = encode_form_body(&[
        ("client_id", client_id.as_str()),
        ("device_code", device_code.as_str()),
        ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
    ]);
    let response = client
        .post(GITHUB_OAUTH_TOKEN_URL)
        .header("Accept", "application/json")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(body)
        .send()
        .await
        .map_err(|error| {
            format!("GitHub browser login poll could not reach {GITHUB_OAUTH_TOKEN_URL}: {error}")
        })?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("Could not read GitHub browser login poll response: {error}"))?;

    if !status.is_success() {
        return Err(format_github_error(status.as_u16(), &body));
    }

    let token_response = serde_json::from_str::<GithubOAuthTokenApi>(&body)
        .map_err(|error| format!("Could not parse GitHub browser login poll response: {error}"))?;

    if let Some(error) = token_response.error.as_deref() {
        return Ok(device_login_error_response(
            error,
            token_response.error_description.as_deref(),
            token_response.interval,
        ));
    }

    let token = token_response
        .access_token
        .ok_or_else(|| "GitHub browser login did not return an access token yet.".to_string())
        .and_then(|token| normalize_token(&token))?;
    let database = validate_and_create_database(&client, token).await?;

    {
        let _guard = state
            .lock
            .lock()
            .map_err(|_| "The GitHub account store is busy. Try again in a moment.".to_string())?;
        save_database(&app, &database)?;
    }

    Ok(GithubDeviceLoginPollResponse {
        connection: Some(create_connection_state(&database)),
        error: None,
        interval: None,
        message: token_response
            .scope
            .map(|scope| format!("Authorized GitHub scopes: {scope}")),
        status: "authorized".to_string(),
    })
}

/// Clears the local GitHub account database and returns the disconnected state.
#[tauri::command]
pub fn github_disconnect(
    app: tauri::AppHandle,
    state: tauri::State<'_, GithubState>,
) -> Result<GithubConnectionState, String> {
    let _guard = state
        .lock
        .lock()
        .map_err(|_| "The GitHub account store is busy. Try again in a moment.".to_string())?;
    let database = fresh_database();

    save_database(&app, &database)?;
    Ok(create_connection_state(&database))
}

/// Lists repositories visible to the signed-in GitHub account.
#[tauri::command]
pub async fn github_list_repositories(
    app: tauri::AppHandle,
    state: tauri::State<'_, GithubState>,
    request: GithubListRepositoriesRequest,
) -> Result<Vec<GithubRepository>, String> {
    let token = load_access_token(&app, &state)?;
    let client = github_client()?;
    let mut url = parse_api_url("/user/repos")?;

    {
        let mut query = url.query_pairs_mut();
        query.append_pair(
            "affiliation",
            sanitize_enum(
                request.affiliation.as_deref(),
                &["owner", "collaborator", "organization_member"],
                "owner,collaborator,organization_member",
            ),
        );
        query.append_pair(
            "visibility",
            sanitize_enum(
                request.visibility.as_deref(),
                &["all", "public", "private"],
                "all",
            ),
        );
        query.append_pair(
            "sort",
            sanitize_enum(
                request.sort.as_deref(),
                &["created", "updated", "pushed", "full_name"],
                "updated",
            ),
        );
        query.append_pair("per_page", &clamp_per_page(request.per_page).to_string());
        query.append_pair("page", &request.page.unwrap_or(1).max(1).to_string());
    }

    let repos = github_api::<Vec<GithubRepositoryApi>>(&client, &token, Method::GET, url, None)
        .await?
        .into_iter()
        .map(GithubRepository::from)
        .collect::<Vec<_>>();
    let query = request.query.unwrap_or_default().trim().to_lowercase();

    if query.is_empty() {
        return Ok(repos);
    }

    Ok(repos
        .into_iter()
        .filter(|repo| {
            repo.full_name.to_lowercase().contains(&query)
                || repo
                    .description
                    .as_deref()
                    .unwrap_or_default()
                    .to_lowercase()
                    .contains(&query)
        })
        .collect())
}

/// Fetches normalized metadata for one repository.
#[tauri::command]
pub async fn github_get_repository(
    app: tauri::AppHandle,
    state: tauri::State<'_, GithubState>,
    request: GithubRepositoryRequest,
) -> Result<GithubRepository, String> {
    let token = load_access_token(&app, &state)?;
    let client = github_client()?;
    let owner = normalize_owner(&request.owner)?;
    let repo = normalize_repo(&request.repo)?;
    let url = parse_api_url(&format!("/repos/{owner}/{repo}"))?;
    let repository =
        github_api::<GithubRepositoryApi>(&client, &token, Method::GET, url, None).await?;

    Ok(repository.into())
}

/// Lists branch heads for one repository.
#[tauri::command]
pub async fn github_list_branches(
    app: tauri::AppHandle,
    state: tauri::State<'_, GithubState>,
    request: GithubListBranchesRequest,
) -> Result<Vec<GithubBranch>, String> {
    let token = load_access_token(&app, &state)?;
    let client = github_client()?;
    let owner = normalize_owner(&request.owner)?;
    let repo = normalize_repo(&request.repo)?;
    let mut url = parse_api_url(&format!("/repos/{owner}/{repo}/branches"))?;

    {
        let mut query = url.query_pairs_mut();
        query.append_pair("per_page", &clamp_per_page(request.per_page).to_string());
        query.append_pair("page", &request.page.unwrap_or(1).max(1).to_string());
    }

    let branches = github_api::<Vec<GithubBranchApi>>(&client, &token, Method::GET, url, None)
        .await?
        .into_iter()
        .map(GithubBranch::from)
        .collect();

    Ok(branches)
}

/// Returns a capped Git tree for a branch, resolving the default branch when omitted.
#[tauri::command]
pub async fn github_list_tree(
    app: tauri::AppHandle,
    state: tauri::State<'_, GithubState>,
    request: GithubListTreeRequest,
) -> Result<GithubTreeResponse, String> {
    let token = load_access_token(&app, &state)?;
    let client = github_client()?;
    let owner = normalize_owner(&request.owner)?;
    let repo = normalize_repo(&request.repo)?;
    let branch = resolve_branch_name(&client, &token, &owner, &repo, request.branch).await?;
    let branch_head = fetch_branch(&client, &token, &owner, &repo, &branch).await?;
    let commit = fetch_git_commit(&client, &token, &owner, &repo, &branch_head.commit_sha).await?;
    let mut url = parse_api_url(&format!(
        "/repos/{owner}/{repo}/git/trees/{}",
        encode_path_segment(&commit.tree.sha)
    ))?;

    if request.recursive.unwrap_or(true) {
        url.query_pairs_mut().append_pair("recursive", "1");
    }

    let tree = github_api::<GithubTreeApi>(&client, &token, Method::GET, url, None).await?;
    let limit = request
        .limit
        .unwrap_or(DEFAULT_TREE_LIMIT)
        .clamp(1, MAX_TREE_LIMIT);
    let truncated_by_limit = tree.tree.len() > limit;
    let entries = tree
        .tree
        .into_iter()
        .take(limit)
        .filter_map(GithubTreeEntry::from_api)
        .collect();

    Ok(GithubTreeResponse {
        branch,
        commit_sha: branch_head.commit_sha,
        entries,
        truncated: tree.truncated || truncated_by_limit,
    })
}

/// Reads and decodes one text file from a repository branch.
#[tauri::command]
pub async fn github_read_file(
    app: tauri::AppHandle,
    state: tauri::State<'_, GithubState>,
    request: GithubReadFileRequest,
) -> Result<GithubReadFileResponse, String> {
    let token = load_access_token(&app, &state)?;
    let client = github_client()?;
    let owner = normalize_owner(&request.owner)?;
    let repo = normalize_repo(&request.repo)?;
    let path = normalize_repo_path(&request.path)?;
    let mut url = parse_api_url(&format!(
        "/repos/{owner}/{repo}/contents/{}",
        encode_repo_path(&path)
    ))?;
    let branch = request.branch.and_then(normalize_optional_branch);

    if let Some(branch) = branch.as_deref() {
        url.query_pairs_mut().append_pair("ref", branch);
    }

    let file = github_api::<GithubContentFileApi>(&client, &token, Method::GET, url, None).await?;

    if file.kind != "file" {
        return Err(format!("GitHub path is not a file: {}", file.path));
    }

    let decoded = decode_github_file_content(file.content.as_deref(), file.encoding.as_deref())?;
    let max_bytes = request
        .max_bytes
        .unwrap_or(DEFAULT_READ_BYTES)
        .clamp(1, MAX_READ_BYTES);
    let truncated = decoded.len() > max_bytes;
    let content_bytes = if truncated {
        &decoded[..max_bytes]
    } else {
        decoded.as_slice()
    };
    let content = String::from_utf8_lossy(content_bytes).to_string();

    Ok(GithubReadFileResponse {
        branch,
        content,
        download_url: file.download_url,
        encoding: file.encoding,
        html_url: file.html_url,
        name: file.name,
        path: file.path,
        sha: file.sha,
        size: file.size,
        truncated,
    })
}

/// Runs GitHub code search, optionally scoped to repository and branch qualifiers.
#[tauri::command]
pub async fn github_search_code(
    app: tauri::AppHandle,
    state: tauri::State<'_, GithubState>,
    request: GithubSearchCodeRequest,
) -> Result<GithubSearchCodeResponse, String> {
    let token = load_access_token(&app, &state)?;
    let client = github_client()?;
    let mut query = request.query.trim().to_string();

    if query.is_empty() {
        return Err("GitHub code search needs a query.".to_string());
    }

    if let (Some(owner), Some(repo)) = (request.owner.as_deref(), request.repo.as_deref()) {
        query.push_str(&format!(
            " repo:{}/{}",
            normalize_owner(owner)?,
            normalize_repo(repo)?
        ));
    }

    if let Some(branch) = request.branch.and_then(normalize_optional_branch) {
        query.push_str(&format!(" ref:{branch}"));
    }

    let mut url = parse_api_url("/search/code")?;

    {
        let mut params = url.query_pairs_mut();
        params.append_pair("q", &query);
        params.append_pair("per_page", &clamp_per_page(request.per_page).to_string());
        params.append_pair("page", &request.page.unwrap_or(1).max(1).to_string());
    }

    let response =
        github_api::<GithubCodeSearchApi>(&client, &token, Method::GET, url, None).await?;

    Ok(GithubSearchCodeResponse {
        incomplete_results: response.incomplete_results,
        items: response
            .items
            .into_iter()
            .map(GithubCodeSearchItem::from)
            .collect(),
        total_count: response.total_count,
    })
}

/// Creates a branch ref from the default or requested base branch.
#[tauri::command]
pub async fn github_create_branch(
    app: tauri::AppHandle,
    state: tauri::State<'_, GithubState>,
    request: GithubCreateBranchRequest,
) -> Result<GithubBranch, String> {
    let token = load_access_token(&app, &state)?;
    let client = github_client()?;
    let owner = normalize_owner(&request.owner)?;
    let repo = normalize_repo(&request.repo)?;
    let new_branch = normalize_branch(&request.new_branch)?;
    let base_branch =
        resolve_branch_name(&client, &token, &owner, &repo, request.base_branch).await?;
    let base = fetch_branch(&client, &token, &owner, &repo, &base_branch).await?;
    let url = parse_api_url(&format!("/repos/{owner}/{repo}/git/refs"))?;
    let payload = json!({
        "ref": format!("refs/heads/{new_branch}"),
        "sha": base.commit_sha,
    });
    let branch_ref =
        github_api::<GithubRefApi>(&client, &token, Method::POST, url, Some(payload)).await?;

    Ok(GithubBranch {
        commit_sha: branch_ref.object.sha,
        name: new_branch,
        protected: false,
    })
}

/// Creates a Git tree, commit, and branch ref update for a batch of file changes.
#[tauri::command]
pub async fn github_commit_files(
    app: tauri::AppHandle,
    state: tauri::State<'_, GithubState>,
    request: GithubCommitFilesRequest,
) -> Result<GithubCommitFilesResponse, String> {
    let token = load_access_token(&app, &state)?;
    let client = github_client()?;
    let owner = normalize_owner(&request.owner)?;
    let repo = normalize_repo(&request.repo)?;
    let branch = resolve_branch_name(&client, &token, &owner, &repo, request.branch).await?;
    let message = normalize_commit_message(&request.message)?;

    if request.files.is_empty() {
        return Err("GitHub commit needs at least one file change.".to_string());
    }

    let branch_head = fetch_branch(&client, &token, &owner, &repo, &branch).await?;
    let head_commit =
        fetch_git_commit(&client, &token, &owner, &repo, &branch_head.commit_sha).await?;
    let tree_entries = request
        .files
        .iter()
        .map(create_commit_tree_entry)
        .collect::<Result<Vec<_>, _>>()?;
    let tree_url = parse_api_url(&format!("/repos/{owner}/{repo}/git/trees"))?;
    let tree_payload = json!({
        "base_tree": head_commit.tree.sha,
        "tree": tree_entries,
    });
    let new_tree =
        github_api::<GithubShaApi>(&client, &token, Method::POST, tree_url, Some(tree_payload))
            .await?;
    let commit_url = parse_api_url(&format!("/repos/{owner}/{repo}/git/commits"))?;
    let commit_payload = json!({
        "message": message,
        "tree": new_tree.sha,
        "parents": [branch_head.commit_sha],
    });
    let new_commit = github_api::<GithubCommitApi>(
        &client,
        &token,
        Method::POST,
        commit_url,
        Some(commit_payload),
    )
    .await?;
    let ref_url = parse_api_url(&format!("/repos/{owner}/{repo}/git/refs/heads/{branch}"))?;
    let ref_payload = json!({
        "sha": new_commit.sha,
        "force": false,
    });
    let _updated_ref =
        github_api::<GithubRefApi>(&client, &token, Method::PATCH, ref_url, Some(ref_payload))
            .await?;

    Ok(GithubCommitFilesResponse {
        branch,
        commit_html_url: new_commit.html_url.unwrap_or_else(|| {
            format!(
                "https://github.com/{owner}/{repo}/commit/{}",
                new_commit.sha
            )
        }),
        commit_sha: new_commit.sha,
        files_changed: request.files.len(),
        parent_sha: branch_head.commit_sha,
    })
}

/// Opens a pull request; draft is the default unless the caller opts out.
#[tauri::command]
pub async fn github_create_pull_request(
    app: tauri::AppHandle,
    state: tauri::State<'_, GithubState>,
    request: GithubCreatePullRequestRequest,
) -> Result<GithubPullRequestResponse, String> {
    let token = load_access_token(&app, &state)?;
    let client = github_client()?;
    let owner = normalize_owner(&request.owner)?;
    let repo = normalize_repo(&request.repo)?;
    let title = request.title.trim();
    let head = request.head.trim();
    let base = request.base.trim();

    if title.is_empty() {
        return Err("GitHub pull request title is required.".to_string());
    }

    if head.is_empty() || base.is_empty() {
        return Err("GitHub pull request needs both head and base branches.".to_string());
    }

    let url = parse_api_url(&format!("/repos/{owner}/{repo}/pulls"))?;
    let payload = json!({
        "title": title,
        "head": head,
        "base": base,
        "body": request.body.unwrap_or_default(),
        "draft": request.draft.unwrap_or(true),
    });
    let pull_request =
        github_api::<GithubPullRequestApi>(&client, &token, Method::POST, url, Some(payload))
            .await?;

    Ok(GithubPullRequestResponse {
        html_url: pull_request.html_url,
        number: pull_request.number,
        state: pull_request.state,
        title: pull_request.title,
    })
}

/// Delegates release-note generation to GitHub without creating a release.
#[tauri::command]
pub async fn github_generate_release_notes(
    app: tauri::AppHandle,
    state: tauri::State<'_, GithubState>,
    request: GithubGenerateReleaseNotesRequest,
) -> Result<GithubReleaseNotesResponse, String> {
    let token = load_access_token(&app, &state)?;
    let client = github_client()?;
    let owner = normalize_owner(&request.owner)?;
    let repo = normalize_repo(&request.repo)?;
    let tag_name = normalize_required_text(&request.tag_name, "release tag")?;
    let url = parse_api_url(&format!("/repos/{owner}/{repo}/releases/generate-notes"))?;
    let mut payload = json!({
        "tag_name": tag_name,
    });

    insert_optional_payload_string(
        &mut payload,
        "target_commitish",
        normalize_optional_text(request.target_commitish),
    );
    insert_optional_payload_string(
        &mut payload,
        "previous_tag_name",
        normalize_optional_text(request.previous_tag_name),
    );
    insert_optional_payload_string(
        &mut payload,
        "configuration_file_path",
        normalize_optional_repo_path(request.configuration_file_path)?,
    );

    let notes =
        github_api::<GithubReleaseNotesApi>(&client, &token, Method::POST, url, Some(payload))
            .await?;

    Ok(GithubReleaseNotesResponse {
        body: notes.body,
        name: notes.name,
    })
}

/// Creates a release, defaulting to draft release behavior for review safety.
#[tauri::command]
pub async fn github_create_release(
    app: tauri::AppHandle,
    state: tauri::State<'_, GithubState>,
    request: GithubCreateReleaseRequest,
) -> Result<GithubReleaseResponse, String> {
    let token = load_access_token(&app, &state)?;
    let client = github_client()?;
    let owner = normalize_owner(&request.owner)?;
    let repo = normalize_repo(&request.repo)?;
    let tag_name = normalize_required_text(&request.tag_name, "release tag")?;
    let url = parse_api_url(&format!("/repos/{owner}/{repo}/releases"))?;
    let mut payload = json!({
        "tag_name": tag_name,
        "draft": request.draft.unwrap_or(true),
        "prerelease": request.prerelease.unwrap_or(false),
        "generate_release_notes": request.generate_release_notes.unwrap_or(true),
    });

    insert_optional_payload_string(
        &mut payload,
        "target_commitish",
        normalize_optional_text(request.target_commitish),
    );
    insert_optional_payload_string(&mut payload, "name", normalize_optional_text(request.name));
    insert_optional_payload_string(&mut payload, "body", normalize_optional_text(request.body));
    insert_optional_payload_string(
        &mut payload,
        "make_latest",
        normalize_make_latest(request.make_latest)?,
    );

    let release =
        github_api::<GithubReleaseApi>(&client, &token, Method::POST, url, Some(payload)).await?;

    Ok(release.into())
}

/// Lists releases visible to the signed-in account.
#[tauri::command]
pub async fn github_list_releases(
    app: tauri::AppHandle,
    state: tauri::State<'_, GithubState>,
    request: GithubListReleasesRequest,
) -> Result<Vec<GithubReleaseResponse>, String> {
    let token = load_access_token(&app, &state)?;
    let client = github_client()?;
    let owner = normalize_owner(&request.owner)?;
    let repo = normalize_repo(&request.repo)?;
    let mut url = parse_api_url(&format!("/repos/{owner}/{repo}/releases"))?;

    {
        let mut query = url.query_pairs_mut();
        query.append_pair("per_page", &clamp_per_page(request.per_page).to_string());
        query.append_pair("page", &request.page.unwrap_or(1).max(1).to_string());
    }

    let releases = github_api::<Vec<GithubReleaseApi>>(&client, &token, Method::GET, url, None)
        .await?
        .into_iter()
        .map(GithubReleaseResponse::from)
        .collect();

    Ok(releases)
}

/// Lists GitHub Actions workflows for a repository.
#[tauri::command]
pub async fn github_list_workflows(
    app: tauri::AppHandle,
    state: tauri::State<'_, GithubState>,
    request: GithubListWorkflowsRequest,
) -> Result<GithubWorkflowListResponse, String> {
    let token = load_access_token(&app, &state)?;
    let client = github_client()?;
    let owner = normalize_owner(&request.owner)?;
    let repo = normalize_repo(&request.repo)?;
    let mut url = parse_api_url(&format!("/repos/{owner}/{repo}/actions/workflows"))?;

    {
        let mut query = url.query_pairs_mut();
        query.append_pair("per_page", &clamp_per_page(request.per_page).to_string());
        query.append_pair("page", &request.page.unwrap_or(1).max(1).to_string());
    }

    let workflows =
        github_api::<GithubWorkflowListApi>(&client, &token, Method::GET, url, None).await?;

    Ok(GithubWorkflowListResponse {
        total_count: workflows.total_count,
        workflows: workflows
            .workflows
            .into_iter()
            .map(GithubWorkflow::from)
            .collect(),
    })
}

/// Dispatches a workflow_dispatch workflow for a ref and optional inputs.
#[tauri::command]
pub async fn github_dispatch_workflow(
    app: tauri::AppHandle,
    state: tauri::State<'_, GithubState>,
    request: GithubDispatchWorkflowRequest,
) -> Result<GithubDispatchWorkflowResponse, String> {
    let token = load_access_token(&app, &state)?;
    let client = github_client()?;
    let owner = normalize_owner(&request.owner)?;
    let repo = normalize_repo(&request.repo)?;
    let workflow_id = normalize_required_text(&request.workflow_id, "workflow id")?;
    let ref_name = normalize_required_text(&request.ref_name, "workflow ref")?;
    let url = parse_api_url(&format!(
        "/repos/{owner}/{repo}/actions/workflows/{}/dispatches",
        encode_path_segment(&workflow_id)
    ))?;
    let mut payload = json!({
        "ref": ref_name,
    });

    if let Some(inputs) = normalize_workflow_inputs(request.inputs)? {
        payload["inputs"] = inputs;
    }

    github_api_empty(&client, &token, Method::POST, url, Some(payload)).await?;

    Ok(GithubDispatchWorkflowResponse {
        ref_name,
        workflow_id,
    })
}

/// Lists recent workflow runs for a selected workflow.
#[tauri::command]
pub async fn github_list_workflow_runs(
    app: tauri::AppHandle,
    state: tauri::State<'_, GithubState>,
    request: GithubListWorkflowRunsRequest,
) -> Result<GithubWorkflowRunListResponse, String> {
    let token = load_access_token(&app, &state)?;
    let client = github_client()?;
    let owner = normalize_owner(&request.owner)?;
    let repo = normalize_repo(&request.repo)?;
    let workflow_id = normalize_required_text(&request.workflow_id, "workflow id")?;
    let mut url = parse_api_url(&format!(
        "/repos/{owner}/{repo}/actions/workflows/{}/runs",
        encode_path_segment(&workflow_id)
    ))?;

    {
        let mut query = url.query_pairs_mut();
        query.append_pair("per_page", &clamp_per_page(request.per_page).to_string());
        query.append_pair("page", &request.page.unwrap_or(1).max(1).to_string());

        if let Some(branch) = normalize_optional_text(request.branch) {
            query.append_pair("branch", &branch);
        }

        if let Some(event) = normalize_optional_text(request.event) {
            query.append_pair("event", &event);
        }

        if let Some(status) = normalize_optional_text(request.status) {
            query.append_pair("status", &status);
        }
    }

    let runs =
        github_api::<GithubWorkflowRunListApi>(&client, &token, Method::GET, url, None).await?;

    Ok(GithubWorkflowRunListResponse {
        runs: runs
            .workflow_runs
            .into_iter()
            .map(GithubWorkflowRun::from)
            .collect(),
        total_count: runs.total_count,
    })
}

#[derive(Debug, Deserialize)]
struct GithubRefApi {
    object: GithubShaApi,
}

impl From<GithubUserApi> for GithubUser {
    fn from(user: GithubUserApi) -> Self {
        Self {
            avatar_url: user.avatar_url,
            html_url: user.html_url,
            id: user.id,
            login: user.login,
            name: user.name,
        }
    }
}

impl From<GithubRepositoryApi> for GithubRepository {
    fn from(repository: GithubRepositoryApi) -> Self {
        Self {
            default_branch: repository
                .default_branch
                .unwrap_or_else(|| "main".to_string()),
            description: repository.description,
            full_name: repository.full_name,
            html_url: repository.html_url,
            name: repository.name,
            owner_login: repository.owner.login,
            permissions: repository.permissions.unwrap_or_default(),
            private: repository.private,
            pushed_at: repository.pushed_at,
            updated_at: repository.updated_at,
        }
    }
}

impl From<GithubBranchApi> for GithubBranch {
    fn from(branch: GithubBranchApi) -> Self {
        Self {
            commit_sha: branch.commit.sha,
            name: branch.name,
            protected: branch.protected,
        }
    }
}

impl From<GithubReleaseApi> for GithubReleaseResponse {
    fn from(release: GithubReleaseApi) -> Self {
        Self {
            body: release.body,
            draft: release.draft,
            html_url: release.html_url,
            id: release.id,
            name: release.name,
            prerelease: release.prerelease,
            published_at: release.published_at,
            tag_name: release.tag_name,
        }
    }
}

impl From<GithubWorkflowApi> for GithubWorkflow {
    fn from(workflow: GithubWorkflowApi) -> Self {
        Self {
            badge_url: workflow.badge_url,
            created_at: workflow.created_at,
            html_url: workflow.html_url,
            id: workflow.id,
            name: workflow.name,
            path: workflow.path,
            state: workflow.state,
            updated_at: workflow.updated_at,
        }
    }
}

impl From<GithubWorkflowRunApi> for GithubWorkflowRun {
    fn from(run: GithubWorkflowRunApi) -> Self {
        Self {
            branch: run.head_branch,
            conclusion: run.conclusion,
            created_at: run.created_at,
            event: run.event,
            head_sha: run.head_sha,
            html_url: run.html_url,
            id: run.id,
            name: run.name,
            run_number: run.run_number,
            status: run.status,
            updated_at: run.updated_at,
        }
    }
}

impl GithubTreeEntry {
    fn from_api(entry: GithubTreeEntryApi) -> Option<Self> {
        Some(Self {
            mode: entry.mode,
            path: entry.path,
            sha: entry.sha?,
            size: entry.size,
            kind: entry.kind,
            url: entry.url,
        })
    }
}

impl From<GithubCodeSearchItemApi> for GithubCodeSearchItem {
    fn from(item: GithubCodeSearchItemApi) -> Self {
        Self {
            html_url: item.html_url,
            name: item.name,
            path: item.path,
            repository_full_name: item.repository.full_name,
            score: item.score,
            sha: item.sha,
        }
    }
}

fn create_connection_state(database: &GithubDatabase) -> GithubConnectionState {
    GithubConnectionState {
        connected: database.token.is_some() && database.user.is_some(),
        connected_at: database.connected_at,
        scopes: database.scopes.clone(),
        user: database.user.clone(),
    }
}

async fn validate_and_create_database(
    client: &reqwest::Client,
    token: String,
) -> Result<GithubDatabase, String> {
    let response = client
        .get(format!("{GITHUB_API_URL}/user"))
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", GITHUB_API_VERSION)
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|error| format!("GitHub account validation failed: {error}"))?;
    let status = response.status();
    let scopes = response
        .headers()
        .get("x-oauth-scopes")
        .and_then(|value| value.to_str().ok())
        .map(parse_scope_header)
        .unwrap_or_default();
    let body = response
        .text()
        .await
        .map_err(|error| format!("Could not read GitHub account response: {error}"))?;

    if !status.is_success() {
        return Err(format_github_error(status.as_u16(), &body));
    }

    let user = serde_json::from_str::<GithubUserApi>(&body)
        .map(GithubUser::from)
        .map_err(|error| format!("Could not parse GitHub account response: {error}"))?;

    Ok(GithubDatabase {
        connected_at: Some(now_millis()),
        database_generation: GITHUB_DATABASE_GENERATION,
        scopes,
        token: Some(token),
        user: Some(user),
    })
}

fn load_access_token(
    app: &tauri::AppHandle,
    state: &tauri::State<'_, GithubState>,
) -> Result<String, String> {
    let _guard = state
        .lock
        .lock()
        .map_err(|_| "The GitHub account store is busy. Try again in a moment.".to_string())?;
    let database = load_database(app)?;

    database
        .token
        .filter(|token| !token.trim().is_empty())
        .ok_or_else(|| "Connect GitHub in Settings before using GitHub tools.".to_string())
}

fn github_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .connect_timeout(Duration::from_secs(GITHUB_HTTP_CONNECT_TIMEOUT_SECS))
        .timeout(Duration::from_secs(GITHUB_HTTP_TIMEOUT_SECS))
        .build()
        .map_err(|error| format!("Could not create GitHub client: {error}"))
}

async fn github_api<T: DeserializeOwned>(
    client: &reqwest::Client,
    token: &str,
    method: Method,
    url: reqwest::Url,
    body: Option<Value>,
) -> Result<T, String> {
    let mut request = client
        .request(method, url)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", GITHUB_API_VERSION)
        .bearer_auth(token);

    if let Some(body) = body {
        request = request
            .header("Content-Type", "application/json")
            .body(body.to_string());
    }

    let response = request
        .send()
        .await
        .map_err(|error| format!("GitHub request failed: {error}"))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| format!("Could not read GitHub response: {error}"))?;

    if !status.is_success() {
        return Err(format_github_error(status.as_u16(), &text));
    }

    serde_json::from_str::<T>(&text).map_err(|error| {
        format!(
            "Could not parse GitHub response: {error}. Response started with: {}",
            text.chars().take(240).collect::<String>()
        )
    })
}

async fn github_api_empty(
    client: &reqwest::Client,
    token: &str,
    method: Method,
    url: reqwest::Url,
    body: Option<Value>,
) -> Result<(), String> {
    let mut request = client
        .request(method, url)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", GITHUB_API_VERSION)
        .bearer_auth(token);

    if let Some(body) = body {
        request = request
            .header("Content-Type", "application/json")
            .body(body.to_string());
    }

    let response = request
        .send()
        .await
        .map_err(|error| format!("GitHub request failed: {error}"))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| format!("Could not read GitHub response: {error}"))?;

    if !status.is_success() {
        return Err(format_github_error(status.as_u16(), &text));
    }

    Ok(())
}

async fn resolve_branch_name(
    client: &reqwest::Client,
    token: &str,
    owner: &str,
    repo: &str,
    branch: Option<String>,
) -> Result<String, String> {
    if let Some(branch) = branch.and_then(normalize_optional_branch) {
        return Ok(branch);
    }

    let repository_url = parse_api_url(&format!("/repos/{owner}/{repo}"))?;
    let repository =
        github_api::<GithubRepositoryApi>(client, token, Method::GET, repository_url, None).await?;

    Ok(repository
        .default_branch
        .unwrap_or_else(|| "main".to_string()))
}

async fn fetch_branch(
    client: &reqwest::Client,
    token: &str,
    owner: &str,
    repo: &str,
    branch: &str,
) -> Result<GithubBranch, String> {
    let url = parse_api_url(&format!(
        "/repos/{owner}/{repo}/branches/{}",
        encode_path_segment(branch)
    ))?;
    let branch = github_api::<GithubBranchApi>(client, token, Method::GET, url, None).await?;

    Ok(branch.into())
}

async fn fetch_git_commit(
    client: &reqwest::Client,
    token: &str,
    owner: &str,
    repo: &str,
    sha: &str,
) -> Result<GithubCommitApi, String> {
    let url = parse_api_url(&format!(
        "/repos/{owner}/{repo}/git/commits/{}",
        encode_path_segment(sha)
    ))?;

    github_api::<GithubCommitApi>(client, token, Method::GET, url, None).await
}

fn create_commit_tree_entry(file: &GithubCommitFileRequest) -> Result<Value, String> {
    let path = normalize_repo_path(&file.path)?;
    let operation = file
        .operation
        .as_deref()
        .unwrap_or("upsert")
        .trim()
        .to_lowercase();

    if operation == "delete" || operation == "remove" {
        return Ok(json!({
            "path": path,
            "mode": "100644",
            "type": "blob",
            "sha": null,
        }));
    }

    let content = file
        .content
        .as_deref()
        .ok_or_else(|| format!("GitHub file change for {path} is missing content."))?;

    Ok(json!({
        "path": path,
        "mode": "100644",
        "type": "blob",
        "content": content,
    }))
}

fn decode_github_file_content(
    content: Option<&str>,
    encoding: Option<&str>,
) -> Result<Vec<u8>, String> {
    let content =
        content.ok_or_else(|| "GitHub file response did not include content.".to_string())?;
    let encoding = encoding.unwrap_or("base64").to_lowercase();

    if encoding != "base64" {
        return Err(format!("Unsupported GitHub file encoding: {encoding}"));
    }

    general_purpose::STANDARD
        .decode(content.replace(['\n', '\r'], ""))
        .map_err(|error| format!("Could not decode GitHub file content: {error}"))
}

fn normalize_token(token: &str) -> Result<String, String> {
    let token = token.trim();

    if token.len() < 20 {
        return Err(
            "Connect GitHub with browser login or paste a token with repository access."
                .to_string(),
        );
    }

    Ok(token.to_string())
}

fn normalize_oauth_client_id(client_id: &str) -> Result<String, String> {
    let client_id = client_id.trim();

    if client_id.len() < 8 {
        return Err("Add a GitHub OAuth app client ID before browser login.".to_string());
    }

    if !client_id
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_'))
    {
        return Err("GitHub OAuth app client ID contains unsupported characters.".to_string());
    }

    Ok(client_id.to_string())
}

fn normalize_oauth_scope(scope: Option<&str>) -> Result<String, String> {
    let scope = scope
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_OAUTH_SCOPE);
    let scopes = scope
        .split_whitespace()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();

    if scopes.is_empty() {
        return Ok(DEFAULT_OAUTH_SCOPE.to_string());
    }

    for scope in &scopes {
        if !scope.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, ':' | '.' | '-' | '_')
        }) {
            return Err(format!("GitHub OAuth scope is invalid: {scope}"));
        }
    }

    Ok(scopes.join(" "))
}

fn normalize_device_code(device_code: &str) -> Result<String, String> {
    let device_code = device_code.trim();

    if device_code.len() < 20 {
        return Err("GitHub browser login session is missing its device code.".to_string());
    }

    Ok(device_code.to_string())
}

fn normalize_owner(owner: &str) -> Result<String, String> {
    normalize_slug(owner, "owner")
}

fn normalize_repo(repo: &str) -> Result<String, String> {
    normalize_slug(repo, "repository")
}

fn normalize_slug(value: &str, label: &str) -> Result<String, String> {
    let value = value.trim();

    if value.is_empty() {
        return Err(format!("GitHub {label} is required."));
    }

    if value.contains('/') || value.contains('\\') {
        return Err(format!("GitHub {label} must not contain a slash."));
    }

    if !value
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.'))
    {
        return Err(format!(
            "GitHub {label} may only contain letters, numbers, dots, dashes, or underscores."
        ));
    }

    Ok(value.to_string())
}

fn normalize_repo_path(path: &str) -> Result<String, String> {
    let path = path.trim().replace('\\', "/");

    if path.is_empty() {
        return Err("GitHub file path is required.".to_string());
    }

    if path.starts_with('/') || path.contains("../") || path == ".." || path.contains('\0') {
        return Err("GitHub file path must stay inside the repository.".to_string());
    }

    Ok(path)
}

fn normalize_optional_repo_path(path: Option<String>) -> Result<Option<String>, String> {
    path.map(|path| normalize_repo_path(&path)).transpose()
}

fn normalize_required_text(value: &str, label: &str) -> Result<String, String> {
    let value = value.trim();

    if value.is_empty() {
        return Err(format!("GitHub {label} is required."));
    }

    if value.contains('\0') {
        return Err(format!("GitHub {label} is invalid."));
    }

    Ok(value.to_string())
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty() && !value.contains('\0'))
}

fn normalize_make_latest(value: Option<String>) -> Result<Option<String>, String> {
    let Some(value) = normalize_optional_text(value) else {
        return Ok(None);
    };
    let normalized = value.to_lowercase();

    if matches!(normalized.as_str(), "true" | "false" | "legacy") {
        return Ok(Some(normalized));
    }

    Err("GitHub release makeLatest must be true, false, or legacy.".to_string())
}

fn normalize_workflow_inputs(inputs: Option<Value>) -> Result<Option<Value>, String> {
    let Some(inputs) = inputs else {
        return Ok(None);
    };

    if inputs.is_null() {
        return Ok(None);
    }

    if inputs.is_object() {
        return Ok(Some(inputs));
    }

    Err("GitHub workflow inputs must be a JSON object.".to_string())
}

fn insert_optional_payload_string(payload: &mut Value, key: &str, value: Option<String>) {
    if let Some(value) = value {
        payload[key] = Value::String(value);
    }
}

fn normalize_branch(branch: &str) -> Result<String, String> {
    let branch = branch.trim().trim_start_matches("refs/heads/");

    if branch.is_empty() || branch.starts_with('/') || branch.ends_with('/') {
        return Err("GitHub branch name is required.".to_string());
    }

    if branch.contains("..") || branch.contains('\\') || branch.contains('\0') {
        return Err("GitHub branch name is invalid.".to_string());
    }

    Ok(branch.to_string())
}

fn normalize_optional_branch(branch: String) -> Option<String> {
    normalize_branch(&branch).ok()
}

fn normalize_commit_message(message: &str) -> Result<String, String> {
    let message = message.trim();

    if message.len() < 3 {
        return Err("GitHub commit message is too short.".to_string());
    }

    Ok(message.to_string())
}

fn clamp_per_page(per_page: Option<usize>) -> usize {
    per_page.unwrap_or(DEFAULT_PER_PAGE).clamp(1, MAX_PER_PAGE)
}

fn sanitize_enum<'a>(value: Option<&'a str>, allowed: &[&str], fallback: &'a str) -> &'a str {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return fallback;
    };

    if allowed
        .iter()
        .any(|candidate| candidate.eq_ignore_ascii_case(value))
    {
        value
    } else {
        fallback
    }
}

fn parse_scope_header(value: &str) -> Vec<String> {
    value
        .split(',')
        .map(str::trim)
        .filter(|scope| !scope.is_empty())
        .map(ToString::to_string)
        .collect()
}

fn device_login_error_response(
    error: &str,
    description: Option<&str>,
    interval: Option<u64>,
) -> GithubDeviceLoginPollResponse {
    let message = description
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);

    match error {
        "authorization_pending" => GithubDeviceLoginPollResponse {
            connection: None,
            error: None,
            interval,
            message: message.or_else(|| Some("Waiting for GitHub authorization.".to_string())),
            status: "pending".to_string(),
        },
        "slow_down" => GithubDeviceLoginPollResponse {
            connection: None,
            error: None,
            interval,
            message: message.or_else(|| Some("GitHub asked us to poll less often.".to_string())),
            status: "slowDown".to_string(),
        },
        "expired_token" => GithubDeviceLoginPollResponse {
            connection: None,
            error: Some("GitHub browser login expired. Start a new sign-in.".to_string()),
            interval: None,
            message,
            status: "expired".to_string(),
        },
        "access_denied" => GithubDeviceLoginPollResponse {
            connection: None,
            error: Some("GitHub browser login was denied.".to_string()),
            interval: None,
            message,
            status: "denied".to_string(),
        },
        _ => GithubDeviceLoginPollResponse {
            connection: None,
            error: Some(format!("GitHub browser login failed: {error}")),
            interval: None,
            message,
            status: "error".to_string(),
        },
    }
}

fn format_github_error(status: u16, body: &str) -> String {
    let message = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|value| {
            value
                .get("message")
                .and_then(Value::as_str)
                .map(ToString::to_string)
        })
        .filter(|message| !message.trim().is_empty())
        .unwrap_or_else(|| body.chars().take(320).collect::<String>());

    format!("GitHub request failed with HTTP {status}: {message}")
}

fn parse_api_url(path: &str) -> Result<reqwest::Url, String> {
    reqwest::Url::parse(&format!("{GITHUB_API_URL}{path}"))
        .map_err(|error| format!("Could not build GitHub URL: {error}"))
}

fn encode_form_body(pairs: &[(&str, &str)]) -> String {
    pairs
        .iter()
        .map(|(key, value)| {
            format!(
                "{}={}",
                encode_path_segment(key),
                encode_path_segment(value)
            )
        })
        .collect::<Vec<_>>()
        .join("&")
}

fn open_external_url(url: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let command = Command::new("cmd").args(["/C", "start", "", url]).spawn();

    #[cfg(target_os = "macos")]
    let command = Command::new("open").arg(url).spawn();

    #[cfg(all(unix, not(target_os = "macos")))]
    let command = Command::new("xdg-open").arg(url).spawn();

    command
        .map(|_| ())
        .map_err(|error| format!("Could not open the GitHub browser login page: {error}"))
}

fn encode_repo_path(path: &str) -> String {
    path.split('/')
        .map(encode_path_segment)
        .collect::<Vec<_>>()
        .join("/")
}

fn encode_path_segment(segment: &str) -> String {
    let mut encoded = String::new();

    for byte in segment.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            encoded.push(byte as char);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }

    encoded
}

fn load_database(app: &tauri::AppHandle) -> Result<GithubDatabase, String> {
    let namespace = auth::current_user_storage_namespace(app)?;
    clear_shared_database(app)?;

    if let Some(content) = storage::read_value(app, &namespace, GITHUB_DATABASE_STORAGE_KEY)? {
        cleanup_legacy_database(app)?;
        return parse_database_content(&content, "Gilbert Database GitHub account store");
    }

    let database_path = legacy_database_path(app)?;

    if !database_path.exists() {
        return Ok(fresh_database());
    }

    let content = fs::read_to_string(&database_path).map_err(|error| {
        format!(
            "Could not read the GitHub account store at {}: {}",
            path_to_string(&database_path),
            error
        )
    })?;

    if content.trim().is_empty() {
        return Ok(fresh_database());
    }

    let database = parse_database_content(
        &content,
        &format!(
            "legacy GitHub account store at {}",
            path_to_string(&database_path)
        ),
    )?;
    let migrated_content = serde_json::to_string_pretty(&database).map_err(|error| {
        format!("Could not serialize the migrated GitHub account store: {error}")
    })?;
    storage::write_value(
        app,
        &namespace,
        GITHUB_DATABASE_STORAGE_KEY,
        &migrated_content,
    )?;
    delete_legacy_file(&database_path, "GitHub account store")?;

    Ok(database)
}

fn save_database(app: &tauri::AppHandle, database: &GithubDatabase) -> Result<(), String> {
    let namespace = auth::current_user_storage_namespace(app)?;
    clear_shared_database(app)?;
    let content = serde_json::to_string_pretty(database)
        .map_err(|error| format!("Could not serialize the GitHub account store: {error}"))?;

    storage::write_value(app, &namespace, GITHUB_DATABASE_STORAGE_KEY, &content).map_err(|error| {
        format!("Could not write the GitHub account store to Gilbert Database: {error}")
    })
}

fn clear_shared_database(app: &tauri::AppHandle) -> Result<(), String> {
    let Some(content) = storage::read_value(app, SYSTEM_NAMESPACE, GITHUB_DATABASE_STORAGE_KEY)?
    else {
        return Ok(());
    };

    if parse_database_content(&content, "shared GitHub account store")
        .map(|database| database.token.is_none() && database.user.is_none())
        .unwrap_or(false)
    {
        return Ok(());
    };

    let content = serde_json::to_string_pretty(&fresh_database()).map_err(|error| {
        format!("Could not serialize the cleared shared GitHub account store: {error}")
    })?;
    storage::write_value(app, SYSTEM_NAMESPACE, GITHUB_DATABASE_STORAGE_KEY, &content)
        .map_err(|error| format!("Could not clear the shared GitHub account store: {error}"))
}

fn parse_database_content(content: &str, source: &str) -> Result<GithubDatabase, String> {
    let database = serde_json::from_str::<GithubDatabase>(content).map_err(|error| {
        format!("Could not parse the GitHub account store from {source}: {error}")
    })?;

    if database.database_generation != GITHUB_DATABASE_GENERATION {
        return Ok(fresh_database());
    }

    Ok(database)
}

fn legacy_database_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("github").join(GITHUB_DATABASE_FILE))
        .map_err(|error| format!("Could not resolve the local app data folder: {error}"))
}

fn cleanup_legacy_database(app: &tauri::AppHandle) -> Result<(), String> {
    let database_path = legacy_database_path(app)?;
    delete_legacy_file(&database_path, "GitHub account store")
}

fn fresh_database() -> GithubDatabase {
    GithubDatabase {
        connected_at: None,
        database_generation: GITHUB_DATABASE_GENERATION,
        scopes: Vec::new(),
        token: None,
        user: None,
    }
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u64::MAX as u128) as u64)
        .unwrap_or_default()
}

fn path_to_string(path: impl AsRef<std::path::Path>) -> String {
    path.as_ref().to_string_lossy().to_string()
}

fn delete_legacy_file(path: &PathBuf, label: &str) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }

    fs::remove_file(path).map_err(|error| {
        format!(
            "Could not remove the old {label} at {}: {error}",
            path_to_string(path)
        )
    })?;

    if let Some(parent) = path.parent() {
        let is_empty = fs::read_dir(parent)
            .map(|mut entries| entries.next().is_none())
            .unwrap_or(false);

        if is_empty {
            let _ = fs::remove_dir(parent);
        }
    }

    Ok(())
}
