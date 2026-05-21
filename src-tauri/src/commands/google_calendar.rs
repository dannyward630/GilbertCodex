//! Google Calendar desktop commands for OAuth, account state, and Calendar API access.

use crate::{
    commands::auth,
    core::storage::{self, SYSTEM_NAMESPACE},
};
use base64::{engine::general_purpose, Engine as _};
use reqwest::{Method, Url};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Write},
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
const GOOGLE_CALENDAR_API_BASE_URL: &str = "https://www.googleapis.com/calendar/v3";
const GOOGLE_TASKS_API_BASE_URL: &str = "https://tasks.googleapis.com";
const CALENDAR_DATABASE_STORAGE_KEY: &str = "google-calendar-account.v1";
const GOOGLE_OAUTH_SETTINGS_STORAGE_KEY: &str = "gilbert-codex.google-oauth-settings.v1";
const CALENDAR_DATABASE_GENERATION: u32 = 1;
const DEFAULT_OAUTH_SCOPE: &str = concat!(
    "openid email profile ",
    "https://www.googleapis.com/auth/calendar ",
    "https://www.googleapis.com/auth/calendar.readonly ",
    "https://www.googleapis.com/auth/calendar.events ",
    "https://www.googleapis.com/auth/calendar.freebusy ",
    "https://www.googleapis.com/auth/tasks"
);
const OAUTH_CALLBACK_PATH: &str = "/oauth2/callback";
const OAUTH_CALLBACK_TIMEOUT_SECS: u64 = 180;
const GOOGLE_HTTP_TIMEOUT_SECS: u64 = 18;
const GOOGLE_HTTP_CONNECT_TIMEOUT_SECS: u64 = 8;
const ACCESS_TOKEN_REFRESH_GRACE_MILLIS: u64 = 60_000;
const DEFAULT_LIST_EVENT_COUNT: u32 = 10;
const MAX_LIST_EVENT_COUNT: u32 = 50;
const MAX_CALENDAR_ACCOUNTS: usize = 6;
const USER_AGENT: &str = "GilbertCodex/0.1 (desktop Google Calendar)";

#[derive(Default)]
pub struct CalendarState {
    lock: Mutex<()>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleCalendarUser {
    pub email: String,
    pub email_verified: Option<bool>,
    pub name: Option<String>,
    pub picture: Option<String>,
    pub sub: Option<String>,
}

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
struct CalendarDatabase {
    access_token: Option<String>,
    accounts: Vec<CalendarAccountRecord>,
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
    user: Option<GoogleCalendarUser>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
struct CalendarAccountRecord {
    access_token: Option<String>,
    connected_at: Option<u64>,
    expires_at: Option<u64>,
    oauth_client_id: Option<String>,
    refresh_token: Option<String>,
    scopes: Vec<String>,
    user: GoogleCalendarUser,
}

impl Default for CalendarAccountRecord {
    fn default() -> Self {
        Self {
            access_token: None,
            connected_at: None,
            expires_at: None,
            oauth_client_id: None,
            refresh_token: None,
            scopes: Vec::new(),
            user: GoogleCalendarUser {
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
pub struct CalendarConnectionState {
    pub accounts: Vec<CalendarAccountState>,
    pub active_account_email: Option<String>,
    pub connected: bool,
    pub connected_at: Option<u64>,
    pub expires_at: Option<u64>,
    pub last_connection_error: Option<String>,
    pub max_accounts: usize,
    pub plugin_installed: bool,
    pub plugin_installed_at: Option<u64>,
    pub scopes: Vec<String>,
    pub user: Option<GoogleCalendarUser>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarAccountState {
    pub active: bool,
    pub connected_at: Option<u64>,
    pub email: String,
    pub expires_at: Option<u64>,
    pub scopes: Vec<String>,
    pub user: GoogleCalendarUser,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarConnectOAuthRequest {
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
pub struct CalendarAccountEmailRequest {
    pub email: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarListCalendarsRequest {
    pub account_email: Option<String>,
    pub client_id: Option<String>,
    pub max_results: Option<u32>,
    pub min_access_role: Option<String>,
    pub page_token: Option<String>,
    pub show_deleted: Option<bool>,
    pub show_hidden: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarListEventsRequest {
    pub account_email: Option<String>,
    pub calendar_id: Option<String>,
    pub client_id: Option<String>,
    pub include_deleted: Option<bool>,
    pub max_results: Option<u32>,
    pub order_by: Option<String>,
    pub page_token: Option<String>,
    pub query: Option<String>,
    pub single_events: Option<bool>,
    pub time_max: Option<String>,
    pub time_min: Option<String>,
    pub time_zone: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarGetEventRequest {
    pub account_email: Option<String>,
    pub calendar_id: Option<String>,
    pub client_id: Option<String>,
    pub event_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarFreeBusyRequest {
    pub account_email: Option<String>,
    pub calendar_ids: Option<Vec<String>>,
    pub client_id: Option<String>,
    pub time_max: String,
    pub time_min: String,
    pub time_zone: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEventDateTimeInput {
    pub date: Option<String>,
    pub date_time: Option<String>,
    pub time_zone: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEventAttendeeInput {
    pub display_name: Option<String>,
    pub email: String,
    pub optional: Option<bool>,
    pub response_status: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarCreateEventRequest {
    pub account_email: Option<String>,
    pub attendees: Option<Vec<CalendarEventAttendeeInput>>,
    pub calendar_id: Option<String>,
    pub client_id: Option<String>,
    pub create_meet: Option<bool>,
    pub description: Option<String>,
    pub end: CalendarEventDateTimeInput,
    pub extra: Option<Value>,
    pub location: Option<String>,
    pub send_updates: Option<String>,
    pub start: CalendarEventDateTimeInput,
    pub summary: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarUpdateEventRequest {
    pub account_email: Option<String>,
    pub attendees: Option<Vec<CalendarEventAttendeeInput>>,
    pub calendar_id: Option<String>,
    pub client_id: Option<String>,
    pub create_meet: Option<bool>,
    pub description: Option<String>,
    pub end: Option<CalendarEventDateTimeInput>,
    pub event_id: String,
    pub extra: Option<Value>,
    pub location: Option<String>,
    pub send_updates: Option<String>,
    pub start: Option<CalendarEventDateTimeInput>,
    pub status: Option<String>,
    pub summary: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarDeleteEventRequest {
    pub account_email: Option<String>,
    pub calendar_id: Option<String>,
    pub client_id: Option<String>,
    pub event_id: String,
    pub send_updates: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarGoogleApiRequest {
    pub account_email: Option<String>,
    pub body: Option<Value>,
    pub client_id: Option<String>,
    pub method: String,
    pub path: String,
    pub query: Option<Map<String, Value>>,
    pub service: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarGoogleApiResponse {
    pub account_email: Option<String>,
    pub data: Value,
    pub message: String,
    pub method: String,
    pub path: String,
    pub service: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarListResponse {
    pub calendars: Vec<CalendarSummary>,
    pub next_page_token: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarSummary {
    pub access_role: Option<String>,
    pub background_color: Option<String>,
    pub description: Option<String>,
    pub foreground_color: Option<String>,
    pub id: String,
    pub primary: bool,
    pub selected: bool,
    pub summary: Option<String>,
    pub time_zone: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEventListResponse {
    pub account_email: Option<String>,
    pub calendar_id: String,
    pub events: Vec<CalendarEventSummary>,
    pub next_page_token: Option<String>,
    pub next_sync_token: Option<String>,
    pub summary: Option<String>,
    pub time_zone: Option<String>,
    pub updated: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEventDateTime {
    pub date: Option<String>,
    pub date_time: Option<String>,
    pub time_zone: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEventAttendee {
    pub display_name: Option<String>,
    pub email: Option<String>,
    pub optional: Option<bool>,
    pub organizer: Option<bool>,
    pub response_status: Option<String>,
    pub self_attendee: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEventSummary {
    pub account_email: Option<String>,
    pub attendees: Vec<CalendarEventAttendee>,
    pub calendar_id: String,
    pub conference_link: Option<String>,
    pub created: Option<String>,
    pub description: Option<String>,
    pub end: Option<CalendarEventDateTime>,
    pub hangout_link: Option<String>,
    pub html_link: Option<String>,
    pub i_cal_uid: Option<String>,
    pub id: String,
    pub location: Option<String>,
    pub start: Option<CalendarEventDateTime>,
    pub status: Option<String>,
    pub summary: Option<String>,
    pub updated: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarActionResponse {
    pub account_email: Option<String>,
    pub calendar_id: String,
    pub event: Option<CalendarEventSummary>,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarFreeBusyResponse {
    pub account_email: Option<String>,
    pub calendars: Vec<CalendarFreeBusyCalendar>,
    pub groups: HashMap<String, Value>,
    pub time_max: String,
    pub time_min: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarFreeBusyCalendar {
    pub busy: Vec<CalendarBusyBlock>,
    pub errors: Vec<String>,
    pub id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarBusyBlock {
    pub end: String,
    pub start: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CalendarApiCalendarList {
    items: Option<Vec<Value>>,
    next_page_token: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CalendarApiEventsList {
    items: Option<Vec<Value>>,
    next_page_token: Option<String>,
    next_sync_token: Option<String>,
    summary: Option<String>,
    time_zone: Option<String>,
    updated: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CalendarApiFreeBusy {
    calendars: Option<HashMap<String, CalendarApiFreeBusyCalendar>>,
    groups: Option<HashMap<String, Value>>,
    time_max: Option<String>,
    time_min: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CalendarApiFreeBusyCalendar {
    busy: Option<Vec<CalendarApiBusyBlock>>,
    errors: Option<Vec<Value>>,
}

#[derive(Debug, Deserialize)]
struct CalendarApiBusyBlock {
    end: Option<String>,
    start: Option<String>,
}

struct OAuthSession {
    authorization_url: String,
    code_verifier: String,
    listener: TcpListener,
    redirect_uri: String,
    state: String,
}

struct OAuthCallback {
    code: String,
}

struct CalendarAccess {
    access_token: String,
    account_email: String,
}

#[tauri::command]
pub fn calendar_get_state(
    app: tauri::AppHandle,
    state: tauri::State<'_, CalendarState>,
) -> Result<CalendarConnectionState, String> {
    let _guard = state.lock.lock().map_err(|_| {
        "The Google Calendar account store is busy. Try again in a moment.".to_string()
    })?;
    let mut database = load_database(&app)?;

    if clear_resolved_setup_error(&app, &mut database) {
        save_database(&app, &database)?;
    }

    Ok(create_connection_state(&database))
}

#[tauri::command]
pub fn calendar_install_plugin(
    app: tauri::AppHandle,
    state: tauri::State<'_, CalendarState>,
) -> Result<CalendarConnectionState, String> {
    let _guard = state.lock.lock().map_err(|_| {
        "The Google Calendar account store is busy. Try again in a moment.".to_string()
    })?;
    let mut database = load_database(&app)?;

    mark_plugin_installed(&mut database);
    clear_resolved_setup_error(&app, &mut database);
    save_database(&app, &database)?;

    Ok(create_connection_state(&database))
}

#[tauri::command]
pub async fn calendar_connect_oauth(
    app: tauri::AppHandle,
    state: tauri::State<'_, CalendarState>,
    request: CalendarConnectOAuthRequest,
) -> Result<CalendarConnectionState, String> {
    let client_id = normalize_oauth_client_id(&request.client_id)?;
    let client_secret =
        resolve_oauth_client_secret(&app, Some(&client_id), request.client_secret.as_deref())?;
    let scope = normalize_oauth_scope(request.scope.as_deref())?;
    let previous_database = {
        let _guard = state.lock.lock().map_err(|_| {
            "The Google Calendar account store is busy. Try again in a moment.".to_string()
        })?;
        let mut database = load_database(&app)?;

        mark_plugin_installed(&mut database);
        save_database(&app, &database)?;
        database
    };

    let connection_result: Result<CalendarAccountRecord, String> = async {
        let oauth_session = create_oauth_session(&client_id, &scope)?;
        open_external_url(&oauth_session.authorization_url)?;

        let expected_state = oauth_session.state.clone();
        let callback = tauri::async_runtime::spawn_blocking(move || {
            wait_for_oauth_callback(oauth_session.listener, expected_state)
        })
        .await
        .map_err(|error| format!("Google Calendar sign-in callback listener failed: {error}"))??;

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
            .ok_or_else(|| "Google did not return a Calendar access token.".to_string())?
            .to_string();
        let user_info = fetch_google_user_info(&client, &access_token).await?;
        let user_email = normalize_account_email(
            user_info.email.as_deref().unwrap_or_default(),
            "Google Calendar account email",
        )?;
        let user = GoogleCalendarUser {
            email: user_email,
            email_verified: user_info.email_verified,
            name: user_info.name,
            picture: user_info.picture,
            sub: user_info.sub,
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

        Ok(CalendarAccountRecord {
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
                "The Google Calendar account store is busy. Try again in a moment.".to_string()
            })?;
            let mut database = load_database(&app)?;

            mark_plugin_installed(&mut database);
            database.last_connection_error = Some(format_connection_error_for_storage(&error));
            save_database(&app, &database)?;
            return Err(error);
        }
    };

    let _guard = state.lock.lock().map_err(|_| {
        "The Google Calendar account store is busy. Try again in a moment.".to_string()
    })?;
    let mut database = load_database(&app)?;

    mark_plugin_installed(&mut database);
    upsert_connected_account(&mut database, account)?;
    database.last_connection_error = None;
    save_database(&app, &database)?;

    Ok(create_connection_state(&database))
}

#[tauri::command]
pub fn calendar_disconnect(
    app: tauri::AppHandle,
    state: tauri::State<'_, CalendarState>,
) -> Result<CalendarConnectionState, String> {
    let _guard = state.lock.lock().map_err(|_| {
        "The Google Calendar account store is busy. Try again in a moment.".to_string()
    })?;
    let previous_database = load_database(&app)?;
    let mut database = fresh_database();

    database.plugin_installed = previous_database.plugin_installed;
    database.plugin_installed_at = previous_database.plugin_installed_at;
    save_database(&app, &database)?;

    Ok(create_connection_state(&database))
}

#[tauri::command]
pub fn calendar_disconnect_account(
    app: tauri::AppHandle,
    state: tauri::State<'_, CalendarState>,
    request: CalendarAccountEmailRequest,
) -> Result<CalendarConnectionState, String> {
    let _guard = state.lock.lock().map_err(|_| {
        "The Google Calendar account store is busy. Try again in a moment.".to_string()
    })?;
    let mut database = load_database(&app)?;

    remove_connected_account(&mut database, &request.email)?;
    database.plugin_installed = true;
    save_database(&app, &database)?;

    Ok(create_connection_state(&database))
}

#[tauri::command]
pub fn calendar_set_active_account(
    app: tauri::AppHandle,
    state: tauri::State<'_, CalendarState>,
    request: CalendarAccountEmailRequest,
) -> Result<CalendarConnectionState, String> {
    let _guard = state.lock.lock().map_err(|_| {
        "The Google Calendar account store is busy. Try again in a moment.".to_string()
    })?;
    let mut database = load_database(&app)?;

    set_active_account(&mut database, &request.email)?;
    save_database(&app, &database)?;

    Ok(create_connection_state(&database))
}

#[tauri::command]
pub async fn calendar_list_calendars(
    app: tauri::AppHandle,
    state: tauri::State<'_, CalendarState>,
    request: CalendarListCalendarsRequest,
) -> Result<CalendarListResponse, String> {
    let access = authorize_calendar_access(
        &app,
        &state,
        request.account_email.as_deref(),
        request.client_id.as_deref(),
    )
    .await?;
    let client = google_client()?;
    let mut url = calendar_api_url("users/me/calendarList")?;

    {
        let mut query = url.query_pairs_mut();
        query.append_pair(
            "maxResults",
            &bounded_u32(request.max_results, 50, 1, 250).to_string(),
        );

        if let Some(page_token) = optional_trimmed(request.page_token.as_deref()) {
            query.append_pair("pageToken", page_token);
        }

        if let Some(role) = optional_trimmed(request.min_access_role.as_deref()) {
            query.append_pair("minAccessRole", role);
        }

        if request.show_deleted.unwrap_or(false) {
            query.append_pair("showDeleted", "true");
        }

        if request.show_hidden.unwrap_or(false) {
            query.append_pair("showHidden", "true");
        }
    }

    let response = google_json_api::<CalendarApiCalendarList>(
        &client,
        &access.access_token,
        Method::GET,
        url,
        None,
    )
    .await?;

    Ok(CalendarListResponse {
        calendars: response
            .items
            .unwrap_or_default()
            .iter()
            .filter_map(calendar_summary_from_value)
            .collect(),
        next_page_token: response.next_page_token,
    })
}

#[tauri::command]
pub async fn calendar_list_events(
    app: tauri::AppHandle,
    state: tauri::State<'_, CalendarState>,
    request: CalendarListEventsRequest,
) -> Result<CalendarEventListResponse, String> {
    let access = authorize_calendar_access(
        &app,
        &state,
        request.account_email.as_deref(),
        request.client_id.as_deref(),
    )
    .await?;
    let calendar_id = normalize_calendar_id(request.calendar_id.as_deref())?;
    let client = google_client()?;
    let mut url = calendar_api_url(&format!(
        "calendars/{}/events",
        encode_component(&calendar_id)
    ))?;
    let single_events = request.single_events.unwrap_or(true);

    {
        let mut query = url.query_pairs_mut();
        query.append_pair(
            "maxResults",
            &bounded_u32(
                request.max_results,
                DEFAULT_LIST_EVENT_COUNT,
                1,
                MAX_LIST_EVENT_COUNT,
            )
            .to_string(),
        );
        query.append_pair("singleEvents", if single_events { "true" } else { "false" });

        if single_events {
            query.append_pair(
                "orderBy",
                sanitize_order_by(request.order_by.as_deref()).unwrap_or("startTime"),
            );
        } else if let Some(order_by) = sanitize_order_by(request.order_by.as_deref()) {
            query.append_pair("orderBy", order_by);
        }

        if request.include_deleted.unwrap_or(false) {
            query.append_pair("showDeleted", "true");
        }

        if let Some(page_token) = optional_trimmed(request.page_token.as_deref()) {
            query.append_pair("pageToken", page_token);
        }

        if let Some(query_text) = optional_trimmed(request.query.as_deref()) {
            query.append_pair("q", query_text);
        }

        if let Some(time_min) = optional_trimmed(request.time_min.as_deref()) {
            query.append_pair("timeMin", time_min);
        }

        if let Some(time_max) = optional_trimmed(request.time_max.as_deref()) {
            query.append_pair("timeMax", time_max);
        }

        if let Some(time_zone) = optional_trimmed(request.time_zone.as_deref()) {
            query.append_pair("timeZone", time_zone);
        }
    }

    let response = google_json_api::<CalendarApiEventsList>(
        &client,
        &access.access_token,
        Method::GET,
        url,
        None,
    )
    .await?;

    Ok(CalendarEventListResponse {
        account_email: Some(access.account_email.clone()),
        calendar_id: calendar_id.clone(),
        events: response
            .items
            .unwrap_or_default()
            .iter()
            .map(|event| {
                calendar_event_from_value(event, Some(&access.account_email), &calendar_id)
            })
            .collect(),
        next_page_token: response.next_page_token,
        next_sync_token: response.next_sync_token,
        summary: response.summary,
        time_zone: response.time_zone,
        updated: response.updated,
    })
}

#[tauri::command]
pub async fn calendar_get_event(
    app: tauri::AppHandle,
    state: tauri::State<'_, CalendarState>,
    request: CalendarGetEventRequest,
) -> Result<CalendarEventSummary, String> {
    let access = authorize_calendar_access(
        &app,
        &state,
        request.account_email.as_deref(),
        request.client_id.as_deref(),
    )
    .await?;
    let calendar_id = normalize_calendar_id(request.calendar_id.as_deref())?;
    let event_id = normalize_required_id(&request.event_id, "Calendar event id")?;
    let client = google_client()?;
    let url = calendar_api_url(&format!(
        "calendars/{}/events/{}",
        encode_component(&calendar_id),
        encode_component(&event_id)
    ))?;
    let event =
        google_json_api::<Value>(&client, &access.access_token, Method::GET, url, None).await?;

    Ok(calendar_event_from_value(
        &event,
        Some(&access.account_email),
        &calendar_id,
    ))
}

#[tauri::command]
pub async fn calendar_free_busy(
    app: tauri::AppHandle,
    state: tauri::State<'_, CalendarState>,
    request: CalendarFreeBusyRequest,
) -> Result<CalendarFreeBusyResponse, String> {
    let access = authorize_calendar_access(
        &app,
        &state,
        request.account_email.as_deref(),
        request.client_id.as_deref(),
    )
    .await?;
    let time_min = normalize_required_text(&request.time_min, "timeMin")?;
    let time_max = normalize_required_text(&request.time_max, "timeMax")?;
    let calendar_ids = request
        .calendar_ids
        .unwrap_or_default()
        .into_iter()
        .filter_map(|id| optional_trimmed(Some(&id)).map(ToString::to_string))
        .collect::<Vec<_>>();
    let calendar_ids = if calendar_ids.is_empty() {
        vec!["primary".to_string()]
    } else {
        calendar_ids
    };
    let body = json!({
        "timeMin": time_min,
        "timeMax": time_max,
        "timeZone": optional_trimmed(request.time_zone.as_deref()),
        "items": calendar_ids.iter().map(|id| json!({ "id": id })).collect::<Vec<_>>()
    });
    let client = google_client()?;
    let url = calendar_api_url("freeBusy")?;
    let response = google_json_api::<CalendarApiFreeBusy>(
        &client,
        &access.access_token,
        Method::POST,
        url,
        Some(body),
    )
    .await?;

    Ok(CalendarFreeBusyResponse {
        account_email: Some(access.account_email),
        calendars: response
            .calendars
            .unwrap_or_default()
            .into_iter()
            .map(|(id, calendar)| CalendarFreeBusyCalendar {
                busy: calendar
                    .busy
                    .unwrap_or_default()
                    .into_iter()
                    .filter_map(|block| match (block.start, block.end) {
                        (Some(start), Some(end)) => Some(CalendarBusyBlock { end, start }),
                        _ => None,
                    })
                    .collect(),
                errors: calendar
                    .errors
                    .unwrap_or_default()
                    .into_iter()
                    .filter_map(|error| {
                        first_json_string(&error, &[&["reason"], &["message"], &["domain"]])
                    })
                    .collect(),
                id,
            })
            .collect(),
        groups: response.groups.unwrap_or_default(),
        time_max: response.time_max.unwrap_or(time_max),
        time_min: response.time_min.unwrap_or(time_min),
    })
}

#[tauri::command]
pub async fn calendar_create_event(
    app: tauri::AppHandle,
    state: tauri::State<'_, CalendarState>,
    request: CalendarCreateEventRequest,
) -> Result<CalendarActionResponse, String> {
    let access = authorize_calendar_access(
        &app,
        &state,
        request.account_email.as_deref(),
        request.client_id.as_deref(),
    )
    .await?;
    let calendar_id = normalize_calendar_id(request.calendar_id.as_deref())?;
    let body = build_create_event_body(&request)?;
    let client = google_client()?;
    let mut url = calendar_api_url(&format!(
        "calendars/{}/events",
        encode_component(&calendar_id)
    ))?;

    {
        let mut query = url.query_pairs_mut();
        query.append_pair(
            "sendUpdates",
            sanitize_send_updates(request.send_updates.as_deref()),
        );

        if request.create_meet.unwrap_or(false) {
            query.append_pair("conferenceDataVersion", "1");
        }
    }

    let event =
        google_json_api::<Value>(&client, &access.access_token, Method::POST, url, Some(body))
            .await?;
    let event = calendar_event_from_value(&event, Some(&access.account_email), &calendar_id);

    Ok(CalendarActionResponse {
        account_email: Some(access.account_email),
        calendar_id,
        event: Some(event),
        message: "Google Calendar event created.".to_string(),
    })
}

#[tauri::command]
pub async fn calendar_update_event(
    app: tauri::AppHandle,
    state: tauri::State<'_, CalendarState>,
    request: CalendarUpdateEventRequest,
) -> Result<CalendarActionResponse, String> {
    let access = authorize_calendar_access(
        &app,
        &state,
        request.account_email.as_deref(),
        request.client_id.as_deref(),
    )
    .await?;
    let calendar_id = normalize_calendar_id(request.calendar_id.as_deref())?;
    let event_id = normalize_required_id(&request.event_id, "Calendar event id")?;
    let body = build_update_event_body(&request)?;
    let client = google_client()?;
    let mut url = calendar_api_url(&format!(
        "calendars/{}/events/{}",
        encode_component(&calendar_id),
        encode_component(&event_id)
    ))?;

    {
        let mut query = url.query_pairs_mut();
        query.append_pair(
            "sendUpdates",
            sanitize_send_updates(request.send_updates.as_deref()),
        );

        if request.create_meet.unwrap_or(false) {
            query.append_pair("conferenceDataVersion", "1");
        }
    }

    let event = google_json_api::<Value>(
        &client,
        &access.access_token,
        Method::PATCH,
        url,
        Some(body),
    )
    .await?;
    let event = calendar_event_from_value(&event, Some(&access.account_email), &calendar_id);

    Ok(CalendarActionResponse {
        account_email: Some(access.account_email),
        calendar_id,
        event: Some(event),
        message: "Google Calendar event updated.".to_string(),
    })
}

#[tauri::command]
pub async fn calendar_delete_event(
    app: tauri::AppHandle,
    state: tauri::State<'_, CalendarState>,
    request: CalendarDeleteEventRequest,
) -> Result<CalendarActionResponse, String> {
    let access = authorize_calendar_access(
        &app,
        &state,
        request.account_email.as_deref(),
        request.client_id.as_deref(),
    )
    .await?;
    let calendar_id = normalize_calendar_id(request.calendar_id.as_deref())?;
    let event_id = normalize_required_id(&request.event_id, "Calendar event id")?;
    let client = google_client()?;
    let mut url = calendar_api_url(&format!(
        "calendars/{}/events/{}",
        encode_component(&calendar_id),
        encode_component(&event_id)
    ))?;

    url.query_pairs_mut().append_pair(
        "sendUpdates",
        sanitize_send_updates(request.send_updates.as_deref()),
    );

    google_json_api_empty(&client, &access.access_token, Method::DELETE, url, None).await?;

    Ok(CalendarActionResponse {
        account_email: Some(access.account_email),
        calendar_id,
        event: None,
        message: format!("Google Calendar event {event_id} deleted."),
    })
}

#[tauri::command]
pub async fn calendar_google_api(
    app: tauri::AppHandle,
    state: tauri::State<'_, CalendarState>,
    request: CalendarGoogleApiRequest,
) -> Result<CalendarGoogleApiResponse, String> {
    let access = authorize_calendar_access(
        &app,
        &state,
        request.account_email.as_deref(),
        request.client_id.as_deref(),
    )
    .await?;
    let service = sanitize_google_api_service(&request.service)?;
    let method = sanitize_google_api_method(&request.method)?;
    let path = normalize_google_api_path(&request.path)?;
    let client = google_client()?;
    let mut url = match service.as_str() {
        "calendar" => google_api_url(GOOGLE_CALENDAR_API_BASE_URL, &path)?,
        "tasks" => google_api_url(GOOGLE_TASKS_API_BASE_URL, &path)?,
        _ => unreachable!("Google API service was sanitized"),
    };

    append_google_api_query(&mut url, request.query.as_ref());

    let data = google_json_api_value(
        &client,
        &access.access_token,
        method.clone(),
        url,
        request.body,
        &format!("Google {service} request failed"),
    )
    .await?;

    Ok(CalendarGoogleApiResponse {
        account_email: Some(access.account_email),
        data,
        message: format!("Google {service} API request completed."),
        method: method.as_str().to_string(),
        path,
        service,
    })
}

async fn authorize_calendar_access(
    app: &tauri::AppHandle,
    state: &tauri::State<'_, CalendarState>,
    requested_email: Option<&str>,
    requested_client_id: Option<&str>,
) -> Result<CalendarAccess, String> {
    let account = {
        let _guard = state.lock.lock().map_err(|_| {
            "The Google Calendar account store is busy. Try again in a moment.".to_string()
        })?;
        let database = load_database(app)?;
        select_account_record(&database, requested_email)?
    };

    if let Some(access_token) = account
        .access_token
        .as_deref()
        .map(str::trim)
        .filter(|token| !token.is_empty())
    {
        if !token_expires_soon(account.expires_at) {
            return Ok(CalendarAccess {
                access_token: access_token.to_string(),
                account_email: account.user.email,
            });
        }
    }

    let refresh_token = account
        .refresh_token
        .as_deref()
        .map(str::trim)
        .filter(|token| !token.is_empty())
        .ok_or_else(|| {
            format!(
                "Google Calendar account {} needs to be reconnected before Calendar tools can run.",
                account.user.email
            )
        })?
        .to_string();
    let client_id = requested_client_id
        .and_then(|value| normalize_oauth_client_id(value).ok())
        .or_else(|| account.oauth_client_id.clone())
        .ok_or_else(|| {
            "Google Calendar OAuth client id is missing. Reconnect Calendar.".to_string()
        })?;
    let client_secret = resolve_oauth_client_secret(app, Some(&client_id), None)?;
    let client = google_client()?;
    let refreshed =
        refresh_access_token(&client, &client_id, &client_secret, &refresh_token).await?;
    let access_token = refreshed
        .access_token
        .as_deref()
        .map(str::trim)
        .filter(|token| !token.is_empty())
        .ok_or_else(|| "Google did not return a refreshed Calendar access token.".to_string())?
        .to_string();
    let expires_at = refreshed
        .expires_in
        .map(|seconds| now_millis().saturating_add(seconds.saturating_mul(1000)));
    let account_email = account.user.email.clone();

    {
        let _guard = state.lock.lock().map_err(|_| {
            "The Google Calendar account store is busy. Try again in a moment.".to_string()
        })?;
        let mut database = load_database(app)?;

        if let Some(existing) = database
            .accounts
            .iter_mut()
            .find(|existing| existing.user.email.eq_ignore_ascii_case(&account_email))
        {
            existing.access_token = Some(access_token.clone());
            existing.expires_at = expires_at;
            existing.oauth_client_id = Some(client_id);
            if let Some(scope) = refreshed.scope.as_deref() {
                let scopes = split_scope(scope);
                if !scopes.is_empty() {
                    existing.scopes = scopes;
                }
            }
        }

        normalize_database_accounts(&mut database);
        save_database(app, &database)?;
    }

    Ok(CalendarAccess {
        access_token,
        account_email,
    })
}

fn load_database(app: &tauri::AppHandle) -> Result<CalendarDatabase, String> {
    let namespace = auth::current_user_storage_namespace(app)?;
    clear_shared_database(app)?;

    if let Some(content) = storage::read_value(app, &namespace, CALENDAR_DATABASE_STORAGE_KEY)? {
        return parse_database_content(&content, "Gilbert Database Google Calendar account store");
    }

    Ok(fresh_database())
}

fn save_database(app: &tauri::AppHandle, database: &CalendarDatabase) -> Result<(), String> {
    let namespace = auth::current_user_storage_namespace(app)?;
    clear_shared_database(app)?;
    let content = serde_json::to_string_pretty(database).map_err(|error| {
        format!("Could not serialize the Google Calendar account store: {error}")
    })?;

    storage::write_value(app, &namespace, CALENDAR_DATABASE_STORAGE_KEY, &content).map_err(
        |error| {
            format!(
                "Could not write the Google Calendar account store to Gilbert Database: {error}"
            )
        },
    )
}

fn clear_shared_database(app: &tauri::AppHandle) -> Result<(), String> {
    let Some(content) = storage::read_value(app, SYSTEM_NAMESPACE, CALENDAR_DATABASE_STORAGE_KEY)?
    else {
        return Ok(());
    };

    if parse_database_content(&content, "shared Google Calendar account store")
        .map(|database| database.access_token.is_none() && database.user.is_none())
        .unwrap_or(false)
    {
        return Ok(());
    }

    let content = serde_json::to_string_pretty(&fresh_database()).map_err(|error| {
        format!("Could not serialize the cleared shared Google Calendar account store: {error}")
    })?;

    storage::write_value(
        app,
        SYSTEM_NAMESPACE,
        CALENDAR_DATABASE_STORAGE_KEY,
        &content,
    )
    .map_err(|error| format!("Could not clear the shared Google Calendar account store: {error}"))
}

fn parse_database_content(content: &str, source: &str) -> Result<CalendarDatabase, String> {
    let mut database = serde_json::from_str::<CalendarDatabase>(content).map_err(|error| {
        format!("Could not parse the Google Calendar account store from {source}: {error}")
    })?;

    if database.database_generation != CALENDAR_DATABASE_GENERATION {
        return Ok(fresh_database());
    }

    normalize_database_accounts(&mut database);

    Ok(database)
}

fn create_connection_state(database: &CalendarDatabase) -> CalendarConnectionState {
    let active_account = active_account(database);
    let connected = active_account.is_some();

    CalendarConnectionState {
        accounts: database
            .accounts
            .iter()
            .filter(|account| account_connected(account))
            .map(|account| CalendarAccountState {
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
        max_accounts: MAX_CALENDAR_ACCOUNTS,
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

fn fresh_database() -> CalendarDatabase {
    CalendarDatabase {
        access_token: None,
        accounts: Vec::new(),
        active_account_email: None,
        connected_at: None,
        database_generation: CALENDAR_DATABASE_GENERATION,
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

fn normalize_database_accounts(database: &mut CalendarDatabase) {
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
            database.accounts.push(CalendarAccountRecord {
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

    if database.accounts.len() > MAX_CALENDAR_ACCOUNTS {
        database.accounts.truncate(MAX_CALENDAR_ACCOUNTS);
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

fn account_connected(account: &CalendarAccountRecord) -> bool {
    account
        .access_token
        .as_deref()
        .map(|token| !token.trim().is_empty())
        .unwrap_or(false)
        && !account.user.email.trim().is_empty()
}

fn active_account(database: &CalendarDatabase) -> Option<&CalendarAccountRecord> {
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
    database: &CalendarDatabase,
    requested_email: Option<&str>,
) -> Result<CalendarAccountRecord, String> {
    let account = if let Some(email) = requested_email {
        database
            .accounts
            .iter()
            .find(|account| account.user.email.eq_ignore_ascii_case(email))
            .ok_or_else(|| format!("No connected Google Calendar account matches {email}."))?
    } else {
        active_account(database).ok_or_else(|| {
            "Google Calendar is not connected. Open Apps, install Google Calendar, and choose a Google account."
                .to_string()
        })?
    };

    if !account_connected(account) {
        return Err(format!(
            "Google Calendar account {} is not connected. Reconnect it from Apps.",
            account.user.email
        ));
    }

    Ok(account.clone())
}

fn upsert_connected_account(
    database: &mut CalendarDatabase,
    mut account: CalendarAccountRecord,
) -> Result<(), String> {
    let email = normalize_account_email(&account.user.email, "Google Calendar account email")?;
    account.user.email = email.clone();

    if let Some(existing) = database
        .accounts
        .iter_mut()
        .find(|existing| existing.user.email.eq_ignore_ascii_case(&email))
    {
        *existing = account;
    } else {
        if database.accounts.len() >= MAX_CALENDAR_ACCOUNTS {
            return Err(format!(
                "Google Calendar supports up to {MAX_CALENDAR_ACCOUNTS} connected accounts. Disconnect one before adding another."
            ));
        }

        database.accounts.push(account);
    }

    database.active_account_email = Some(email);
    normalize_database_accounts(database);

    Ok(())
}

fn remove_connected_account(database: &mut CalendarDatabase, email: &str) -> Result<(), String> {
    let email = normalize_account_email(email, "Google Calendar account email")?;
    let before_len = database.accounts.len();

    database
        .accounts
        .retain(|account| !account.user.email.eq_ignore_ascii_case(&email));

    if database.accounts.len() == before_len {
        return Err(format!(
            "No connected Google Calendar account matches {email}."
        ));
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

fn set_active_account(database: &mut CalendarDatabase, email: &str) -> Result<(), String> {
    let email = normalize_account_email(email, "Google Calendar account email")?;
    let account_email = database
        .accounts
        .iter()
        .find(|account| account.user.email.eq_ignore_ascii_case(&email))
        .map(|account| account.user.email.clone())
        .ok_or_else(|| format!("No connected Google Calendar account matches {email}."))?;

    database.active_account_email = Some(account_email);
    normalize_database_accounts(database);

    Ok(())
}

fn sync_legacy_fields_from_active(database: &mut CalendarDatabase) {
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

fn mark_plugin_installed(database: &mut CalendarDatabase) {
    if !database.plugin_installed {
        database.plugin_installed = true;
    }

    if database.plugin_installed_at.is_none() {
        database.plugin_installed_at = Some(now_millis());
    }
}

fn clear_resolved_setup_error(app: &tauri::AppHandle, database: &mut CalendarDatabase) -> bool {
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

fn build_create_event_body(request: &CalendarCreateEventRequest) -> Result<Value, String> {
    let summary = normalize_required_text(&request.summary, "Calendar event title")?;
    let mut body = Map::new();

    body.insert("summary".to_string(), Value::String(summary));
    body.insert(
        "start".to_string(),
        calendar_time_value(&request.start, "start")?,
    );
    body.insert("end".to_string(), calendar_time_value(&request.end, "end")?);
    insert_optional_string(&mut body, "description", request.description.as_deref());
    insert_optional_string(&mut body, "location", request.location.as_deref());

    if let Some(attendees) = build_attendees_value(request.attendees.as_deref())? {
        body.insert("attendees".to_string(), attendees);
    }

    if request.create_meet.unwrap_or(false) {
        body.insert(
            "conferenceData".to_string(),
            json!({
                "createRequest": {
                    "requestId": format!("gilbert-calendar-{}", Uuid::new_v4()),
                    "conferenceSolutionKey": { "type": "hangoutsMeet" }
                }
            }),
        );
    }

    merge_event_extra(&mut body, request.extra.as_ref())?;

    Ok(Value::Object(body))
}

fn build_update_event_body(request: &CalendarUpdateEventRequest) -> Result<Value, String> {
    let mut body = Map::new();

    insert_optional_string(&mut body, "summary", request.summary.as_deref());
    insert_optional_string(&mut body, "description", request.description.as_deref());
    insert_optional_string(&mut body, "location", request.location.as_deref());

    if let Some(start) = request.start.as_ref() {
        body.insert("start".to_string(), calendar_time_value(start, "start")?);
    }

    if let Some(end) = request.end.as_ref() {
        body.insert("end".to_string(), calendar_time_value(end, "end")?);
    }

    if let Some(attendees) = build_attendees_value(request.attendees.as_deref())? {
        body.insert("attendees".to_string(), attendees);
    }

    if let Some(status) = sanitize_event_status(request.status.as_deref()) {
        body.insert("status".to_string(), Value::String(status.to_string()));
    }

    if request.create_meet.unwrap_or(false) {
        body.insert(
            "conferenceData".to_string(),
            json!({
                "createRequest": {
                    "requestId": format!("gilbert-calendar-{}", Uuid::new_v4()),
                    "conferenceSolutionKey": { "type": "hangoutsMeet" }
                }
            }),
        );
    }

    merge_event_extra(&mut body, request.extra.as_ref())?;

    if body.is_empty() {
        return Err(
            "calendar_update_event requires at least one event field to update.".to_string(),
        );
    }

    Ok(Value::Object(body))
}

fn merge_event_extra(body: &mut Map<String, Value>, extra: Option<&Value>) -> Result<(), String> {
    let Some(extra) = extra else {
        return Ok(());
    };
    let Some(extra) = extra.as_object() else {
        return Err("Calendar event extra fields must be a JSON object.".to_string());
    };

    for (key, value) in extra {
        if key.chars().any(|character| character.is_control()) {
            return Err(
                "Calendar event extra field names cannot contain control characters.".to_string(),
            );
        }

        body.insert(key.clone(), value.clone());
    }

    Ok(())
}

fn calendar_time_value(input: &CalendarEventDateTimeInput, field: &str) -> Result<Value, String> {
    let date_time = optional_trimmed(input.date_time.as_deref());
    let date = optional_trimmed(input.date.as_deref());
    let mut body = Map::new();

    if let Some(date_time) = date_time {
        body.insert("dateTime".to_string(), Value::String(date_time.to_string()));
    } else if let Some(date) = date {
        body.insert("date".to_string(), Value::String(date.to_string()));
    } else {
        return Err(format!("Calendar event {field} requires dateTime or date."));
    }

    insert_optional_string(&mut body, "timeZone", input.time_zone.as_deref());

    Ok(Value::Object(body))
}

fn build_attendees_value(
    attendees: Option<&[CalendarEventAttendeeInput]>,
) -> Result<Option<Value>, String> {
    let Some(attendees) = attendees else {
        return Ok(None);
    };

    let mut values = Vec::new();

    for attendee in attendees {
        let email = normalize_account_email(&attendee.email, "Calendar attendee email")?;
        let mut value = Map::new();

        value.insert("email".to_string(), Value::String(email));
        insert_optional_string(&mut value, "displayName", attendee.display_name.as_deref());

        if let Some(optional) = attendee.optional {
            value.insert("optional".to_string(), Value::Bool(optional));
        }

        if let Some(response_status) = sanitize_response_status(attendee.response_status.as_deref())
        {
            value.insert(
                "responseStatus".to_string(),
                Value::String(response_status.to_string()),
            );
        }

        values.push(Value::Object(value));
    }

    Ok(Some(Value::Array(values)))
}

fn insert_optional_string(body: &mut Map<String, Value>, key: &str, value: Option<&str>) {
    if let Some(value) = optional_trimmed(value) {
        body.insert(key.to_string(), Value::String(value.to_string()));
    }
}

fn calendar_summary_from_value(value: &Value) -> Option<CalendarSummary> {
    let id = first_json_string(value, &[&["id"]])?;

    Some(CalendarSummary {
        access_role: first_json_string(value, &[&["accessRole"]]),
        background_color: first_json_string(value, &[&["backgroundColor"]]),
        description: first_json_string(value, &[&["description"]]),
        foreground_color: first_json_string(value, &[&["foregroundColor"]]),
        id,
        primary: first_json_bool(value, &["primary"]).unwrap_or(false),
        selected: first_json_bool(value, &["selected"]).unwrap_or(false),
        summary: first_json_string(value, &[&["summary"]]),
        time_zone: first_json_string(value, &[&["timeZone"]]),
    })
}

fn calendar_event_from_value(
    value: &Value,
    account_email: Option<&str>,
    calendar_id: &str,
) -> CalendarEventSummary {
    CalendarEventSummary {
        account_email: account_email.map(ToString::to_string),
        attendees: value
            .get("attendees")
            .and_then(Value::as_array)
            .map(|attendees| attendees.iter().map(calendar_attendee_from_value).collect())
            .unwrap_or_default(),
        calendar_id: calendar_id.to_string(),
        conference_link: first_json_string(
            value,
            &[
                &["hangoutLink"],
                &["conferenceData", "entryPoints", "0", "uri"],
            ],
        )
        .or_else(|| conference_link_from_value(value)),
        created: first_json_string(value, &[&["created"]]),
        description: first_json_string(value, &[&["description"]]),
        end: value.get("end").map(calendar_event_time_from_value),
        hangout_link: first_json_string(value, &[&["hangoutLink"]]),
        html_link: first_json_string(value, &[&["htmlLink"]]),
        i_cal_uid: first_json_string(value, &[&["iCalUID"]]),
        id: first_json_string(value, &[&["id"]]).unwrap_or_default(),
        location: first_json_string(value, &[&["location"]]),
        start: value.get("start").map(calendar_event_time_from_value),
        status: first_json_string(value, &[&["status"]]),
        summary: first_json_string(value, &[&["summary"]]),
        updated: first_json_string(value, &[&["updated"]]),
    }
}

fn calendar_event_time_from_value(value: &Value) -> CalendarEventDateTime {
    CalendarEventDateTime {
        date: first_json_string(value, &[&["date"]]),
        date_time: first_json_string(value, &[&["dateTime"]]),
        time_zone: first_json_string(value, &[&["timeZone"]]),
    }
}

fn calendar_attendee_from_value(value: &Value) -> CalendarEventAttendee {
    CalendarEventAttendee {
        display_name: first_json_string(value, &[&["displayName"]]),
        email: first_json_string(value, &[&["email"]]),
        optional: first_json_bool(value, &["optional"]),
        organizer: first_json_bool(value, &["organizer"]),
        response_status: first_json_string(value, &[&["responseStatus"]]),
        self_attendee: first_json_bool(value, &["self"]),
    }
}

fn conference_link_from_value(value: &Value) -> Option<String> {
    value
        .get("conferenceData")
        .and_then(|data| data.get("entryPoints"))
        .and_then(Value::as_array)
        .and_then(|entry_points| {
            entry_points.iter().find_map(|entry| {
                let entry_type = first_json_string(entry, &[&["entryPointType"]]);
                let uri = first_json_string(entry, &[&["uri"]]);

                if matches!(entry_type.as_deref(), Some("video") | Some("more") | None) {
                    uri
                } else {
                    None
                }
            })
        })
}

fn first_json_string(value: &Value, paths: &[&[&str]]) -> Option<String> {
    for path in paths {
        if let Some(value) = json_path_value(value, path).and_then(Value::as_str) {
            let value = value.trim();

            if !value.is_empty() {
                return Some(value.to_string());
            }
        }
    }

    None
}

fn first_json_bool(value: &Value, path: &[&str]) -> Option<bool> {
    json_path_value(value, path).and_then(Value::as_bool)
}

fn json_path_value<'a>(value: &'a Value, path: &[&str]) -> Option<&'a Value> {
    let mut current = value;

    for key in path {
        if let Ok(index) = key.parse::<usize>() {
            current = current.as_array()?.get(index)?;
        } else {
            current = current.get(*key)?;
        }
    }

    Some(current)
}

async fn exchange_oauth_code(
    client: &reqwest::Client,
    client_id: &str,
    client_secret: &str,
    code: &str,
    redirect_uri: &str,
    code_verifier: &str,
) -> Result<GoogleOAuthTokenResponse, String> {
    let form_body = encode_form_body(&[
        ("client_id", client_id),
        ("client_secret", client_secret),
        ("code", code),
        ("code_verifier", code_verifier),
        ("grant_type", "authorization_code"),
        ("redirect_uri", redirect_uri),
    ]);
    let response = client
        .post(GOOGLE_OAUTH_TOKEN_URL)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(form_body)
        .send()
        .await
        .map_err(|error| format!("Google Calendar OAuth token exchange failed: {error}"))?;
    parse_google_oauth_response(response, "Google Calendar OAuth token exchange failed").await
}

async fn refresh_access_token(
    client: &reqwest::Client,
    client_id: &str,
    client_secret: &str,
    refresh_token: &str,
) -> Result<GoogleOAuthTokenResponse, String> {
    let form_body = encode_form_body(&[
        ("client_id", client_id),
        ("client_secret", client_secret),
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh_token),
    ]);
    let response = client
        .post(GOOGLE_OAUTH_TOKEN_URL)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(form_body)
        .send()
        .await
        .map_err(|error| format!("Google Calendar OAuth refresh failed: {error}"))?;
    parse_google_oauth_response(response, "Google Calendar OAuth refresh failed").await
}

async fn parse_google_oauth_response(
    response: reqwest::Response,
    prefix: &str,
) -> Result<GoogleOAuthTokenResponse, String> {
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| format!("Could not read the Google OAuth response: {error}"))?;
    let token_response = serde_json::from_str::<GoogleOAuthTokenResponse>(&text).ok();

    if status.is_success() {
        return token_response.ok_or_else(|| {
            "Google returned an unreadable Calendar OAuth token response.".to_string()
        });
    }

    Err(format_google_error(
        prefix,
        status.as_u16(),
        token_response
            .as_ref()
            .and_then(|value| value.error.as_deref()),
        token_response
            .as_ref()
            .and_then(|value| value.error_description.as_deref()),
        &text,
    ))
}

async fn fetch_google_user_info(
    client: &reqwest::Client,
    access_token: &str,
) -> Result<GoogleUserInfoResponse, String> {
    google_json_api::<GoogleUserInfoResponse>(
        client,
        access_token,
        Method::GET,
        Url::parse(GOOGLE_USERINFO_URL)
            .map_err(|error| format!("Could not build Google user info URL: {error}"))?,
        None,
    )
    .await
}

async fn google_json_api<T: DeserializeOwned>(
    client: &reqwest::Client,
    access_token: &str,
    method: Method,
    url: Url,
    body: Option<Value>,
) -> Result<T, String> {
    let mut request = client
        .request(method, url)
        .bearer_auth(access_token)
        .header("Accept", "application/json");

    if let Some(body) = body {
        request = request.json(&body);
    }

    let response = request
        .send()
        .await
        .map_err(|error| format!("Google Calendar request failed: {error}"))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| format!("Could not read the Google Calendar response: {error}"))?;

    if status.is_success() {
        return serde_json::from_str::<T>(&text)
            .map_err(|error| format!("Could not parse the Google Calendar response: {error}"));
    }

    Err(format_google_error(
        "Google Calendar request failed",
        status.as_u16(),
        None,
        None,
        &text,
    ))
}

async fn google_json_api_empty(
    client: &reqwest::Client,
    access_token: &str,
    method: Method,
    url: Url,
    body: Option<Value>,
) -> Result<(), String> {
    let mut request = client
        .request(method, url)
        .bearer_auth(access_token)
        .header("Accept", "application/json");

    if let Some(body) = body {
        request = request.json(&body);
    }

    let response = request
        .send()
        .await
        .map_err(|error| format!("Google Calendar request failed: {error}"))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| format!("Could not read the Google Calendar response: {error}"))?;

    if status.is_success() {
        return Ok(());
    }

    Err(format_google_error(
        "Google Calendar request failed",
        status.as_u16(),
        None,
        None,
        &text,
    ))
}

async fn google_json_api_value(
    client: &reqwest::Client,
    access_token: &str,
    method: Method,
    url: Url,
    body: Option<Value>,
    error_prefix: &str,
) -> Result<Value, String> {
    let mut request = client
        .request(method, url)
        .bearer_auth(access_token)
        .header("Accept", "application/json");

    if let Some(body) = body {
        request = request.json(&body);
    }

    let response = request
        .send()
        .await
        .map_err(|error| format!("{error_prefix}: {error}"))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| format!("Could not read the Google API response: {error}"))?;

    if status.is_success() {
        let trimmed = text.trim();

        if trimmed.is_empty() {
            return Ok(Value::Null);
        }

        return serde_json::from_str::<Value>(trimmed)
            .map_err(|error| format!("Could not parse the Google API response: {error}"));
    }

    Err(format_google_error(
        error_prefix,
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
        .map_err(|error| format!("Could not create the Google Calendar client: {error}"))
}

fn calendar_api_url(path: &str) -> Result<Url, String> {
    google_api_url(GOOGLE_CALENDAR_API_BASE_URL, path)
}

fn google_api_url(base_url: &str, path: &str) -> Result<Url, String> {
    Url::parse(&format!(
        "{}/{}",
        base_url.trim_end_matches('/'),
        path.trim_start_matches('/')
    ))
    .map_err(|error| format!("Could not build Google API URL: {error}"))
}

fn create_oauth_session(client_id: &str, scope: &str) -> Result<OAuthSession, String> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|error| {
        format!("Could not start the Google Calendar sign-in callback listener: {error}")
    })?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("Could not read Google Calendar callback listener port: {error}"))?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{port}{OAUTH_CALLBACK_PATH}");
    let state = Uuid::new_v4().to_string();
    let code_verifier = create_code_verifier();
    let code_challenge = create_code_challenge(&code_verifier);
    let mut auth_url = Url::parse(GOOGLE_OAUTH_AUTHORIZE_URL)
        .map_err(|error| format!("Could not build Google Calendar sign-in URL: {error}"))?;

    auth_url
        .query_pairs_mut()
        .append_pair("access_type", "offline")
        .append_pair("client_id", client_id)
        .append_pair("code_challenge", &code_challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("include_granted_scopes", "true")
        .append_pair("prompt", "consent select_account")
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("scope", scope)
        .append_pair("state", &state);

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
    listener.set_nonblocking(true).map_err(|error| {
        format!("Could not configure Google Calendar callback listener: {error}")
    })?;
    let started_at = Instant::now();

    loop {
        if started_at.elapsed() > Duration::from_secs(OAUTH_CALLBACK_TIMEOUT_SECS) {
            return Err(
                "Google Calendar sign-in timed out before Google returned authorization."
                    .to_string(),
            );
        }

        match listener.accept() {
            Ok((mut stream, _addr)) => {
                let mut request_line = String::new();

                {
                    let mut reader = BufReader::new(&stream);
                    reader.read_line(&mut request_line).map_err(|error| {
                        format!("Could not read Google Calendar sign-in callback: {error}")
                    })?;
                }

                let result = parse_oauth_callback_line(&request_line, &expected_state);
                let response = match &result {
                    Ok(_) => oauth_html_response(
                        "Google Calendar connected",
                        "You can close this browser window and return to Gilbert Codex.",
                    ),
                    Err(error) => oauth_html_response("Google Calendar connection failed", error),
                };

                let _ = stream.write_all(response.as_bytes());
                return result;
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(80));
            }
            Err(error) => {
                return Err(format!("Google Calendar sign-in callback failed: {error}"));
            }
        }
    }
}

fn parse_oauth_callback_line(line: &str, expected_state: &str) -> Result<OAuthCallback, String> {
    let target = line
        .split_whitespace()
        .nth(1)
        .ok_or_else(|| "Google Calendar sign-in callback was malformed.".to_string())?;
    let callback_url = Url::parse(&format!("http://127.0.0.1{target}"))
        .map_err(|error| format!("Google Calendar sign-in callback URL was invalid: {error}"))?;

    if callback_url.path() != OAUTH_CALLBACK_PATH {
        return Err("Google Calendar sign-in callback used an unexpected path.".to_string());
    }

    let mut code = None;
    let mut state = None;
    let mut error = None;
    let mut error_description = None;

    for (key, value) in callback_url.query_pairs() {
        match key.as_ref() {
            "code" => code = Some(value.to_string()),
            "error" => error = Some(value.to_string()),
            "error_description" => error_description = Some(value.to_string()),
            "state" => state = Some(value.to_string()),
            _ => {}
        }
    }

    if let Some(error) = error {
        return Err(error_description.unwrap_or(error));
    }

    if state.as_deref() != Some(expected_state) {
        return Err("Google Calendar sign-in returned an unexpected state token.".to_string());
    }

    let code = code
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            "Google Calendar sign-in did not return an authorization code.".to_string()
        })?;

    Ok(OAuthCallback { code })
}

fn oauth_html_response(title: &str, body: &str) -> String {
    format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nConnection: close\r\n\r\n<!doctype html><title>{}</title><body style=\"font-family: system-ui; margin: 48px;\"><h1>{}</h1><p>{}</p></body>",
        escape_html(title),
        escape_html(title),
        escape_html(body)
    )
}

fn create_code_verifier() -> String {
    general_purpose::URL_SAFE_NO_PAD.encode(Uuid::new_v4().as_bytes())
}

fn create_code_challenge(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    general_purpose::URL_SAFE_NO_PAD.encode(digest)
}

fn normalize_oauth_client_id(client_id: &str) -> Result<String, String> {
    let client_id = client_id.trim();

    if client_id.len() < 16 {
        return Err("Add a Google OAuth client ID before connecting Google Calendar.".to_string());
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

fn normalize_account_email(value: &str, field: &str) -> Result<String, String> {
    let value = normalize_required_text(value, field)?;

    if !value.contains('@') || value.chars().any(|character| character.is_control()) {
        return Err(format!("{field} is not a valid email address."));
    }

    Ok(value)
}

fn sanitize_google_api_service(value: &str) -> Result<String, String> {
    match value.trim().to_ascii_lowercase().as_str() {
        "calendar" => Ok("calendar".to_string()),
        "tasks" => Ok("tasks".to_string()),
        _ => Err("Google API service must be calendar or tasks.".to_string()),
    }
}

fn sanitize_google_api_method(value: &str) -> Result<Method, String> {
    match value.trim().to_ascii_uppercase().as_str() {
        "DELETE" => Ok(Method::DELETE),
        "GET" => Ok(Method::GET),
        "PATCH" => Ok(Method::PATCH),
        "POST" => Ok(Method::POST),
        "PUT" => Ok(Method::PUT),
        _ => Err("Google API method must be GET, POST, PATCH, PUT, or DELETE.".to_string()),
    }
}

fn normalize_google_api_path(value: &str) -> Result<String, String> {
    let value = normalize_required_text(value, "Google API path")?;

    if value.contains("://")
        || value.starts_with("//")
        || value.contains('\\')
        || value.chars().any(|character| character.is_control())
        || value.split('/').any(|segment| segment == "..")
    {
        return Err("Google API path must be a relative API path.".to_string());
    }

    Ok(value.trim_start_matches('/').to_string())
}

fn append_google_api_query(url: &mut Url, query: Option<&Map<String, Value>>) {
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

fn normalize_calendar_id(value: Option<&str>) -> Result<String, String> {
    let value = value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("primary");

    if value.chars().any(|character| character.is_control()) {
        return Err("Calendar id contains unsupported characters.".to_string());
    }

    Ok(value.to_string())
}

fn normalize_required_id(value: &str, field: &str) -> Result<String, String> {
    let value = normalize_required_text(value, field)?;

    if value.chars().any(|character| character.is_control()) {
        return Err(format!("{field} contains unsupported characters."));
    }

    Ok(value)
}

fn normalize_required_text(value: &str, field: &str) -> Result<String, String> {
    let value = value.trim();

    if value.is_empty() {
        return Err(format!("{field} is required."));
    }

    Ok(value.to_string())
}

fn optional_trimmed(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}

fn sanitize_send_updates(value: Option<&str>) -> &'static str {
    match value.map(str::trim) {
        Some("none") => "none",
        Some("externalOnly") => "externalOnly",
        _ => "all",
    }
}

fn sanitize_order_by(value: Option<&str>) -> Option<&'static str> {
    match value.map(str::trim) {
        Some("updated") => Some("updated"),
        Some("startTime") => Some("startTime"),
        _ => None,
    }
}

fn sanitize_response_status(value: Option<&str>) -> Option<&'static str> {
    match value.map(str::trim) {
        Some("accepted") => Some("accepted"),
        Some("declined") => Some("declined"),
        Some("tentative") => Some("tentative"),
        Some("needsAction") => Some("needsAction"),
        _ => None,
    }
}

fn sanitize_event_status(value: Option<&str>) -> Option<&'static str> {
    match value.map(str::trim) {
        Some("confirmed") => Some("confirmed"),
        Some("tentative") => Some("tentative"),
        Some("cancelled") => Some("cancelled"),
        _ => None,
    }
}

fn bounded_u32(value: Option<u32>, fallback: u32, min: u32, max: u32) -> u32 {
    value.unwrap_or(fallback).clamp(min, max)
}

fn token_expires_soon(expires_at: Option<u64>) -> bool {
    expires_at
        .map(|expires_at| {
            expires_at <= now_millis().saturating_add(ACCESS_TOKEN_REFRESH_GRACE_MILLIS)
        })
        .unwrap_or(false)
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
    "Google OAuth client secret is missing. Save a desktop OAuth Client ID and Client secret in Settings > Google, then connect Google Calendar again.".to_string()
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
        return "Google Calendar account connection did not finish.".to_string();
    }

    if trimmed.chars().count() > 500 {
        format!("{}...", trimmed.chars().take(500).collect::<String>())
    } else {
        trimmed.to_string()
    }
}

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
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
        .map_err(|error| format!("Could not open the Google Calendar sign-in page: {error}"))
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

    fn calendar_account(email: &str, token: &str) -> CalendarAccountRecord {
        CalendarAccountRecord {
            access_token: Some(token.to_string()),
            connected_at: Some(1),
            expires_at: Some(2),
            oauth_client_id: Some("client-id".to_string()),
            refresh_token: Some(format!("refresh-{token}")),
            scopes: vec!["https://www.googleapis.com/auth/calendar".to_string()],
            user: GoogleCalendarUser {
                email: email.to_string(),
                email_verified: Some(true),
                name: Some("Test User".to_string()),
                picture: None,
                sub: Some(format!("sub-{token}")),
            },
        }
    }

    #[test]
    fn removing_last_calendar_account_clears_legacy_token_and_user() {
        let mut database = fresh_database();

        upsert_connected_account(
            &mut database,
            calendar_account("person@example.com", "token-a"),
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
    fn removing_active_calendar_account_does_not_resurrect_it_from_legacy_fields() {
        let mut database = fresh_database();

        upsert_connected_account(
            &mut database,
            calendar_account("first@example.com", "token-a"),
        )
        .unwrap();
        upsert_connected_account(
            &mut database,
            calendar_account("second@example.com", "token-b"),
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
