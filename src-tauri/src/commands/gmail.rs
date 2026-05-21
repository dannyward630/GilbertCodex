//! Gmail desktop commands for Google OAuth, account state, and token storage.

use crate::{
    commands::auth,
    core::storage::{self, SYSTEM_NAMESPACE},
};
use base64::{engine::general_purpose, Engine as _};
use regex::Regex;
use reqwest::Method;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::{
    io::{BufRead, BufReader, ErrorKind, Write},
    net::TcpListener,
    process::{Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

const GOOGLE_OAUTH_AUTHORIZE_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_OAUTH_TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL: &str = "https://openidconnect.googleapis.com/v1/userinfo";
const GMAIL_API_BASE_URL: &str = "https://gmail.googleapis.com/gmail/v1/users/me";
const GMAIL_API_ROOT_URL: &str = "https://gmail.googleapis.com/gmail/v1";
const GMAIL_PROFILE_URL: &str = "https://gmail.googleapis.com/gmail/v1/users/me/profile";
const GMAIL_DATABASE_STORAGE_KEY: &str = "gmail-account.v1";
const GOOGLE_OAUTH_SETTINGS_STORAGE_KEY: &str = "gilbert-codex.google-oauth-settings.v1";
const GMAIL_DATABASE_GENERATION: u32 = 2;
const DEFAULT_OAUTH_SCOPE: &str = concat!(
    "openid email profile ",
    "https://mail.google.com/ ",
    "https://www.googleapis.com/auth/gmail.modify ",
    "https://www.googleapis.com/auth/gmail.compose ",
    "https://www.googleapis.com/auth/gmail.send ",
    "https://www.googleapis.com/auth/gmail.labels ",
    "https://www.googleapis.com/auth/gmail.settings.basic ",
    "https://www.googleapis.com/auth/gmail.settings.sharing"
);
const OAUTH_CALLBACK_PATH: &str = "/oauth2/callback";
const OAUTH_CALLBACK_TIMEOUT_SECS: u64 = 180;
const GOOGLE_HTTP_TIMEOUT_SECS: u64 = 18;
const GOOGLE_HTTP_CONNECT_TIMEOUT_SECS: u64 = 8;
const ACCESS_TOKEN_REFRESH_GRACE_MILLIS: u64 = 60_000;
const DEFAULT_LIST_MESSAGE_COUNT: u32 = 10;
const MAX_GMAIL_ACCOUNTS: usize = 6;
const MAX_BATCH_MODIFY_MESSAGE_IDS: usize = 1000;
const MAX_BULK_SEND_RECIPIENTS: usize = 50;
const MAX_LIST_MESSAGE_COUNT: u32 = 25;
const DEFAULT_MESSAGE_BODY_CHARS: usize = 16_000;
const MAX_MESSAGE_BODY_CHARS: usize = 60_000;
const USER_AGENT: &str = "GilbertCodex/0.1 (desktop Gmail)";

#[derive(Default)]
pub struct GmailState {
    lock: Mutex<()>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GmailUser {
    pub email: String,
    pub email_verified: Option<bool>,
    pub name: Option<String>,
    pub picture: Option<String>,
    pub sub: Option<String>,
}

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
struct GmailDatabase {
    access_token: Option<String>,
    accounts: Vec<GmailAccountRecord>,
    active_account_email: Option<String>,
    connected_at: Option<u64>,
    database_generation: u32,
    expires_at: Option<u64>,
    last_connection_error: Option<String>,
    oauth_client_id: Option<String>,
    plugin_installed: bool,
    plugin_installed_at: Option<u64>,
    refresh_token: Option<String>,
    scopes: Vec<String>,
    user: Option<GmailUser>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
struct GmailAccountRecord {
    access_token: Option<String>,
    connected_at: Option<u64>,
    expires_at: Option<u64>,
    oauth_client_id: Option<String>,
    refresh_token: Option<String>,
    scopes: Vec<String>,
    user: GmailUser,
}

impl Default for GmailAccountRecord {
    fn default() -> Self {
        Self {
            access_token: None,
            connected_at: None,
            expires_at: None,
            oauth_client_id: None,
            refresh_token: None,
            scopes: Vec::new(),
            user: GmailUser {
                email: String::new(),
                email_verified: None,
                name: None,
                picture: None,
                sub: None,
            },
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GmailConnectionState {
    pub accounts: Vec<GmailAccountState>,
    pub active_account_email: Option<String>,
    pub connected: bool,
    pub connected_at: Option<u64>,
    pub expires_at: Option<u64>,
    pub last_connection_error: Option<String>,
    pub max_accounts: usize,
    pub plugin_installed: bool,
    pub plugin_installed_at: Option<u64>,
    pub scopes: Vec<String>,
    pub user: Option<GmailUser>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GmailAccountState {
    pub active: bool,
    pub connected_at: Option<u64>,
    pub email: String,
    pub expires_at: Option<u64>,
    pub scopes: Vec<String>,
    pub user: GmailUser,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GmailConnectOAuthRequest {
    pub client_id: String,
    pub client_secret: Option<String>,
    pub scope: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoogleOAuthSettingsRecord {
    client_id: Option<String>,
    client_secret: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GoogleOAuthTokenResponse {
    access_token: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
    expires_in: Option<u64>,
    refresh_token: Option<String>,
    scope: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GoogleUserInfoResponse {
    email: Option<String>,
    email_verified: Option<bool>,
    name: Option<String>,
    picture: Option<String>,
    sub: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GmailProfileResponse {
    email_address: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GmailAuthenticatedRequest {
    pub account_email: Option<String>,
    pub client_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GmailListMessagesRequest {
    pub account_email: Option<String>,
    pub client_id: Option<String>,
    pub include_spam_trash: Option<bool>,
    pub label_ids: Option<Vec<String>>,
    pub max_results: Option<u32>,
    pub page_token: Option<String>,
    pub query: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GmailGetMessageRequest {
    pub account_email: Option<String>,
    pub client_id: Option<String>,
    pub id: String,
    pub include_body: Option<bool>,
    pub max_body_chars: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GmailGetThreadRequest {
    pub account_email: Option<String>,
    pub client_id: Option<String>,
    pub id: String,
    pub include_body: Option<bool>,
    pub max_body_chars: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GmailCreateDraftRequest {
    pub account_email: Option<String>,
    pub bcc: Option<Vec<String>>,
    pub body: String,
    pub cc: Option<Vec<String>>,
    pub client_id: Option<String>,
    pub content_type: Option<String>,
    pub from: Option<String>,
    pub in_reply_to: Option<String>,
    pub references: Option<String>,
    pub subject: String,
    pub thread_id: Option<String>,
    pub to: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GmailSendMessageRequest {
    pub account_email: Option<String>,
    pub bcc: Option<Vec<String>>,
    pub body: String,
    pub cc: Option<Vec<String>>,
    pub client_id: Option<String>,
    pub content_type: Option<String>,
    pub from: Option<String>,
    pub in_reply_to: Option<String>,
    pub references: Option<String>,
    pub subject: String,
    pub thread_id: Option<String>,
    pub to: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GmailSendSeparateMessagesRequest {
    pub account_email: Option<String>,
    pub body: String,
    pub client_id: Option<String>,
    pub content_type: Option<String>,
    pub from: Option<String>,
    pub subject: String,
    pub to: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GmailSendDraftRequest {
    pub account_email: Option<String>,
    pub client_id: Option<String>,
    pub draft_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GmailDeleteDraftRequest {
    pub account_email: Option<String>,
    pub client_id: Option<String>,
    pub draft_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GmailModifyMessageLabelsRequest {
    pub add_label_ids: Option<Vec<String>>,
    pub account_email: Option<String>,
    pub client_id: Option<String>,
    pub id: String,
    pub remove_label_ids: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GmailBatchModifyMessagesRequest {
    pub account_email: Option<String>,
    pub add_label_ids: Option<Vec<String>>,
    pub client_id: Option<String>,
    pub ids: Vec<String>,
    pub remove_label_ids: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GmailMessageIdRequest {
    pub account_email: Option<String>,
    pub client_id: Option<String>,
    pub id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GmailCreateLabelRequest {
    pub account_email: Option<String>,
    pub client_id: Option<String>,
    pub label_list_visibility: Option<String>,
    pub message_list_visibility: Option<String>,
    pub name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GmailAccountEmailRequest {
    pub email: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GmailApiRequest {
    pub account_email: Option<String>,
    pub body: Option<Value>,
    pub client_id: Option<String>,
    pub method: String,
    pub path: String,
    pub query: Option<Map<String, Value>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GmailMessageListResponse {
    pub messages: Vec<GmailMessageSummary>,
    pub next_page_token: Option<String>,
    pub result_size_estimate: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GmailMessageSummary {
    pub account_email: Option<String>,
    pub id: String,
    pub thread_id: Option<String>,
    pub subject: Option<String>,
    pub from: Option<String>,
    pub to: Option<String>,
    pub date: Option<String>,
    pub snippet: Option<String>,
    pub label_ids: Vec<String>,
    pub internal_date: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GmailMessageDetail {
    pub account_email: Option<String>,
    pub id: String,
    pub thread_id: Option<String>,
    pub subject: Option<String>,
    pub from: Option<String>,
    pub to: Option<String>,
    pub cc: Option<String>,
    pub bcc: Option<String>,
    pub date: Option<String>,
    pub message_id: Option<String>,
    pub in_reply_to: Option<String>,
    pub references: Option<String>,
    pub snippet: Option<String>,
    pub label_ids: Vec<String>,
    pub internal_date: Option<String>,
    pub body: Option<String>,
    pub body_truncated: bool,
    pub attachments: Vec<GmailAttachmentSummary>,
    pub links: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GmailThreadDetail {
    pub id: String,
    pub messages: Vec<GmailMessageDetail>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GmailAttachmentSummary {
    pub attachment_id: Option<String>,
    pub content_id: Option<String>,
    pub filename: String,
    pub is_image: bool,
    pub mime_type: Option<String>,
    pub size: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GmailLabel {
    pub id: String,
    pub name: String,
    pub label_type: Option<String>,
    pub message_list_visibility: Option<String>,
    pub label_list_visibility: Option<String>,
    pub messages_total: Option<u32>,
    pub messages_unread: Option<u32>,
    pub threads_total: Option<u32>,
    pub threads_unread: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GmailLabelsResponse {
    pub labels: Vec<GmailLabel>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GmailDraftResponse {
    pub id: String,
    pub message: Option<GmailMessageSummary>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GmailSendSeparateMessagesResponse {
    pub account_email: Option<String>,
    pub failed_count: usize,
    pub results: Vec<GmailSendSeparateMessageResult>,
    pub sent_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GmailSendSeparateMessageResult {
    pub error: Option<String>,
    pub message: Option<GmailMessageSummary>,
    pub ok: bool,
    pub to: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GmailActionResponse {
    pub account_email: Option<String>,
    pub message: String,
    pub message_detail: Option<GmailMessageSummary>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GmailBatchActionResponse {
    pub account_email: Option<String>,
    pub message: String,
    pub modified_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GmailApiResponse {
    pub account_email: Option<String>,
    pub data: Value,
    pub message: String,
    pub method: String,
    pub path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GmailApiListMessagesResponse {
    messages: Option<Vec<GmailApiMessageRef>>,
    next_page_token: Option<String>,
    result_size_estimate: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GmailApiMessageRef {
    id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GmailApiThread {
    id: Option<String>,
    messages: Option<Vec<GmailApiMessage>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GmailApiMessage {
    id: Option<String>,
    thread_id: Option<String>,
    label_ids: Option<Vec<String>>,
    snippet: Option<String>,
    internal_date: Option<String>,
    payload: Option<GmailApiPayload>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GmailApiPayload {
    body: Option<GmailApiMessageBody>,
    filename: Option<String>,
    headers: Option<Vec<GmailApiHeader>>,
    mime_type: Option<String>,
    parts: Option<Vec<GmailApiPayload>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GmailApiMessageBody {
    attachment_id: Option<String>,
    data: Option<String>,
    size: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct GmailApiHeader {
    name: String,
    value: String,
}

#[derive(Debug, Deserialize)]
struct GmailApiLabelsResponse {
    labels: Option<Vec<GmailApiLabel>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GmailApiLabel {
    id: Option<String>,
    name: Option<String>,
    #[serde(rename = "type")]
    label_type: Option<String>,
    message_list_visibility: Option<String>,
    label_list_visibility: Option<String>,
    messages_total: Option<u32>,
    messages_unread: Option<u32>,
    threads_total: Option<u32>,
    threads_unread: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct GmailApiDraft {
    id: Option<String>,
    message: Option<GmailApiMessage>,
}

struct OAuthCallback {
    code: String,
}

struct GmailAccess {
    access_token: String,
    account_email: String,
    user: GmailUser,
}

#[tauri::command]
pub fn gmail_get_state(
    app: tauri::AppHandle,
    state: tauri::State<'_, GmailState>,
) -> Result<GmailConnectionState, String> {
    let _guard = state
        .lock
        .lock()
        .map_err(|_| "The Gmail account store is busy. Try again in a moment.".to_string())?;
    let mut database = load_database(&app)?;

    if clear_resolved_setup_error(&app, &mut database) {
        save_database(&app, &database)?;
    }

    Ok(create_connection_state(&database))
}

#[tauri::command]
pub fn gmail_install_plugin(
    app: tauri::AppHandle,
    state: tauri::State<'_, GmailState>,
) -> Result<GmailConnectionState, String> {
    let _guard = state
        .lock
        .lock()
        .map_err(|_| "The Gmail account store is busy. Try again in a moment.".to_string())?;
    let mut database = load_database(&app)?;

    mark_plugin_installed(&mut database);
    clear_resolved_setup_error(&app, &mut database);
    save_database(&app, &database)?;

    Ok(create_connection_state(&database))
}

#[tauri::command]
pub async fn gmail_connect_oauth(
    app: tauri::AppHandle,
    state: tauri::State<'_, GmailState>,
    request: GmailConnectOAuthRequest,
) -> Result<GmailConnectionState, String> {
    let client_id = normalize_oauth_client_id(&request.client_id)?;
    let client_secret =
        resolve_oauth_client_secret(&app, Some(&client_id), request.client_secret.as_deref())?;
    let scope = normalize_oauth_scope(request.scope.as_deref())?;
    let previous_database = {
        let _guard = state
            .lock
            .lock()
            .map_err(|_| "The Gmail account store is busy. Try again in a moment.".to_string())?;
        let mut database = load_database(&app)?;

        mark_plugin_installed(&mut database);
        save_database(&app, &database)?;
        database
    };

    let connection_result: Result<GmailAccountRecord, String> = async {
        let oauth_session = create_oauth_session(&client_id, &scope)?;
        open_external_url(&oauth_session.authorization_url)?;

        let expected_state = oauth_session.state.clone();
        let callback = tauri::async_runtime::spawn_blocking(move || {
            wait_for_oauth_callback(oauth_session.listener, expected_state)
        })
        .await
        .map_err(|error| format!("Gmail sign-in callback listener failed: {error}"))??;

        let client = google_client()?;
        let token_response = exchange_oauth_code(
            &client,
            &client_id,
            &client_secret,
            &callback.code,
            &oauth_session.redirect_uri,
            &oauth_session.code_verifier,
        )
        .await?;
        let access_token = token_response
            .access_token
            .as_deref()
            .map(str::trim)
            .filter(|token| !token.is_empty())
            .ok_or_else(|| "Google did not return a Gmail access token.".to_string())?
            .to_string();
        let gmail_profile = fetch_gmail_profile(&client, &access_token).await?;
        let user_info = fetch_google_user_info(&client, &access_token).await.ok();
        let user = GmailUser {
            email: user_info
                .as_ref()
                .and_then(|info| info.email.clone())
                .filter(|email| !email.trim().is_empty())
                .unwrap_or(gmail_profile.email_address),
            email_verified: user_info.as_ref().and_then(|info| info.email_verified),
            name: user_info.as_ref().and_then(|info| info.name.clone()),
            picture: user_info.as_ref().and_then(|info| info.picture.clone()),
            sub: user_info.as_ref().and_then(|info| info.sub.clone()),
        };
        let scopes = token_response
            .scope
            .as_deref()
            .map(split_scope)
            .filter(|scopes| !scopes.is_empty())
            .unwrap_or_else(|| split_scope(&scope));
        let refresh_token = token_response
            .refresh_token
            .as_deref()
            .map(str::trim)
            .filter(|token| !token.is_empty())
            .map(ToString::to_string)
            .or_else(|| {
                previous_database
                    .accounts
                    .iter()
                    .find(|account| account.user.email.eq_ignore_ascii_case(&user.email))
                    .and_then(|account| account.refresh_token.clone())
            })
            .or(previous_database.refresh_token);
        let now = now_millis();
        let expires_at = token_response
            .expires_in
            .map(|seconds| now.saturating_add(seconds.saturating_mul(1000)));

        Ok(GmailAccountRecord {
            access_token: Some(access_token),
            connected_at: Some(now),
            expires_at,
            oauth_client_id: Some(client_id.clone()),
            refresh_token,
            scopes,
            user,
        })
    }
    .await;
    let account = match connection_result {
        Ok(account) => account,
        Err(error) => {
            let _guard = state.lock.lock().map_err(|_| {
                "The Gmail account store is busy. Try again in a moment.".to_string()
            })?;
            let mut database = load_database(&app)?;

            mark_plugin_installed(&mut database);
            database.last_connection_error = Some(format_connection_error_for_storage(&error));
            save_database(&app, &database)?;

            return Err(error);
        }
    };

    {
        let _guard = state
            .lock
            .lock()
            .map_err(|_| "The Gmail account store is busy. Try again in a moment.".to_string())?;
        let mut database = load_database(&app)?;

        mark_plugin_installed(&mut database);
        database.last_connection_error = None;
        upsert_connected_account(&mut database, account)?;
        save_database(&app, &database)?;

        Ok(create_connection_state(&database))
    }
}

#[tauri::command]
pub fn gmail_disconnect(
    app: tauri::AppHandle,
    state: tauri::State<'_, GmailState>,
) -> Result<GmailConnectionState, String> {
    let _guard = state
        .lock
        .lock()
        .map_err(|_| "The Gmail account store is busy. Try again in a moment.".to_string())?;
    let previous_database = load_database(&app)?;
    let mut database = fresh_database();

    database.plugin_installed = previous_database.plugin_installed;
    database.plugin_installed_at = previous_database.plugin_installed_at;

    save_database(&app, &database)?;

    Ok(create_connection_state(&database))
}

#[tauri::command]
pub fn gmail_disconnect_account(
    app: tauri::AppHandle,
    state: tauri::State<'_, GmailState>,
    request: GmailAccountEmailRequest,
) -> Result<GmailConnectionState, String> {
    let _guard = state
        .lock
        .lock()
        .map_err(|_| "The Gmail account store is busy. Try again in a moment.".to_string())?;
    let mut database = load_database(&app)?;

    remove_connected_account(&mut database, &request.email)?;
    database.plugin_installed = true;
    save_database(&app, &database)?;

    Ok(create_connection_state(&database))
}

#[tauri::command]
pub fn gmail_set_active_account(
    app: tauri::AppHandle,
    state: tauri::State<'_, GmailState>,
    request: GmailAccountEmailRequest,
) -> Result<GmailConnectionState, String> {
    let _guard = state
        .lock
        .lock()
        .map_err(|_| "The Gmail account store is busy. Try again in a moment.".to_string())?;
    let mut database = load_database(&app)?;

    set_active_account(&mut database, &request.email)?;
    save_database(&app, &database)?;

    Ok(create_connection_state(&database))
}

#[tauri::command]
pub async fn gmail_list_messages(
    app: tauri::AppHandle,
    state: tauri::State<'_, GmailState>,
    request: GmailListMessagesRequest,
) -> Result<GmailMessageListResponse, String> {
    let gmail_access = load_usable_access_token(
        &app,
        &state,
        request.client_id.as_deref(),
        request.account_email.as_deref(),
    )
    .await?;
    let client = google_client()?;
    let mut url = gmail_api_url("messages")?;
    let max_results = request
        .max_results
        .unwrap_or(DEFAULT_LIST_MESSAGE_COUNT)
        .clamp(1, MAX_LIST_MESSAGE_COUNT);

    {
        let mut query = url.query_pairs_mut();
        query.append_pair("maxResults", &max_results.to_string());
        if request.include_spam_trash.unwrap_or(false) {
            query.append_pair("includeSpamTrash", "true");
        }
        if let Some(search_query) = request
            .query
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            query.append_pair("q", search_query);
        }
        if let Some(page_token) = request
            .page_token
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            query.append_pair("pageToken", page_token);
        }
        if let Some(label_ids) = request.label_ids.as_ref() {
            for label_id in label_ids
                .iter()
                .map(String::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                query.append_pair("labelIds", label_id);
            }
        }
    }

    let list_response = google_api::<GmailApiListMessagesResponse>(
        &client,
        &gmail_access.access_token,
        Method::GET,
        url.as_str(),
    )
    .await?;
    let mut messages = Vec::new();

    for message_ref in list_response.messages.unwrap_or_default() {
        let message =
            fetch_gmail_message(&client, &gmail_access.access_token, &message_ref.id, false)
                .await?;
        messages.push(with_summary_account(
            summarize_api_message(message),
            &gmail_access.account_email,
        ));
    }

    Ok(GmailMessageListResponse {
        messages,
        next_page_token: list_response.next_page_token,
        result_size_estimate: list_response.result_size_estimate,
    })
}

#[tauri::command]
pub async fn gmail_get_message(
    app: tauri::AppHandle,
    state: tauri::State<'_, GmailState>,
    request: GmailGetMessageRequest,
) -> Result<GmailMessageDetail, String> {
    let id = normalize_google_id(&request.id, "Gmail message id")?;
    let gmail_access = load_usable_access_token(
        &app,
        &state,
        request.client_id.as_deref(),
        request.account_email.as_deref(),
    )
    .await?;
    let client = google_client()?;
    let include_body = request.include_body.unwrap_or(false);
    let message =
        fetch_gmail_message(&client, &gmail_access.access_token, &id, include_body).await?;

    Ok(with_detail_account(
        detail_api_message(message, normalize_body_char_limit(request.max_body_chars)),
        &gmail_access.account_email,
    ))
}

#[tauri::command]
pub async fn gmail_get_thread(
    app: tauri::AppHandle,
    state: tauri::State<'_, GmailState>,
    request: GmailGetThreadRequest,
) -> Result<GmailThreadDetail, String> {
    let id = normalize_google_id(&request.id, "Gmail thread id")?;
    let gmail_access = load_usable_access_token(
        &app,
        &state,
        request.client_id.as_deref(),
        request.account_email.as_deref(),
    )
    .await?;
    let client = google_client()?;
    let mut url = gmail_api_url(&format!("threads/{id}"))?;
    let include_body = request.include_body.unwrap_or(false);

    url.query_pairs_mut()
        .append_pair("format", if include_body { "full" } else { "metadata" });

    let thread = google_api::<GmailApiThread>(
        &client,
        &gmail_access.access_token,
        Method::GET,
        url.as_str(),
    )
    .await?;
    let max_body_chars = normalize_body_char_limit(request.max_body_chars);

    Ok(GmailThreadDetail {
        id: thread.id.unwrap_or(id),
        messages: thread
            .messages
            .unwrap_or_default()
            .into_iter()
            .map(|message| {
                with_detail_account(
                    detail_api_message(message, max_body_chars),
                    &gmail_access.account_email,
                )
            })
            .collect(),
    })
}

#[tauri::command]
pub async fn gmail_list_labels(
    app: tauri::AppHandle,
    state: tauri::State<'_, GmailState>,
    request: GmailAuthenticatedRequest,
) -> Result<GmailLabelsResponse, String> {
    let gmail_access = load_usable_access_token(
        &app,
        &state,
        request.client_id.as_deref(),
        request.account_email.as_deref(),
    )
    .await?;
    let client = google_client()?;
    let url = gmail_api_url("labels")?;
    let response = google_api::<GmailApiLabelsResponse>(
        &client,
        &gmail_access.access_token,
        Method::GET,
        url.as_str(),
    )
    .await?;

    Ok(GmailLabelsResponse {
        labels: response
            .labels
            .unwrap_or_default()
            .into_iter()
            .filter_map(label_from_api)
            .collect(),
    })
}

#[tauri::command]
pub async fn gmail_create_label(
    app: tauri::AppHandle,
    state: tauri::State<'_, GmailState>,
    request: GmailCreateLabelRequest,
) -> Result<GmailLabel, String> {
    let gmail_access = load_usable_access_token(
        &app,
        &state,
        request.client_id.as_deref(),
        request.account_email.as_deref(),
    )
    .await?;
    let client = google_client()?;
    let name = normalize_non_empty_string(&request.name, "Gmail label name")?;
    let url = gmail_api_url("labels")?;
    let response = google_api_with_json::<GmailApiLabel>(
        &client,
        &gmail_access.access_token,
        Method::POST,
        url.as_str(),
        Some(json!({
            "name": name,
            "labelListVisibility": request.label_list_visibility.as_deref().unwrap_or("labelShow"),
            "messageListVisibility": request.message_list_visibility.as_deref().unwrap_or("show"),
        })),
    )
    .await?;

    label_from_api(response)
        .ok_or_else(|| "Google created the label but did not return its label id.".to_string())
}

#[tauri::command]
pub async fn gmail_create_draft(
    app: tauri::AppHandle,
    state: tauri::State<'_, GmailState>,
    request: GmailCreateDraftRequest,
) -> Result<GmailDraftResponse, String> {
    let gmail_access = load_usable_access_token(
        &app,
        &state,
        request.client_id.as_deref(),
        request.account_email.as_deref(),
    )
    .await?;
    let authenticated_email = gmail_access.user.email.trim();
    let authenticated_email = if authenticated_email.is_empty() {
        None
    } else {
        Some(authenticated_email)
    };
    let client = google_client()?;
    let raw_message = create_rfc2822_message(&request, authenticated_email)?;
    let mut message = json!({
        "raw": general_purpose::URL_SAFE_NO_PAD.encode(raw_message.as_bytes()),
    });

    if let Some(thread_id) = normalize_optional_gmail_thread_id(request.thread_id.as_deref()) {
        message["threadId"] = json!(thread_id);
    }

    let url = gmail_api_url("drafts")?;
    let response = google_api_with_json::<GmailApiDraft>(
        &client,
        &gmail_access.access_token,
        Method::POST,
        url.as_str(),
        Some(json!({ "message": message })),
    )
    .await?;

    Ok(GmailDraftResponse {
        id: response.id.unwrap_or_default(),
        message: response.message.map(|message| {
            with_summary_account(summarize_api_message(message), &gmail_access.account_email)
        }),
    })
}

#[tauri::command]
pub async fn gmail_send_message(
    app: tauri::AppHandle,
    state: tauri::State<'_, GmailState>,
    request: GmailSendMessageRequest,
) -> Result<GmailDraftResponse, String> {
    let gmail_access = load_usable_access_token(
        &app,
        &state,
        request.client_id.as_deref(),
        request.account_email.as_deref(),
    )
    .await?;
    let authenticated_email = gmail_access.user.email.trim();
    let authenticated_email = if authenticated_email.is_empty() {
        None
    } else {
        Some(authenticated_email)
    };
    let client = google_client()?;
    let raw_message = create_rfc2822_send_message(&request, authenticated_email)?;
    let mut message = json!({
        "raw": general_purpose::URL_SAFE_NO_PAD.encode(raw_message.as_bytes()),
    });

    if let Some(thread_id) = normalize_optional_gmail_thread_id(request.thread_id.as_deref()) {
        message["threadId"] = json!(thread_id);
    }

    let url = gmail_api_url("messages/send")?;
    let response = google_api_with_json::<GmailApiMessage>(
        &client,
        &gmail_access.access_token,
        Method::POST,
        url.as_str(),
        Some(message),
    )
    .await?;

    let message_id = response.id.clone().unwrap_or_default();

    Ok(GmailDraftResponse {
        id: message_id,
        message: Some(with_summary_account(
            summarize_api_message(response),
            &gmail_access.account_email,
        )),
    })
}

#[tauri::command]
pub async fn gmail_send_separate_messages(
    app: tauri::AppHandle,
    state: tauri::State<'_, GmailState>,
    request: GmailSendSeparateMessagesRequest,
) -> Result<GmailSendSeparateMessagesResponse, String> {
    let recipients = normalize_email_list(&request.to, "to")?;

    if recipients.len() > MAX_BULK_SEND_RECIPIENTS {
        return Err(format!(
            "Gmail separate send supports up to {MAX_BULK_SEND_RECIPIENTS} recipients per approved run."
        ));
    }

    let gmail_access = load_usable_access_token(
        &app,
        &state,
        request.client_id.as_deref(),
        request.account_email.as_deref(),
    )
    .await?;
    let authenticated_email = gmail_access.user.email.trim();
    let authenticated_email = if authenticated_email.is_empty() {
        None
    } else {
        Some(authenticated_email)
    };
    let client = google_client()?;
    let url = gmail_api_url("messages/send")?;
    let mut results = Vec::new();

    for recipient in recipients {
        let raw_message =
            create_rfc2822_separate_message(&request, &recipient, authenticated_email)?;
        let send_result = google_api_with_json::<GmailApiMessage>(
            &client,
            &gmail_access.access_token,
            Method::POST,
            url.as_str(),
            Some(json!({
                "raw": general_purpose::URL_SAFE_NO_PAD.encode(raw_message.as_bytes()),
            })),
        )
        .await;

        match send_result {
            Ok(message) => results.push(GmailSendSeparateMessageResult {
                error: None,
                message: Some(with_summary_account(
                    summarize_api_message(message),
                    &gmail_access.account_email,
                )),
                ok: true,
                to: recipient,
            }),
            Err(error) => results.push(GmailSendSeparateMessageResult {
                error: Some(error),
                message: None,
                ok: false,
                to: recipient,
            }),
        }
    }

    let sent_count = results.iter().filter(|result| result.ok).count();
    let failed_count = results.len().saturating_sub(sent_count);

    Ok(GmailSendSeparateMessagesResponse {
        account_email: Some(gmail_access.account_email),
        failed_count,
        results,
        sent_count,
    })
}

#[tauri::command]
pub async fn gmail_send_draft(
    app: tauri::AppHandle,
    state: tauri::State<'_, GmailState>,
    request: GmailSendDraftRequest,
) -> Result<GmailDraftResponse, String> {
    let draft_id = normalize_google_id(&request.draft_id, "Gmail draft id")?;
    let gmail_access = load_usable_access_token(
        &app,
        &state,
        request.client_id.as_deref(),
        request.account_email.as_deref(),
    )
    .await?;
    let client = google_client()?;
    let url = gmail_api_url("drafts/send")?;
    let response = google_api_with_json::<GmailApiMessage>(
        &client,
        &gmail_access.access_token,
        Method::POST,
        url.as_str(),
        Some(json!({ "id": draft_id })),
    )
    .await?;

    Ok(GmailDraftResponse {
        id: draft_id,
        message: Some(with_summary_account(
            summarize_api_message(response),
            &gmail_access.account_email,
        )),
    })
}

#[tauri::command]
pub async fn gmail_delete_draft(
    app: tauri::AppHandle,
    state: tauri::State<'_, GmailState>,
    request: GmailDeleteDraftRequest,
) -> Result<GmailActionResponse, String> {
    let draft_id = normalize_google_id(&request.draft_id, "Gmail draft id")?;
    let gmail_access = load_usable_access_token(
        &app,
        &state,
        request.client_id.as_deref(),
        request.account_email.as_deref(),
    )
    .await?;
    let client = google_client()?;
    let url = gmail_api_url(&format!("drafts/{draft_id}"))?;

    google_api_empty(
        &client,
        &gmail_access.access_token,
        Method::DELETE,
        url.as_str(),
        None,
    )
    .await?;

    Ok(GmailActionResponse {
        account_email: Some(gmail_access.account_email),
        message: format!("Deleted Gmail draft {draft_id}."),
        message_detail: None,
    })
}

#[tauri::command]
pub async fn gmail_modify_message_labels(
    app: tauri::AppHandle,
    state: tauri::State<'_, GmailState>,
    request: GmailModifyMessageLabelsRequest,
) -> Result<GmailActionResponse, String> {
    let id = normalize_google_id(&request.id, "Gmail message id")?;
    let add_label_ids = normalize_label_ids(request.add_label_ids.as_deref());
    let remove_label_ids = normalize_label_ids(request.remove_label_ids.as_deref());

    if add_label_ids.is_empty() && remove_label_ids.is_empty() {
        return Err("Add or remove at least one Gmail label id.".to_string());
    }

    let gmail_access = load_usable_access_token(
        &app,
        &state,
        request.client_id.as_deref(),
        request.account_email.as_deref(),
    )
    .await?;
    let client = google_client()?;
    let url = gmail_api_url(&format!("messages/{id}/modify"))?;
    let response = google_api_with_json::<GmailApiMessage>(
        &client,
        &gmail_access.access_token,
        Method::POST,
        url.as_str(),
        Some(json!({
            "addLabelIds": add_label_ids,
            "removeLabelIds": remove_label_ids,
        })),
    )
    .await?;

    Ok(GmailActionResponse {
        account_email: Some(gmail_access.account_email.clone()),
        message: format!("Updated Gmail labels for message {id}."),
        message_detail: Some(with_summary_account(
            summarize_api_message(response),
            &gmail_access.account_email,
        )),
    })
}

#[tauri::command]
pub async fn gmail_batch_modify_messages(
    app: tauri::AppHandle,
    state: tauri::State<'_, GmailState>,
    request: GmailBatchModifyMessagesRequest,
) -> Result<GmailBatchActionResponse, String> {
    let ids = normalize_message_ids(&request.ids, MAX_BATCH_MODIFY_MESSAGE_IDS)?;
    let add_label_ids = normalize_label_ids(request.add_label_ids.as_deref());
    let remove_label_ids = normalize_label_ids(request.remove_label_ids.as_deref());

    if add_label_ids.is_empty() && remove_label_ids.is_empty() {
        return Err("Add or remove at least one Gmail label id.".to_string());
    }

    let gmail_access = load_usable_access_token(
        &app,
        &state,
        request.client_id.as_deref(),
        request.account_email.as_deref(),
    )
    .await?;
    let client = google_client()?;
    let url = gmail_api_url("messages/batchModify")?;
    let modified_count = ids.len();

    google_api_empty(
        &client,
        &gmail_access.access_token,
        Method::POST,
        url.as_str(),
        Some(json!({
            "ids": ids,
            "addLabelIds": add_label_ids,
            "removeLabelIds": remove_label_ids,
        })),
    )
    .await?;

    Ok(GmailBatchActionResponse {
        account_email: Some(gmail_access.account_email),
        message: format!("Updated Gmail labels for {modified_count} messages."),
        modified_count,
    })
}

#[tauri::command]
pub async fn gmail_trash_message(
    app: tauri::AppHandle,
    state: tauri::State<'_, GmailState>,
    request: GmailMessageIdRequest,
) -> Result<GmailActionResponse, String> {
    gmail_message_trash_action(app, state, request, true).await
}

#[tauri::command]
pub async fn gmail_untrash_message(
    app: tauri::AppHandle,
    state: tauri::State<'_, GmailState>,
    request: GmailMessageIdRequest,
) -> Result<GmailActionResponse, String> {
    gmail_message_trash_action(app, state, request, false).await
}

#[tauri::command]
pub async fn gmail_api(
    app: tauri::AppHandle,
    state: tauri::State<'_, GmailState>,
    request: GmailApiRequest,
) -> Result<GmailApiResponse, String> {
    let method = sanitize_gmail_api_method(&request.method)?;
    let path = normalize_gmail_api_path(&request.path)?;
    let gmail_access = load_usable_access_token(
        &app,
        &state,
        request.client_id.as_deref(),
        request.account_email.as_deref(),
    )
    .await?;
    let client = google_client()?;
    let mut url = gmail_root_api_url(&path)?;

    append_google_api_query(&mut url, request.query.as_ref());

    let data = google_api_value(
        &client,
        &gmail_access.access_token,
        method.clone(),
        url.as_str(),
        request.body,
    )
    .await?;

    Ok(GmailApiResponse {
        account_email: Some(gmail_access.account_email),
        data,
        message: "Gmail API request completed.".to_string(),
        method: method.as_str().to_string(),
        path,
    })
}

async fn gmail_message_trash_action(
    app: tauri::AppHandle,
    state: tauri::State<'_, GmailState>,
    request: GmailMessageIdRequest,
    trash: bool,
) -> Result<GmailActionResponse, String> {
    let id = normalize_google_id(&request.id, "Gmail message id")?;
    let gmail_access = load_usable_access_token(
        &app,
        &state,
        request.client_id.as_deref(),
        request.account_email.as_deref(),
    )
    .await?;
    let client = google_client()?;
    let action = if trash { "trash" } else { "untrash" };
    let url = gmail_api_url(&format!("messages/{id}/{action}"))?;
    let response = google_api::<GmailApiMessage>(
        &client,
        &gmail_access.access_token,
        Method::POST,
        url.as_str(),
    )
    .await?;

    Ok(GmailActionResponse {
        account_email: Some(gmail_access.account_email.clone()),
        message: if trash {
            format!("Moved Gmail message {id} to Trash.")
        } else {
            format!("Restored Gmail message {id} from Trash.")
        },
        message_detail: Some(with_summary_account(
            summarize_api_message(response),
            &gmail_access.account_email,
        )),
    })
}

async fn load_usable_access_token(
    app: &tauri::AppHandle,
    state: &tauri::State<'_, GmailState>,
    requested_client_id: Option<&str>,
    requested_account_email: Option<&str>,
) -> Result<GmailAccess, String> {
    let requested_client_id = match requested_client_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(client_id) => Some(normalize_oauth_client_id(client_id)?),
        None => None,
    };
    let requested_account_email = requested_account_email
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|email| normalize_account_email(email, "Gmail account email"))
        .transpose()?;
    let account = {
        let _guard = state
            .lock
            .lock()
            .map_err(|_| "The Gmail account store is busy. Try again in a moment.".to_string())?;
        let database = load_database(app)?;

        select_account_record(&database, requested_account_email.as_deref())?
    };
    let now = now_millis();

    if let Some(access_token) = account
        .access_token
        .as_deref()
        .map(str::trim)
        .filter(|token| !token.is_empty())
        .map(ToString::to_string)
    {
        if account
            .expires_at
            .map(|expiry| expiry > now.saturating_add(ACCESS_TOKEN_REFRESH_GRACE_MILLIS))
            .unwrap_or(true)
        {
            return Ok(GmailAccess {
                access_token,
                account_email: account.user.email.clone(),
                user: account.user,
            });
        }
    }

    let refresh_token = account
        .refresh_token
        .as_deref()
        .map(str::trim)
        .filter(|token| !token.is_empty())
        .ok_or_else(|| {
            "Gmail is not connected. Open Apps, install Gmail, and choose a Google account."
                .to_string()
        })?
        .to_string();
    let client_id = requested_client_id
        .or(account.oauth_client_id.clone())
        .ok_or_else(|| {
            "Gmail needs to reconnect once so it can refresh Google access safely.".to_string()
        })?;
    let client_secret = resolve_oauth_client_secret(app, Some(&client_id), None)?;
    let client = google_client()?;
    let token_response =
        refresh_oauth_token(&client, &client_id, &client_secret, &refresh_token).await?;
    let refreshed_access_token = token_response
        .access_token
        .as_deref()
        .map(str::trim)
        .filter(|token| !token.is_empty())
        .ok_or_else(|| "Google did not return a refreshed Gmail access token.".to_string())?
        .to_string();
    let refreshed_expires_at = token_response
        .expires_in
        .map(|seconds| now_millis().saturating_add(seconds.saturating_mul(1000)));

    {
        let _guard = state
            .lock
            .lock()
            .map_err(|_| "The Gmail account store is busy. Try again in a moment.".to_string())?;
        let mut database = load_database(app)?;

        let stored_account = database
            .accounts
            .iter_mut()
            .find(|stored| stored.user.email.eq_ignore_ascii_case(&account.user.email))
            .ok_or_else(|| {
                format!(
                    "The Gmail account {} is no longer connected.",
                    account.user.email
                )
            })?;

        stored_account.access_token = Some(refreshed_access_token.clone());
        stored_account.expires_at = refreshed_expires_at;
        stored_account.oauth_client_id = Some(client_id);
        database.last_connection_error = None;
        if let Some(scope) = token_response.scope.as_deref() {
            let scopes = split_scope(scope);
            if !scopes.is_empty() {
                stored_account.scopes = scopes;
            }
        }
        normalize_database_accounts(&mut database);
        save_database(app, &database)?;
    }

    Ok(GmailAccess {
        access_token: refreshed_access_token,
        account_email: account.user.email.clone(),
        user: account.user,
    })
}

async fn refresh_oauth_token(
    client: &reqwest::Client,
    client_id: &str,
    client_secret: &str,
    refresh_token: &str,
) -> Result<GoogleOAuthTokenResponse, String> {
    let body = encode_form_body(&[
        ("client_id", client_id),
        ("client_secret", client_secret),
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh_token),
    ]);
    let response = client
        .post(GOOGLE_OAUTH_TOKEN_URL)
        .header("Accept", "application/json")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(body)
        .send()
        .await
        .map_err(|error| format!("Could not refresh the Google Gmail token: {error}"))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| format!("Could not read the Google Gmail refresh response: {error}"))?;
    let token_response = serde_json::from_str::<GoogleOAuthTokenResponse>(&text)
        .map_err(|error| format!("Could not parse the Google Gmail refresh response: {error}"))?;

    if !status.is_success() || token_response.error.is_some() {
        return Err(format_google_error(
            "Google Gmail token refresh failed",
            status.as_u16(),
            token_response.error.as_deref(),
            token_response.error_description.as_deref(),
            &text,
        ));
    }

    Ok(token_response)
}

async fn fetch_gmail_message(
    client: &reqwest::Client,
    access_token: &str,
    id: &str,
    include_body: bool,
) -> Result<GmailApiMessage, String> {
    let mut url = gmail_api_url(&format!("messages/{id}"))?;

    url.query_pairs_mut()
        .append_pair("format", if include_body { "full" } else { "metadata" });

    google_api::<GmailApiMessage>(client, access_token, Method::GET, url.as_str()).await
}

fn summarize_api_message(message: GmailApiMessage) -> GmailMessageSummary {
    let headers = message
        .payload
        .as_ref()
        .and_then(|payload| payload.headers.as_deref());

    GmailMessageSummary {
        account_email: None,
        id: message.id.unwrap_or_default(),
        thread_id: message.thread_id,
        subject: header_value(headers, "Subject"),
        from: header_value(headers, "From"),
        to: header_value(headers, "To"),
        date: header_value(headers, "Date"),
        snippet: message.snippet,
        label_ids: message.label_ids.unwrap_or_default(),
        internal_date: message.internal_date,
    }
}

fn detail_api_message(message: GmailApiMessage, max_body_chars: usize) -> GmailMessageDetail {
    let headers = message
        .payload
        .as_ref()
        .and_then(|payload| payload.headers.as_deref());
    let (body, body_truncated) = message
        .payload
        .as_ref()
        .map(|payload| extract_body_text(payload, max_body_chars))
        .unwrap_or((None, false));
    let mut attachments = Vec::new();
    let mut links = Vec::new();

    if let Some(payload) = message.payload.as_ref() {
        collect_attachments(payload, &mut attachments);
        collect_payload_links(payload, &mut links);
    }

    if let Some(body) = body.as_deref() {
        collect_links_from_text(body, &mut links);
    }

    GmailMessageDetail {
        account_email: None,
        id: message.id.unwrap_or_default(),
        thread_id: message.thread_id,
        subject: header_value(headers, "Subject"),
        from: header_value(headers, "From"),
        to: header_value(headers, "To"),
        cc: header_value(headers, "Cc"),
        bcc: header_value(headers, "Bcc"),
        date: header_value(headers, "Date"),
        message_id: header_value(headers, "Message-ID"),
        in_reply_to: header_value(headers, "In-Reply-To"),
        references: header_value(headers, "References"),
        snippet: message.snippet,
        label_ids: message.label_ids.unwrap_or_default(),
        internal_date: message.internal_date,
        body,
        body_truncated,
        attachments,
        links,
    }
}

fn with_summary_account(
    mut summary: GmailMessageSummary,
    account_email: &str,
) -> GmailMessageSummary {
    summary.account_email = Some(account_email.to_string());
    summary
}

fn with_detail_account(mut detail: GmailMessageDetail, account_email: &str) -> GmailMessageDetail {
    detail.account_email = Some(account_email.to_string());
    detail
}

fn extract_body_text(payload: &GmailApiPayload, max_body_chars: usize) -> (Option<String>, bool) {
    let mut plain_parts = Vec::new();
    let mut html_parts = Vec::new();

    collect_text_parts(payload, &mut plain_parts, &mut html_parts);

    let raw_body = if !plain_parts.is_empty() {
        plain_parts.join("\n\n")
    } else {
        html_parts
            .into_iter()
            .map(|part| decode_html_entities(&strip_html_tags(&part)))
            .filter(|part| !part.trim().is_empty())
            .collect::<Vec<_>>()
            .join("\n\n")
    };
    let normalized = normalize_body_text(&raw_body);

    if normalized.is_empty() {
        return (None, false);
    }

    truncate_text(normalized, max_body_chars)
}

fn collect_text_parts(
    payload: &GmailApiPayload,
    plain_parts: &mut Vec<String>,
    html_parts: &mut Vec<String>,
) {
    let mime_type = payload
        .mime_type
        .as_deref()
        .unwrap_or_default()
        .to_ascii_lowercase();

    if let Some(data) = payload.body.as_ref().and_then(|body| body.data.as_deref()) {
        if mime_type.starts_with("text/plain") {
            if let Some(text) = decode_gmail_body_data(data) {
                plain_parts.push(text);
            }
        } else if mime_type.starts_with("text/html") {
            if let Some(text) = decode_gmail_body_data(data) {
                html_parts.push(text);
            }
        }
    }

    if let Some(parts) = payload.parts.as_ref() {
        for part in parts {
            collect_text_parts(part, plain_parts, html_parts);
        }
    }
}

fn collect_attachments(payload: &GmailApiPayload, attachments: &mut Vec<GmailAttachmentSummary>) {
    let filename = payload.filename.as_deref().unwrap_or_default().trim();
    let body = payload.body.as_ref();
    let attachment_id = body.and_then(|body| body.attachment_id.clone());
    let mime_type = payload.mime_type.clone();
    let is_image = mime_type
        .as_deref()
        .map(|value| value.to_ascii_lowercase().starts_with("image/"))
        .unwrap_or(false);

    if !filename.is_empty() || attachment_id.is_some() {
        attachments.push(GmailAttachmentSummary {
            attachment_id,
            content_id: payload
                .headers
                .as_deref()
                .and_then(|headers| header_value(Some(headers), "Content-ID")),
            filename: filename.to_string(),
            is_image,
            mime_type,
            size: body.and_then(|body| body.size),
        });
    }

    if let Some(parts) = payload.parts.as_ref() {
        for part in parts {
            collect_attachments(part, attachments);
        }
    }
}

fn collect_payload_links(payload: &GmailApiPayload, links: &mut Vec<String>) {
    if let Some(data) = payload.body.as_ref().and_then(|body| body.data.as_deref()) {
        if let Some(text) = decode_gmail_body_data(data) {
            collect_links_from_text(&text, links);
        }
    }

    if let Some(parts) = payload.parts.as_ref() {
        for part in parts {
            collect_payload_links(part, links);
        }
    }
}

fn decode_gmail_body_data(data: &str) -> Option<String> {
    let bytes = general_purpose::URL_SAFE_NO_PAD
        .decode(data.as_bytes())
        .or_else(|_| general_purpose::URL_SAFE.decode(data.as_bytes()))
        .ok()?;

    Some(String::from_utf8_lossy(&bytes).to_string())
}

fn collect_links_from_text(text: &str, links: &mut Vec<String>) {
    for prefix in ["https://", "http://"] {
        let mut search_start = 0;

        while let Some(relative_index) = text[search_start..].find(prefix) {
            let start = search_start + relative_index;
            let rest = &text[start..];
            let end = rest
                .char_indices()
                .find_map(|(index, character)| {
                    if character.is_whitespace()
                        || matches!(character, '"' | '\'' | '<' | '>' | ')' | ']' | '}')
                    {
                        Some(index)
                    } else {
                        None
                    }
                })
                .unwrap_or(rest.len());
            let candidate = clean_link_candidate(&rest[..end]);

            if candidate.len() <= 2048
                && !links
                    .iter()
                    .any(|existing| existing.eq_ignore_ascii_case(&candidate))
            {
                links.push(candidate);
            }

            search_start = start.saturating_add(end.max(prefix.len()));
            if search_start >= text.len() {
                break;
            }
        }
    }
}

fn clean_link_candidate(value: &str) -> String {
    value
        .trim()
        .trim_matches(|character| {
            matches!(
                character,
                '"' | '\'' | ',' | '.' | ';' | ':' | ')' | ']' | '}'
            )
        })
        .to_string()
}

fn strip_html_tags(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut in_tag = false;

    for character in value.chars() {
        match character {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                output.push(' ');
            }
            _ if !in_tag => output.push(character),
            _ => {}
        }
    }

    output
}

fn decode_html_entities(value: &str) -> String {
    value
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
}

fn normalize_body_text(value: &str) -> String {
    value
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .lines()
        .map(str::trim_end)
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

fn truncate_text(value: String, max_chars: usize) -> (Option<String>, bool) {
    let max_chars = max_chars.clamp(1, MAX_MESSAGE_BODY_CHARS);

    if value.chars().count() <= max_chars {
        return (Some(value), false);
    }

    let truncated = value.chars().take(max_chars).collect::<String>();

    (Some(truncated), true)
}

fn header_value(headers: Option<&[GmailApiHeader]>, name: &str) -> Option<String> {
    headers.and_then(|headers| {
        headers
            .iter()
            .find(|header| header.name.eq_ignore_ascii_case(name))
            .map(|header| header.value.trim().to_string())
            .filter(|value| !value.is_empty())
    })
}

fn label_from_api(label: GmailApiLabel) -> Option<GmailLabel> {
    let id = label.id?.trim().to_string();
    let name = label.name?.trim().to_string();

    if id.is_empty() || name.is_empty() {
        return None;
    }

    Some(GmailLabel {
        id,
        name,
        label_type: label.label_type,
        message_list_visibility: label.message_list_visibility,
        label_list_visibility: label.label_list_visibility,
        messages_total: label.messages_total,
        messages_unread: label.messages_unread,
        threads_total: label.threads_total,
        threads_unread: label.threads_unread,
    })
}

struct Rfc2822MessageInput<'a> {
    bcc: Option<&'a [String]>,
    body: &'a str,
    cc: Option<&'a [String]>,
    content_type: Option<&'a str>,
    from: Option<&'a str>,
    in_reply_to: Option<&'a str>,
    references: Option<&'a str>,
    subject: &'a str,
    to: &'a [String],
}

enum OutgoingEmailBodyFormat {
    Html,
    Markdown,
    Plain,
}

fn create_rfc2822_message(
    request: &GmailCreateDraftRequest,
    authenticated_email: Option<&str>,
) -> Result<String, String> {
    create_rfc2822_message_from_input(
        Rfc2822MessageInput {
            bcc: request.bcc.as_deref(),
            body: &request.body,
            cc: request.cc.as_deref(),
            content_type: request.content_type.as_deref(),
            from: request.from.as_deref(),
            in_reply_to: request.in_reply_to.as_deref(),
            references: request.references.as_deref(),
            subject: &request.subject,
            to: &request.to,
        },
        authenticated_email,
        "Gmail draft",
    )
}

fn create_rfc2822_send_message(
    request: &GmailSendMessageRequest,
    authenticated_email: Option<&str>,
) -> Result<String, String> {
    create_rfc2822_message_from_input(
        Rfc2822MessageInput {
            bcc: request.bcc.as_deref(),
            body: &request.body,
            cc: request.cc.as_deref(),
            content_type: request.content_type.as_deref(),
            from: request.from.as_deref(),
            in_reply_to: request.in_reply_to.as_deref(),
            references: request.references.as_deref(),
            subject: &request.subject,
            to: &request.to,
        },
        authenticated_email,
        "Gmail message",
    )
}

fn create_rfc2822_separate_message(
    request: &GmailSendSeparateMessagesRequest,
    recipient: &str,
    authenticated_email: Option<&str>,
) -> Result<String, String> {
    let to = vec![recipient.to_string()];

    create_rfc2822_message_from_input(
        Rfc2822MessageInput {
            bcc: None,
            body: &request.body,
            cc: None,
            content_type: request.content_type.as_deref(),
            from: request.from.as_deref(),
            in_reply_to: None,
            references: None,
            subject: &request.subject,
            to: &to,
        },
        authenticated_email,
        "Gmail separate message",
    )
}

fn create_rfc2822_message_from_input(
    input: Rfc2822MessageInput<'_>,
    authenticated_email: Option<&str>,
    label: &str,
) -> Result<String, String> {
    let to = normalize_email_list(input.to, "to")?;
    let cc = normalize_optional_email_list(input.cc, "cc")?;
    let bcc = normalize_optional_email_list(input.bcc, "bcc")?;
    let subject = sanitize_header_value(input.subject, "subject")?;
    let from = input
        .from
        .or(authenticated_email)
        .map(|value| sanitize_header_value(value, "from"))
        .transpose()?;
    let (content_type, body) = render_outgoing_email_body(
        input.body,
        normalize_outgoing_content_type(input.content_type, label)?,
    );
    let body = normalize_rfc2822_body_line_endings(&body);
    let mut headers = Vec::new();

    if let Some(from) = from.filter(|value| !value.is_empty()) {
        headers.push(format!("From: {from}"));
    }
    headers.push(format!("To: {}", to.join(", ")));
    if !cc.is_empty() {
        headers.push(format!("Cc: {}", cc.join(", ")));
    }
    if !bcc.is_empty() {
        headers.push(format!("Bcc: {}", bcc.join(", ")));
    }
    headers.push(format!("Subject: {subject}"));
    if let Some(in_reply_to) = sanitize_optional_header_value(input.in_reply_to, "inReplyTo")? {
        headers.push(format!("In-Reply-To: {in_reply_to}"));
    }
    if let Some(references) = sanitize_optional_header_value(input.references, "references")? {
        headers.push(format!("References: {references}"));
    }
    headers.push("MIME-Version: 1.0".to_string());
    headers.push(format!("Content-Type: {content_type}; charset=\"UTF-8\""));
    headers.push("Content-Transfer-Encoding: 8bit".to_string());

    Ok(format!("{}\r\n\r\n{body}", headers.join("\r\n")))
}

fn normalize_outgoing_content_type(
    value: Option<&str>,
    label: &str,
) -> Result<OutgoingEmailBodyFormat, String> {
    match value.map(str::trim).filter(|value| !value.is_empty()) {
        Some(value) if value.eq_ignore_ascii_case("text/html") => Ok(OutgoingEmailBodyFormat::Html),
        Some(value)
            if value.eq_ignore_ascii_case("text/markdown")
                || value.eq_ignore_ascii_case("markdown") =>
        {
            Ok(OutgoingEmailBodyFormat::Markdown)
        }
        Some(value) if value.eq_ignore_ascii_case("text/plain") => {
            Ok(OutgoingEmailBodyFormat::Plain)
        }
        Some(_) => Err(format!(
            "{label} contentType must be text/markdown, text/plain, or text/html."
        )),
        None => Ok(OutgoingEmailBodyFormat::Markdown),
    }
}

fn render_outgoing_email_body(
    body: &str,
    format: OutgoingEmailBodyFormat,
) -> (&'static str, String) {
    match format {
        OutgoingEmailBodyFormat::Html => ("text/html", body.to_string()),
        OutgoingEmailBodyFormat::Markdown => ("text/html", render_markdown_email_body(body)),
        OutgoingEmailBodyFormat::Plain => ("text/plain", body.to_string()),
    }
}

fn normalize_rfc2822_body_line_endings(value: &str) -> String {
    value
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .replace('\n', "\r\n")
}

fn render_markdown_email_body(value: &str) -> String {
    let normalized = value.replace("\r\n", "\n").replace('\r', "\n");
    let mut html = String::from("<div>");
    let mut paragraph_lines: Vec<String> = Vec::new();
    let mut list_kind: Option<&'static str> = None;

    for line in normalized.lines() {
        let trimmed = line.trim();

        if trimmed.is_empty() {
            flush_markdown_paragraph(&mut html, &mut paragraph_lines);
            close_markdown_list(&mut html, &mut list_kind);
            continue;
        }

        if let Some((level, content)) = markdown_heading(trimmed) {
            flush_markdown_paragraph(&mut html, &mut paragraph_lines);
            close_markdown_list(&mut html, &mut list_kind);
            html.push_str(&format!(
                "<h{level}>{}</h{level}>",
                render_inline_markdown(content)
            ));
            continue;
        }

        if let Some(content) = markdown_unordered_list_item(trimmed) {
            flush_markdown_paragraph(&mut html, &mut paragraph_lines);
            open_markdown_list(&mut html, &mut list_kind, "ul");
            html.push_str(&format!("<li>{}</li>", render_inline_markdown(content)));
            continue;
        }

        if let Some(content) = markdown_ordered_list_item(trimmed) {
            flush_markdown_paragraph(&mut html, &mut paragraph_lines);
            open_markdown_list(&mut html, &mut list_kind, "ol");
            html.push_str(&format!("<li>{}</li>", render_inline_markdown(content)));
            continue;
        }

        if let Some(content) = trimmed.strip_prefix("> ") {
            flush_markdown_paragraph(&mut html, &mut paragraph_lines);
            close_markdown_list(&mut html, &mut list_kind);
            html.push_str(&format!(
                "<blockquote>{}</blockquote>",
                render_inline_markdown(content)
            ));
            continue;
        }

        close_markdown_list(&mut html, &mut list_kind);
        paragraph_lines.push(trimmed.to_string());
    }

    flush_markdown_paragraph(&mut html, &mut paragraph_lines);
    close_markdown_list(&mut html, &mut list_kind);
    html.push_str("</div>");
    html
}

fn flush_markdown_paragraph(html: &mut String, paragraph_lines: &mut Vec<String>) {
    if paragraph_lines.is_empty() {
        return;
    }

    let paragraph = paragraph_lines
        .iter()
        .map(|line| render_inline_markdown(line))
        .collect::<Vec<_>>()
        .join("<br>");
    html.push_str(&format!("<p>{paragraph}</p>"));
    paragraph_lines.clear();
}

fn open_markdown_list(
    html: &mut String,
    list_kind: &mut Option<&'static str>,
    target_kind: &'static str,
) {
    if list_kind.as_deref() == Some(target_kind) {
        return;
    }

    close_markdown_list(html, list_kind);
    html.push_str(if target_kind == "ol" { "<ol>" } else { "<ul>" });
    *list_kind = Some(target_kind);
}

fn close_markdown_list(html: &mut String, list_kind: &mut Option<&'static str>) {
    match list_kind.take() {
        Some("ol") => html.push_str("</ol>"),
        Some("ul") => html.push_str("</ul>"),
        _ => {}
    }
}

fn markdown_heading(value: &str) -> Option<(usize, &str)> {
    let marker_count = value
        .chars()
        .take_while(|character| *character == '#')
        .count();

    if !(1..=6).contains(&marker_count) {
        return None;
    }

    let content = value.get(marker_count..)?.strip_prefix(' ')?;
    Some((marker_count, content.trim()))
}

fn markdown_unordered_list_item(value: &str) -> Option<&str> {
    value
        .strip_prefix("- ")
        .or_else(|| value.strip_prefix("* "))
        .map(str::trim)
}

fn markdown_ordered_list_item(value: &str) -> Option<&str> {
    let (number, content) = value.split_once(". ")?;

    if number.chars().all(|character| character.is_ascii_digit()) {
        Some(content.trim())
    } else {
        None
    }
}

fn render_inline_markdown(value: &str) -> String {
    let mut rendered = escape_html(value);

    rendered = Regex::new(r"\[([^\]]+)\]\(([^)\s]+)\)")
        .expect("valid markdown link regex")
        .replace_all(&rendered, |captures: &regex::Captures<'_>| {
            let text = captures
                .get(1)
                .map(|match_| match_.as_str())
                .unwrap_or_default();
            let href = captures
                .get(2)
                .map(|match_| match_.as_str())
                .unwrap_or_default();

            if is_safe_email_href(href) {
                format!("<a href=\"{href}\">{text}</a>")
            } else {
                text.to_string()
            }
        })
        .to_string();
    rendered = Regex::new(r"`([^`]+)`")
        .expect("valid inline code regex")
        .replace_all(&rendered, "<code>$1</code>")
        .to_string();
    rendered = Regex::new(r"\*\*([^*]+)\*\*")
        .expect("valid strong emphasis regex")
        .replace_all(&rendered, "<strong>$1</strong>")
        .to_string();
    rendered = Regex::new(r"__([^_]+)__")
        .expect("valid underscore strong emphasis regex")
        .replace_all(&rendered, "<strong>$1</strong>")
        .to_string();
    rendered = Regex::new(r"\*([^*]+)\*")
        .expect("valid emphasis regex")
        .replace_all(&rendered, "<em>$1</em>")
        .to_string();
    rendered = Regex::new(r"_([^_]+)_")
        .expect("valid underscore emphasis regex")
        .replace_all(&rendered, "<em>$1</em>")
        .to_string();

    rendered
}

fn is_safe_email_href(value: &str) -> bool {
    let value = value.trim().to_ascii_lowercase();
    value.starts_with("https://") || value.starts_with("http://") || value.starts_with("mailto:")
}

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn normalize_email_list(values: &[String], field: &str) -> Result<Vec<String>, String> {
    let emails: Vec<String> = values
        .iter()
        .map(|value| sanitize_header_value(value, field))
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect();

    if emails.is_empty() {
        return Err(format!("Gmail draft {field} recipients are required."));
    }

    Ok(emails)
}

fn normalize_optional_email_list(
    values: Option<&[String]>,
    field: &str,
) -> Result<Vec<String>, String> {
    match values {
        Some(values) => Ok(values
            .iter()
            .map(|value| sanitize_header_value(value, field))
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .collect()),
        None => Ok(Vec::new()),
    }
}

fn sanitize_header_value(value: &str, field: &str) -> Result<String, String> {
    if value.contains('\n') || value.contains('\r') {
        return Err(format!("Gmail draft {field} cannot contain line breaks."));
    }

    Ok(value.trim().to_string())
}

fn sanitize_optional_header_value(
    value: Option<&str>,
    field: &str,
) -> Result<Option<String>, String> {
    normalize_optional_gmail_metadata(value)
        .map(|value| sanitize_header_value(&value, field))
        .transpose()
}

fn normalize_optional_gmail_thread_id(value: Option<&str>) -> Option<String> {
    let value = normalize_optional_gmail_metadata(value)?;

    if is_plausible_gmail_thread_id(&value) {
        Some(value)
    } else {
        None
    }
}

fn normalize_optional_gmail_metadata(value: Option<&str>) -> Option<String> {
    let value = value?.trim();

    if value.is_empty() || is_optional_gmail_placeholder(value) {
        None
    } else {
        Some(value.to_string())
    }
}

fn is_optional_gmail_placeholder(value: &str) -> bool {
    let normalized = value.trim().to_ascii_lowercase();

    matches!(
        normalized.as_str(),
        "n/a" | "na" | "none" | "null" | "undefined" | "(none)" | "[none]"
    ) || normalized
        .chars()
        .all(|character| matches!(character, '-' | '\u{2014}'))
}

fn is_plausible_gmail_thread_id(value: &str) -> bool {
    let value = value.trim();

    value.len() >= 8 && value.chars().all(|character| character.is_ascii_hexdigit())
}

fn normalize_google_id(value: &str, label: &str) -> Result<String, String> {
    let value = normalize_non_empty_string(value, label)?;

    if !value
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.'))
    {
        return Err(format!("{label} contains unsupported characters."));
    }

    Ok(value)
}

fn normalize_non_empty_string(value: &str, label: &str) -> Result<String, String> {
    let value = value.trim();

    if value.is_empty() {
        return Err(format!("{label} is required."));
    }

    Ok(value.to_string())
}

fn normalize_account_email(value: &str, label: &str) -> Result<String, String> {
    let value = normalize_non_empty_string(value, label)?.to_ascii_lowercase();
    let Some((local_part, domain)) = value.split_once('@') else {
        return Err(format!("{label} must be a valid email address."));
    };

    if local_part.is_empty()
        || domain.is_empty()
        || !domain.contains('.')
        || value.contains(char::is_whitespace)
    {
        return Err(format!("{label} must be a valid email address."));
    }

    Ok(value)
}

fn normalize_label_ids(values: Option<&[String]>) -> Vec<String> {
    values
        .unwrap_or_default()
        .iter()
        .map(String::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .collect()
}

fn normalize_message_ids(values: &[String], max_ids: usize) -> Result<Vec<String>, String> {
    let mut ids = Vec::new();

    for value in values {
        let id = normalize_google_id(value, "Gmail message id")?;

        if !ids.iter().any(|existing: &String| existing == &id) {
            ids.push(id);
        }
    }

    if ids.is_empty() {
        return Err("At least one Gmail message id is required.".to_string());
    }

    if ids.len() > max_ids {
        return Err(format!(
            "This Gmail action supports up to {max_ids} message ids."
        ));
    }

    Ok(ids)
}

fn normalize_body_char_limit(value: Option<u32>) -> usize {
    value
        .map(|value| value as usize)
        .unwrap_or(DEFAULT_MESSAGE_BODY_CHARS)
        .clamp(1, MAX_MESSAGE_BODY_CHARS)
}

fn gmail_api_url(path: &str) -> Result<reqwest::Url, String> {
    reqwest::Url::parse(&format!(
        "{}/{}",
        GMAIL_API_BASE_URL,
        path.trim_start_matches('/')
    ))
    .map_err(|error| format!("Could not build the Gmail API URL: {error}"))
}

fn gmail_root_api_url(path: &str) -> Result<reqwest::Url, String> {
    let path = path.trim_start_matches('/');
    let path = if path.starts_with("users/") {
        path.to_string()
    } else {
        format!("users/me/{path}")
    };

    reqwest::Url::parse(&format!("{}/{}", GMAIL_API_ROOT_URL, path))
        .map_err(|error| format!("Could not build the Gmail API URL: {error}"))
}

fn sanitize_gmail_api_method(value: &str) -> Result<Method, String> {
    match value.trim().to_ascii_uppercase().as_str() {
        "DELETE" => Ok(Method::DELETE),
        "GET" => Ok(Method::GET),
        "PATCH" => Ok(Method::PATCH),
        "POST" => Ok(Method::POST),
        "PUT" => Ok(Method::PUT),
        _ => Err("Gmail API method must be GET, POST, PATCH, PUT, or DELETE.".to_string()),
    }
}

fn normalize_gmail_api_path(value: &str) -> Result<String, String> {
    let value = normalize_non_empty_string(value, "Gmail API path")?;

    if value.contains("://")
        || value.starts_with("//")
        || value.contains('\\')
        || value.chars().any(|character| character.is_control())
        || value.split('/').any(|segment| segment == "..")
    {
        return Err("Gmail API path must be a relative API path.".to_string());
    }

    Ok(value.trim_start_matches('/').to_string())
}

fn append_google_api_query(url: &mut reqwest::Url, query: Option<&Map<String, Value>>) {
    let Some(query) = query else {
        return;
    };
    let mut encoded_pairs = Vec::new();

    for (key, value) in query {
        collect_google_api_query_value(&mut encoded_pairs, key, value);
    }

    let mut pairs = url.query_pairs_mut();

    for (key, value) in encoded_pairs {
        pairs.append_pair(&key, &value);
    }
}

fn collect_google_api_query_value(pairs: &mut Vec<(String, String)>, key: &str, value: &Value) {
    match value {
        Value::Array(values) => {
            for value in values {
                collect_google_api_query_value(pairs, key, value);
            }
        }
        Value::Bool(value) => {
            pairs.push((
                key.to_string(),
                (if *value { "true" } else { "false" }).to_string(),
            ));
        }
        Value::Number(value) => {
            pairs.push((key.to_string(), value.to_string()));
        }
        Value::String(value) => {
            if !value.trim().is_empty() {
                pairs.push((key.to_string(), value.to_string()));
            }
        }
        Value::Null | Value::Object(_) => {}
    }
}

struct OAuthSession {
    authorization_url: String,
    code_verifier: String,
    listener: TcpListener,
    redirect_uri: String,
    state: String,
}

fn create_oauth_session(client_id: &str, scope: &str) -> Result<OAuthSession, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|error| {
        format!("Could not start the local Gmail sign-in callback listener: {error}")
    })?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("Could not read the local Gmail callback address: {error}"))?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{port}{OAUTH_CALLBACK_PATH}");
    let state = Uuid::new_v4().to_string();
    let code_verifier = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    let mut hasher = Sha256::new();

    hasher.update(code_verifier.as_bytes());
    let code_challenge = general_purpose::URL_SAFE_NO_PAD.encode(hasher.finalize());
    let mut auth_url = reqwest::Url::parse(GOOGLE_OAUTH_AUTHORIZE_URL)
        .map_err(|error| format!("Could not build the Google sign-in URL: {error}"))?;

    auth_url
        .query_pairs_mut()
        .append_pair("client_id", client_id)
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("scope", scope)
        .append_pair("state", &state)
        .append_pair("code_challenge", &code_challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("access_type", "offline")
        .append_pair("prompt", "consent");

    Ok(OAuthSession {
        authorization_url: auth_url.to_string(),
        code_verifier,
        listener,
        redirect_uri,
        state,
    })
}

fn wait_for_oauth_callback(
    listener: TcpListener,
    expected_state: String,
) -> Result<OAuthCallback, String> {
    listener
        .set_nonblocking(true)
        .map_err(|error| format!("Could not prepare the Gmail callback listener: {error}"))?;
    listener
        .set_ttl(64)
        .map_err(|error| format!("Could not configure the Gmail callback listener: {error}"))?;
    let deadline = Instant::now() + Duration::from_secs(OAUTH_CALLBACK_TIMEOUT_SECS);
    let (mut stream, _) = loop {
        match listener.accept() {
            Ok(connection) => break connection,
            Err(error) if error.kind() == ErrorKind::WouldBlock => {
                if Instant::now() >= deadline {
                    return Err(
                        "Gmail sign-in timed out. Click Connect Gmail and try again.".to_string(),
                    );
                }

                thread::sleep(Duration::from_millis(200));
            }
            Err(error) => {
                return Err(format!(
                    "Gmail sign-in did not return to the app. Try Connect Gmail again. Details: {error}"
                ));
            }
        }
    };

    stream
        .set_read_timeout(Some(Duration::from_secs(OAUTH_CALLBACK_TIMEOUT_SECS)))
        .map_err(|error| format!("Could not set the Gmail callback timeout: {error}"))?;

    let request_line = {
        let mut reader = BufReader::new(&mut stream);
        let mut request_line = String::new();

        reader
            .read_line(&mut request_line)
            .map_err(|error| format!("Could not read the Gmail sign-in callback: {error}"))?;
        request_line
    };
    let callback = parse_oauth_callback_request(&request_line, &expected_state);

    let body = if callback.is_ok() {
        "<!doctype html><meta charset=\"utf-8\"><title>Return to Gilbert Codex</title><body style=\"font-family:system-ui;margin:40px\"><h1>Google returned to Gilbert Codex</h1><p>You can close this tab and return to Gilbert Codex while the app finishes Gmail setup.</p></body>"
    } else {
        "<!doctype html><meta charset=\"utf-8\"><title>Gmail connection failed</title><body style=\"font-family:system-ui;margin:40px\"><h1>Gmail connection failed</h1><p>Return to Gilbert Codex and try Connect Gmail again.</p></body>"
    };
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(response.as_bytes());

    callback
}

fn parse_oauth_callback_request(
    request_line: &str,
    expected_state: &str,
) -> Result<OAuthCallback, String> {
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or_default();
    let target = parts.next().unwrap_or_default();

    if method != "GET" {
        return Err("Google returned an unexpected Gmail sign-in callback.".to_string());
    }

    let callback_url = reqwest::Url::parse(&format!("http://127.0.0.1{target}"))
        .map_err(|error| format!("Could not parse the Gmail sign-in callback: {error}"))?;

    if callback_url.path() != OAUTH_CALLBACK_PATH {
        return Err("Google returned to an unexpected Gmail callback path.".to_string());
    }

    let mut code = None;
    let mut state = None;
    let mut oauth_error = None;
    let mut oauth_error_description = None;

    for (key, value) in callback_url.query_pairs() {
        match key.as_ref() {
            "code" => code = Some(value.into_owned()),
            "state" => state = Some(value.into_owned()),
            "error" => oauth_error = Some(value.into_owned()),
            "error_description" => oauth_error_description = Some(value.into_owned()),
            _ => {}
        }
    }

    if let Some(error) = oauth_error {
        return Err(format!(
            "Google did not authorize Gmail access: {}",
            oauth_error_description.unwrap_or(error)
        ));
    }

    if state.as_deref() != Some(expected_state) {
        return Err("Gmail sign-in returned with an invalid state token.".to_string());
    }

    let code = code
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Google did not return a Gmail authorization code.".to_string())?;

    Ok(OAuthCallback { code })
}

async fn exchange_oauth_code(
    client: &reqwest::Client,
    client_id: &str,
    client_secret: &str,
    code: &str,
    redirect_uri: &str,
    code_verifier: &str,
) -> Result<GoogleOAuthTokenResponse, String> {
    let body = encode_form_body(&[
        ("client_id", client_id),
        ("client_secret", client_secret),
        ("code", code),
        ("code_verifier", code_verifier),
        ("grant_type", "authorization_code"),
        ("redirect_uri", redirect_uri),
    ]);
    let response = client
        .post(GOOGLE_OAUTH_TOKEN_URL)
        .header("Accept", "application/json")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(body)
        .send()
        .await
        .map_err(|error| format!("Could not exchange the Google Gmail sign-in code: {error}"))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| format!("Could not read the Google Gmail token response: {error}"))?;
    let token_response = serde_json::from_str::<GoogleOAuthTokenResponse>(&text)
        .map_err(|error| format!("Could not parse the Google Gmail token response: {error}"))?;

    if !status.is_success() || token_response.error.is_some() {
        return Err(format_google_error(
            "Google Gmail token exchange failed",
            status.as_u16(),
            token_response.error.as_deref(),
            token_response.error_description.as_deref(),
            &text,
        ));
    }

    Ok(token_response)
}

async fn fetch_google_user_info(
    client: &reqwest::Client,
    access_token: &str,
) -> Result<GoogleUserInfoResponse, String> {
    google_api::<GoogleUserInfoResponse>(client, access_token, Method::GET, GOOGLE_USERINFO_URL)
        .await
}

async fn fetch_gmail_profile(
    client: &reqwest::Client,
    access_token: &str,
) -> Result<GmailProfileResponse, String> {
    google_api::<GmailProfileResponse>(client, access_token, Method::GET, GMAIL_PROFILE_URL).await
}

async fn google_api<T: DeserializeOwned>(
    client: &reqwest::Client,
    access_token: &str,
    method: Method,
    url: &str,
) -> Result<T, String> {
    let response = client
        .request(method, url)
        .header("Accept", "application/json")
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|error| format!("Google Gmail request failed: {error}"))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| format!("Could not read the Google Gmail response: {error}"))?;

    if !status.is_success() {
        return Err(format_google_error(
            "Google Gmail request failed",
            status.as_u16(),
            None,
            None,
            &text,
        ));
    }

    serde_json::from_str::<T>(&text)
        .map_err(|error| format!("Could not parse the Google Gmail response: {error}"))
}

async fn google_api_with_json<T: DeserializeOwned>(
    client: &reqwest::Client,
    access_token: &str,
    method: Method,
    url: &str,
    body: Option<Value>,
) -> Result<T, String> {
    let mut request = client
        .request(method, url)
        .header("Accept", "application/json")
        .bearer_auth(access_token);

    if let Some(body) = body {
        request = request.json(&body);
    }

    let response = request
        .send()
        .await
        .map_err(|error| format!("Google Gmail request failed: {error}"))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| format!("Could not read the Google Gmail response: {error}"))?;

    if !status.is_success() {
        return Err(format_google_error(
            "Google Gmail request failed",
            status.as_u16(),
            None,
            None,
            &text,
        ));
    }

    serde_json::from_str::<T>(&text)
        .map_err(|error| format!("Could not parse the Google Gmail response: {error}"))
}

async fn google_api_empty(
    client: &reqwest::Client,
    access_token: &str,
    method: Method,
    url: &str,
    body: Option<Value>,
) -> Result<(), String> {
    let mut request = client
        .request(method, url)
        .header("Accept", "application/json")
        .bearer_auth(access_token);

    if let Some(body) = body {
        request = request.json(&body);
    }

    let response = request
        .send()
        .await
        .map_err(|error| format!("Google Gmail request failed: {error}"))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| format!("Could not read the Google Gmail response: {error}"))?;

    if status.is_success() {
        return Ok(());
    }

    Err(format_google_error(
        "Google Gmail request failed",
        status.as_u16(),
        None,
        None,
        &text,
    ))
}

async fn google_api_value(
    client: &reqwest::Client,
    access_token: &str,
    method: Method,
    url: &str,
    body: Option<Value>,
) -> Result<Value, String> {
    let mut request = client
        .request(method, url)
        .header("Accept", "application/json")
        .bearer_auth(access_token);

    if let Some(body) = body {
        request = request.json(&body);
    }

    let response = request
        .send()
        .await
        .map_err(|error| format!("Google Gmail request failed: {error}"))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| format!("Could not read the Google Gmail response: {error}"))?;

    if status.is_success() {
        let trimmed = text.trim();
        if trimmed.is_empty() {
            return Ok(Value::Null);
        }

        return serde_json::from_str::<Value>(trimmed)
            .map_err(|error| format!("Could not parse the Google Gmail response: {error}"));
    }

    Err(format_google_error(
        "Google Gmail request failed",
        status.as_u16(),
        None,
        None,
        &text,
    ))
}

fn google_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .connect_timeout(Duration::from_secs(GOOGLE_HTTP_CONNECT_TIMEOUT_SECS))
        .timeout(Duration::from_secs(GOOGLE_HTTP_TIMEOUT_SECS))
        .build()
        .map_err(|error| format!("Could not create the Google Gmail client: {error}"))
}

fn load_database(app: &tauri::AppHandle) -> Result<GmailDatabase, String> {
    let namespace = auth::current_user_storage_namespace(app)?;
    clear_shared_database(app)?;

    if let Some(content) = storage::read_value(app, &namespace, GMAIL_DATABASE_STORAGE_KEY)? {
        return parse_database_content(&content, "Gilbert Database Gmail account store");
    }

    Ok(fresh_database())
}

fn save_database(app: &tauri::AppHandle, database: &GmailDatabase) -> Result<(), String> {
    let namespace = auth::current_user_storage_namespace(app)?;
    clear_shared_database(app)?;
    let content = serde_json::to_string_pretty(database)
        .map_err(|error| format!("Could not serialize the Gmail account store: {error}"))?;

    storage::write_value(app, &namespace, GMAIL_DATABASE_STORAGE_KEY, &content).map_err(|error| {
        format!("Could not write the Gmail account store to Gilbert Database: {error}")
    })
}

fn clear_shared_database(app: &tauri::AppHandle) -> Result<(), String> {
    let Some(content) = storage::read_value(app, SYSTEM_NAMESPACE, GMAIL_DATABASE_STORAGE_KEY)?
    else {
        return Ok(());
    };

    if parse_database_content(&content, "shared Gmail account store")
        .map(|database| database.access_token.is_none() && database.user.is_none())
        .unwrap_or(false)
    {
        return Ok(());
    }

    let content = serde_json::to_string_pretty(&fresh_database()).map_err(|error| {
        format!("Could not serialize the cleared shared Gmail account store: {error}")
    })?;

    storage::write_value(app, SYSTEM_NAMESPACE, GMAIL_DATABASE_STORAGE_KEY, &content)
        .map_err(|error| format!("Could not clear the shared Gmail account store: {error}"))
}

fn parse_database_content(content: &str, source: &str) -> Result<GmailDatabase, String> {
    let mut database = serde_json::from_str::<GmailDatabase>(content).map_err(|error| {
        format!("Could not parse the Gmail account store from {source}: {error}")
    })?;

    if database.database_generation != GMAIL_DATABASE_GENERATION {
        return Ok(fresh_database());
    }

    normalize_database_accounts(&mut database);

    Ok(database)
}

fn create_connection_state(database: &GmailDatabase) -> GmailConnectionState {
    let active_account = active_account(database);
    let connected = active_account.is_some();

    GmailConnectionState {
        accounts: database
            .accounts
            .iter()
            .filter(|account| account_connected(account))
            .map(|account| GmailAccountState {
                active: active_account
                    .map(|active| active.user.email.eq_ignore_ascii_case(&account.user.email))
                    .unwrap_or(false),
                connected_at: account.connected_at,
                email: account.user.email.clone(),
                expires_at: account.expires_at,
                scopes: account.scopes.clone(),
                user: account.user.clone(),
            })
            .collect(),
        active_account_email: active_account.map(|account| account.user.email.clone()),
        connected,
        connected_at: active_account.and_then(|account| account.connected_at),
        expires_at: active_account.and_then(|account| account.expires_at),
        last_connection_error: database.last_connection_error.clone(),
        max_accounts: MAX_GMAIL_ACCOUNTS,
        plugin_installed: database.plugin_installed || connected,
        plugin_installed_at: database
            .plugin_installed_at
            .or_else(|| active_account.and_then(|account| account.connected_at)),
        scopes: active_account
            .map(|account| account.scopes.clone())
            .unwrap_or_default(),
        user: active_account.map(|account| account.user.clone()),
    }
}

fn fresh_database() -> GmailDatabase {
    GmailDatabase {
        access_token: None,
        accounts: Vec::new(),
        active_account_email: None,
        connected_at: None,
        database_generation: GMAIL_DATABASE_GENERATION,
        expires_at: None,
        last_connection_error: None,
        oauth_client_id: None,
        plugin_installed: false,
        plugin_installed_at: None,
        refresh_token: None,
        scopes: Vec::new(),
        user: None,
    }
}

fn normalize_database_accounts(database: &mut GmailDatabase) {
    if let Some(legacy_user) = database.user.clone() {
        let email = legacy_user.email.trim();
        if !email.is_empty()
            && database
                .access_token
                .as_deref()
                .map(|token| !token.trim().is_empty())
                .unwrap_or(false)
            && !database
                .accounts
                .iter()
                .any(|account| account.user.email.eq_ignore_ascii_case(email))
        {
            database.accounts.push(GmailAccountRecord {
                access_token: database.access_token.clone(),
                connected_at: database.connected_at,
                expires_at: database.expires_at,
                oauth_client_id: database.oauth_client_id.clone(),
                refresh_token: database.refresh_token.clone(),
                scopes: database.scopes.clone(),
                user: legacy_user,
            });
        }
    }

    database
        .accounts
        .retain(|account| account_connected(account) && !account.user.email.trim().is_empty());

    if database.accounts.len() > MAX_GMAIL_ACCOUNTS {
        database.accounts.truncate(MAX_GMAIL_ACCOUNTS);
    }

    if database.accounts.is_empty() {
        database.active_account_email = None;
        sync_legacy_fields_from_active(database);
        return;
    }

    let active_is_valid = database
        .active_account_email
        .as_deref()
        .map(|email| {
            database
                .accounts
                .iter()
                .any(|account| account.user.email.eq_ignore_ascii_case(email))
        })
        .unwrap_or(false);

    if !active_is_valid {
        database.active_account_email = database
            .accounts
            .first()
            .map(|account| account.user.email.clone());
    }

    sync_legacy_fields_from_active(database);
}

fn account_connected(account: &GmailAccountRecord) -> bool {
    account
        .access_token
        .as_deref()
        .map(|token| !token.trim().is_empty())
        .unwrap_or(false)
        && !account.user.email.trim().is_empty()
}

fn active_account(database: &GmailDatabase) -> Option<&GmailAccountRecord> {
    database
        .active_account_email
        .as_deref()
        .and_then(|email| {
            database
                .accounts
                .iter()
                .find(|account| account.user.email.eq_ignore_ascii_case(email))
        })
        .or_else(|| database.accounts.first())
}

fn select_account_record(
    database: &GmailDatabase,
    requested_email: Option<&str>,
) -> Result<GmailAccountRecord, String> {
    let account = if let Some(email) = requested_email {
        database
            .accounts
            .iter()
            .find(|account| account.user.email.eq_ignore_ascii_case(email))
            .ok_or_else(|| format!("No connected Gmail account matches {email}."))?
    } else {
        active_account(database).ok_or_else(|| {
            "Gmail is not connected. Open Apps, install Gmail, and choose a Google account."
                .to_string()
        })?
    };

    if !account_connected(account) {
        return Err(format!(
            "Gmail account {} is not connected. Reconnect it from Apps.",
            account.user.email
        ));
    }

    Ok(account.clone())
}

fn upsert_connected_account(
    database: &mut GmailDatabase,
    mut account: GmailAccountRecord,
) -> Result<(), String> {
    let email = normalize_account_email(&account.user.email, "Gmail account email")?;
    account.user.email = email.clone();

    if let Some(existing) = database
        .accounts
        .iter_mut()
        .find(|existing| existing.user.email.eq_ignore_ascii_case(&email))
    {
        *existing = account;
    } else {
        if database.accounts.len() >= MAX_GMAIL_ACCOUNTS {
            return Err(format!(
                "Gmail supports up to {MAX_GMAIL_ACCOUNTS} connected accounts. Disconnect one before adding another."
            ));
        }

        database.accounts.push(account);
    }

    database.active_account_email = Some(email);
    normalize_database_accounts(database);

    Ok(())
}

fn remove_connected_account(database: &mut GmailDatabase, email: &str) -> Result<(), String> {
    let email = normalize_account_email(email, "Gmail account email")?;
    let before_len = database.accounts.len();

    database
        .accounts
        .retain(|account| !account.user.email.eq_ignore_ascii_case(&email));

    if database.accounts.len() == before_len {
        return Err(format!("No connected Gmail account matches {email}."));
    }

    if database
        .active_account_email
        .as_deref()
        .map(|active| active.eq_ignore_ascii_case(&email))
        .unwrap_or(false)
    {
        database.active_account_email = database
            .accounts
            .first()
            .map(|account| account.user.email.clone());
    }

    sync_legacy_fields_from_active(database);
    normalize_database_accounts(database);

    Ok(())
}

fn set_active_account(database: &mut GmailDatabase, email: &str) -> Result<(), String> {
    let email = normalize_account_email(email, "Gmail account email")?;
    let account_email = database
        .accounts
        .iter()
        .find(|account| account.user.email.eq_ignore_ascii_case(&email))
        .map(|account| account.user.email.clone())
        .ok_or_else(|| format!("No connected Gmail account matches {email}."))?;

    database.active_account_email = Some(account_email);
    normalize_database_accounts(database);

    Ok(())
}

fn sync_legacy_fields_from_active(database: &mut GmailDatabase) {
    if let Some(account) = active_account(database).cloned() {
        database.access_token = account.access_token;
        database.connected_at = account.connected_at;
        database.expires_at = account.expires_at;
        database.oauth_client_id = account.oauth_client_id;
        database.refresh_token = account.refresh_token;
        database.scopes = account.scopes;
        database.user = Some(account.user);
    } else {
        database.access_token = None;
        database.connected_at = None;
        database.expires_at = None;
        database.oauth_client_id = None;
        database.refresh_token = None;
        database.scopes.clear();
        database.user = None;
    }
}

fn mark_plugin_installed(database: &mut GmailDatabase) {
    if !database.plugin_installed {
        database.plugin_installed = true;
    }

    if database.plugin_installed_at.is_none() {
        database.plugin_installed_at = Some(now_millis());
    }
}

fn clear_resolved_setup_error(app: &tauri::AppHandle, database: &mut GmailDatabase) -> bool {
    if database.access_token.is_some() || database.user.is_some() {
        return false;
    }

    let Some(error) = database.last_connection_error.as_deref() else {
        return false;
    };
    let normalized_error = error.to_ascii_lowercase();
    let missing_secret_error = normalized_error.contains("client_secret is missing")
        || normalized_error.contains("oauth client secret is missing")
        || normalized_error.contains("google oauth client secret is missing");

    if missing_secret_error
        && read_oauth_client_secret_from_user_settings(app, None)
            .ok()
            .flatten()
            .is_some()
    {
        database.last_connection_error = None;
        return true;
    }

    false
}

fn normalize_oauth_client_id(client_id: &str) -> Result<String, String> {
    let client_id = client_id.trim();

    if client_id.len() < 16 {
        return Err("Add a Google OAuth client ID before connecting Gmail.".to_string());
    }

    if !client_id
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_'))
    {
        return Err("Google OAuth client ID contains unsupported characters.".to_string());
    }

    Ok(client_id.to_string())
}

fn normalize_oauth_scope(scope: Option<&str>) -> Result<String, String> {
    let scope = scope
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_OAUTH_SCOPE);
    let scopes = split_scope(scope);

    if scopes.is_empty() {
        return Ok(DEFAULT_OAUTH_SCOPE.to_string());
    }

    for scope in &scopes {
        if !scope.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, ':' | '.' | '-' | '_' | '/')
        }) {
            return Err(format!("Google OAuth scope is invalid: {scope}"));
        }
    }

    Ok(scopes.join(" "))
}

fn resolve_oauth_client_secret(
    app: &tauri::AppHandle,
    requested_client_id: Option<&str>,
    request_client_secret: Option<&str>,
) -> Result<String, String> {
    if let Some(secret) = request_client_secret.and_then(normalize_optional_secret) {
        return Ok(secret);
    }

    if let Some(secret) = read_oauth_client_secret_from_user_settings(app, requested_client_id)? {
        return Ok(secret);
    }

    Err(missing_oauth_client_secret_message())
}

fn read_oauth_client_secret_from_user_settings(
    app: &tauri::AppHandle,
    requested_client_id: Option<&str>,
) -> Result<Option<String>, String> {
    let namespace = auth::current_user_storage_namespace(app)?;
    let Some(content) = storage::read_value(app, &namespace, GOOGLE_OAUTH_SETTINGS_STORAGE_KEY)?
    else {
        return Ok(None);
    };
    let settings = serde_json::from_str::<GoogleOAuthSettingsRecord>(&content)
        .map_err(|error| format!("Could not parse the saved Google OAuth settings: {error}"))?;
    let Some(secret) = settings
        .client_secret
        .as_deref()
        .and_then(normalize_optional_secret)
    else {
        return Ok(None);
    };

    if let Some(requested_client_id) = requested_client_id {
        let saved_client_id = settings
            .client_id
            .as_deref()
            .map(str::trim)
            .filter(|client_id| !client_id.is_empty());

        if saved_client_id
            .map(|client_id| client_id.eq_ignore_ascii_case(requested_client_id.trim()))
            .unwrap_or(false)
        {
            return Ok(Some(secret));
        }

        return Ok(None);
    }

    Ok(Some(secret))
}

fn normalize_optional_secret(value: &str) -> Option<String> {
    let value = value.trim();

    if value.len() >= 8 {
        Some(value.to_string())
    } else {
        None
    }
}

fn missing_oauth_client_secret_message() -> String {
    "Google OAuth client secret is missing. Save a desktop OAuth Client ID and Client secret in Settings > Google, then connect Gmail again.".to_string()
}

fn split_scope(scope: &str) -> Vec<String> {
    scope
        .split_whitespace()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .collect()
}

fn encode_form_body(pairs: &[(&str, &str)]) -> String {
    pairs
        .iter()
        .map(|(key, value)| format!("{}={}", encode_component(key), encode_component(value)))
        .collect::<Vec<_>>()
        .join("&")
}

fn encode_component(value: &str) -> String {
    let mut encoded = String::new();

    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            encoded.push(byte as char);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }

    encoded
}

fn format_google_error(
    prefix: &str,
    status: u16,
    error: Option<&str>,
    description: Option<&str>,
    raw_body: &str,
) -> String {
    if let Some(description) = description.filter(|value| !value.trim().is_empty()) {
        return format!("{prefix}: {description}");
    }

    if let Some(error) = error.filter(|value| !value.trim().is_empty()) {
        return format!("{prefix}: {error}");
    }

    let parsed_message = serde_json::from_str::<Value>(raw_body)
        .ok()
        .and_then(|value| value.get("error").cloned())
        .and_then(|value| {
            value
                .get("message")
                .and_then(|message| message.as_str())
                .map(ToString::to_string)
                .or_else(|| value.as_str().map(ToString::to_string))
        });

    if let Some(message) = parsed_message {
        return format!("{prefix}: {message}");
    }

    format!("{prefix}: HTTP {status}")
}

fn format_connection_error_for_storage(error: &str) -> String {
    let trimmed = error.trim();

    if trimmed.is_empty() {
        return "Google account connection did not finish.".to_string();
    }

    if trimmed.chars().count() > 500 {
        format!("{}...", trimmed.chars().take(500).collect::<String>())
    } else {
        trimmed.to_string()
    }
}

fn open_external_url(url: &str) -> Result<(), String> {
    let mut command = if cfg!(windows) {
        let mut command = Command::new("rundll32.exe");
        command.args(["url.dll,FileProtocolHandler", url]);
        command
    } else if cfg!(target_os = "macos") {
        let mut command = Command::new("open");
        command.arg(url);
        command
    } else {
        let mut command = Command::new("xdg-open");
        command.arg(url);
        command
    };

    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Could not open the Google Gmail sign-in page: {error}"))
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u64::MAX as u128) as u64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gmail_account(email: &str, token: &str) -> GmailAccountRecord {
        GmailAccountRecord {
            access_token: Some(token.to_string()),
            connected_at: Some(1),
            expires_at: Some(2),
            oauth_client_id: Some("client-id".to_string()),
            refresh_token: Some(format!("refresh-{token}")),
            scopes: vec!["https://mail.google.com/".to_string()],
            user: GmailUser {
                email: email.to_string(),
                email_verified: Some(true),
                name: Some("Test User".to_string()),
                picture: None,
                sub: Some(format!("sub-{token}")),
            },
        }
    }

    #[test]
    fn optional_gmail_thread_id_drops_placeholders_and_keeps_real_ids() {
        assert_eq!(normalize_optional_gmail_thread_id(Some("-")), None);
        assert_eq!(normalize_optional_gmail_thread_id(Some("thread-1")), None);
        assert_eq!(
            normalize_optional_gmail_thread_id(Some(" 18fabc123def456 ")),
            Some("18fabc123def456".to_string())
        );
    }

    #[test]
    fn rfc2822_message_drops_placeholder_reply_headers() {
        let to = vec!["recipient@example.com".to_string()];
        let message = create_rfc2822_message_from_input(
            Rfc2822MessageInput {
                bcc: None,
                body: "Hello",
                cc: None,
                content_type: None,
                from: None,
                in_reply_to: Some("-"),
                references: Some("none"),
                subject: "Hello",
                to: &to,
            },
            Some("sender@example.com"),
            "Gmail message",
        )
        .unwrap();

        assert!(!message.contains("In-Reply-To:"));
        assert!(!message.contains("References:"));
    }

    #[test]
    fn rfc2822_message_renders_markdown_as_html_by_default() {
        let to = vec!["recipient@example.com".to_string()];
        let message = create_rfc2822_message_from_input(
            Rfc2822MessageInput {
                bcc: None,
                body: "## Hello\n\nThis is **bold** and [safe](https://example.com).\n\n- One\n- Two\n\n<script>",
                cc: None,
                content_type: None,
                from: None,
                in_reply_to: None,
                references: None,
                subject: "Hello",
                to: &to,
            },
            Some("sender@example.com"),
            "Gmail message",
        )
        .unwrap();

        assert!(message.contains("Content-Type: text/html; charset=\"UTF-8\""));
        assert!(message.contains("<h2>Hello</h2>"));
        assert!(message.contains("<strong>bold</strong>"));
        assert!(message.contains("<a href=\"https://example.com\">safe</a>"));
        assert!(message.contains("<li>One</li>"));
        assert!(message.contains("&lt;script&gt;"));
    }

    #[test]
    fn rfc2822_message_respects_explicit_plain_text() {
        let to = vec!["recipient@example.com".to_string()];
        let message = create_rfc2822_message_from_input(
            Rfc2822MessageInput {
                bcc: None,
                body: "This is **literal markdown**.",
                cc: None,
                content_type: Some("text/plain"),
                from: None,
                in_reply_to: None,
                references: None,
                subject: "Hello",
                to: &to,
            },
            Some("sender@example.com"),
            "Gmail message",
        )
        .unwrap();

        assert!(message.contains("Content-Type: text/plain; charset=\"UTF-8\""));
        assert!(message.contains("This is **literal markdown**."));
        assert!(!message.contains("<strong>literal markdown</strong>"));
    }

    #[test]
    fn removing_last_gmail_account_clears_legacy_token_and_user() {
        let mut database = fresh_database();

        upsert_connected_account(
            &mut database,
            gmail_account("person@example.com", "token-a"),
        )
        .unwrap();
        remove_connected_account(&mut database, "person@example.com").unwrap();
        let state = create_connection_state(&database);

        assert!(database.accounts.is_empty());
        assert!(database.access_token.is_none());
        assert!(database.refresh_token.is_none());
        assert!(database.user.is_none());
        assert!(!state.connected);
        assert!(state.accounts.is_empty());
        assert!(state.user.is_none());
    }

    #[test]
    fn removing_active_gmail_account_does_not_resurrect_it_from_legacy_fields() {
        let mut database = fresh_database();

        upsert_connected_account(&mut database, gmail_account("first@example.com", "token-a"))
            .unwrap();
        upsert_connected_account(
            &mut database,
            gmail_account("second@example.com", "token-b"),
        )
        .unwrap();
        remove_connected_account(&mut database, "second@example.com").unwrap();

        assert_eq!(database.accounts.len(), 1);
        assert_eq!(database.accounts[0].user.email, "first@example.com");
        assert_eq!(
            database.user.as_ref().map(|user| user.email.as_str()),
            Some("first@example.com")
        );
        assert!(database.accounts.iter().all(|account| !account
            .user
            .email
            .eq_ignore_ascii_case("second@example.com")));
    }
}
