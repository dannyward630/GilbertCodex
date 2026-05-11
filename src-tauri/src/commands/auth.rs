use crate::core::storage::{self, SYSTEM_NAMESPACE};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::PathBuf,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::Manager;
use uuid::Uuid;

const AUTH_DATABASE_FILE: &str = "local-auth-db.json";
const AUTH_DATABASE_STORAGE_KEY: &str = "local-auth-db.v1";
const AUTH_DATABASE_GENERATION: u32 = 2;
const PASSWORD_ALGORITHM: &str = "pbkdf2-sha256";
const MIN_PASSWORD_ITERATIONS: u32 = 100_000;

#[derive(Default)]
pub struct AuthState {
    lock: Mutex<()>,
}

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthDatabase {
    current_session: Option<AuthSessionRecord>,
    #[serde(default)]
    database_generation: u32,
    users: Vec<AuthUserRecord>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthUserRecord {
    created_at: u64,
    display_name: String,
    email: String,
    id: String,
    last_login_at: Option<u64>,
    password_hash: String,
    password_hash_algorithm: String,
    password_iterations: u32,
    password_salt: String,
    updated_at: u64,
    username: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthSessionRecord {
    created_at: u64,
    session_token: String,
    user_id: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthUser {
    pub created_at: u64,
    pub display_name: String,
    pub email: String,
    pub id: String,
    pub last_login_at: Option<u64>,
    pub updated_at: u64,
    pub username: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthSession {
    pub created_at: u64,
    pub session_token: String,
    pub user: AuthUser,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthStateResponse {
    pub has_accounts: bool,
    pub session: Option<AuthSession>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthCreateAccountRequest {
    pub display_name: String,
    pub email: String,
    pub password_hash: String,
    pub password_hash_algorithm: String,
    pub password_iterations: u32,
    pub password_salt: String,
    pub username: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthLoginChallengeRequest {
    pub login: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthLoginChallenge {
    pub display_name: String,
    pub password_hash_algorithm: String,
    pub password_iterations: u32,
    pub password_salt: String,
    pub username: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthLoginRequest {
    pub login: String,
    pub password_hash: String,
}

#[tauri::command]
pub fn auth_get_state(
    app: tauri::AppHandle,
    state: tauri::State<'_, AuthState>,
) -> Result<AuthStateResponse, String> {
    let _guard = state
        .lock
        .lock()
        .map_err(|_| "The local auth database is busy. Try again in a moment.".to_string())?;
    let database = load_database(&app)?;

    Ok(create_state_response(&database))
}

#[tauri::command]
pub fn auth_create_account(
    app: tauri::AppHandle,
    state: tauri::State<'_, AuthState>,
    request: AuthCreateAccountRequest,
) -> Result<AuthSession, String> {
    let _guard = state
        .lock
        .lock()
        .map_err(|_| "The local auth database is busy. Try again in a moment.".to_string())?;
    let mut database = load_database(&app)?;
    let display_name = normalize_display_name(&request.display_name)?;
    let username = normalize_username(&request.username)?;
    let email = normalize_email(&request.email)?;
    let password_material = normalize_password_material(
        request.password_hash,
        request.password_salt,
        request.password_hash_algorithm,
        request.password_iterations,
    )?;

    if database
        .users
        .iter()
        .any(|user| user.username.eq_ignore_ascii_case(&username))
    {
        return Err("That username is already used by another local account.".to_string());
    }

    if database
        .users
        .iter()
        .any(|user| user.email.eq_ignore_ascii_case(&email))
    {
        return Err("That email is already used by another local account.".to_string());
    }

    let now = now_millis();
    let user = AuthUserRecord {
        created_at: now,
        display_name,
        email,
        id: format!("user-{}", Uuid::new_v4()),
        last_login_at: Some(now),
        password_hash: password_material.hash,
        password_hash_algorithm: password_material.algorithm,
        password_iterations: password_material.iterations,
        password_salt: password_material.salt,
        updated_at: now,
        username,
    };
    let session_record = AuthSessionRecord {
        created_at: now,
        session_token: format!("session-{}", Uuid::new_v4()),
        user_id: user.id.clone(),
    };
    let session = AuthSession {
        created_at: session_record.created_at,
        session_token: session_record.session_token.clone(),
        user: AuthUser::from(&user),
    };

    database.users.push(user);
    database.current_session = Some(session_record);
    save_database(&app, &database)?;

    Ok(session)
}

#[tauri::command]
pub fn auth_get_login_challenge(
    app: tauri::AppHandle,
    state: tauri::State<'_, AuthState>,
    request: AuthLoginChallengeRequest,
) -> Result<AuthLoginChallenge, String> {
    let _guard = state
        .lock
        .lock()
        .map_err(|_| "The local auth database is busy. Try again in a moment.".to_string())?;
    let database = load_database(&app)?;
    let user = find_user(&database, &request.login)
        .ok_or_else(|| "No local account matches that username or email.".to_string())?;

    Ok(AuthLoginChallenge {
        display_name: user.display_name.clone(),
        password_hash_algorithm: user.password_hash_algorithm.clone(),
        password_iterations: user.password_iterations,
        password_salt: user.password_salt.clone(),
        username: user.username.clone(),
    })
}

#[tauri::command]
pub fn auth_login(
    app: tauri::AppHandle,
    state: tauri::State<'_, AuthState>,
    request: AuthLoginRequest,
) -> Result<AuthSession, String> {
    let _guard = state
        .lock
        .lock()
        .map_err(|_| "The local auth database is busy. Try again in a moment.".to_string())?;
    let mut database = load_database(&app)?;
    let user_index = find_user_index(&database, &request.login)
        .ok_or_else(|| "No local account matches that username or email.".to_string())?;
    let candidate_hash = request.password_hash.trim();

    if candidate_hash.is_empty() || candidate_hash != database.users[user_index].password_hash {
        return Err("The password did not match this local account.".to_string());
    }

    let now = now_millis();
    database.users[user_index].last_login_at = Some(now);
    database.users[user_index].updated_at = now;

    let session_record = AuthSessionRecord {
        created_at: now,
        session_token: format!("session-{}", Uuid::new_v4()),
        user_id: database.users[user_index].id.clone(),
    };
    let session = AuthSession {
        created_at: session_record.created_at,
        session_token: session_record.session_token.clone(),
        user: AuthUser::from(&database.users[user_index]),
    };

    database.current_session = Some(session_record);
    save_database(&app, &database)?;

    Ok(session)
}

#[tauri::command]
pub fn auth_logout(
    app: tauri::AppHandle,
    state: tauri::State<'_, AuthState>,
) -> Result<(), String> {
    let _guard = state
        .lock
        .lock()
        .map_err(|_| "The local auth database is busy. Try again in a moment.".to_string())?;
    let mut database = load_database(&app)?;

    database.current_session = None;
    save_database(&app, &database)
}

impl From<&AuthUserRecord> for AuthUser {
    fn from(user: &AuthUserRecord) -> Self {
        Self {
            created_at: user.created_at,
            display_name: user.display_name.clone(),
            email: user.email.clone(),
            id: user.id.clone(),
            last_login_at: user.last_login_at,
            updated_at: user.updated_at,
            username: user.username.clone(),
        }
    }
}

struct PasswordMaterial {
    algorithm: String,
    hash: String,
    iterations: u32,
    salt: String,
}

fn create_state_response(database: &AuthDatabase) -> AuthStateResponse {
    AuthStateResponse {
        has_accounts: !database.users.is_empty(),
        session: database
            .current_session
            .as_ref()
            .and_then(|session| create_session(database, session)),
    }
}

fn create_session(database: &AuthDatabase, session: &AuthSessionRecord) -> Option<AuthSession> {
    let user = database
        .users
        .iter()
        .find(|user| user.id == session.user_id)?;

    Some(AuthSession {
        created_at: session.created_at,
        session_token: session.session_token.clone(),
        user: AuthUser::from(user),
    })
}

fn find_user<'a>(database: &'a AuthDatabase, login: &str) -> Option<&'a AuthUserRecord> {
    let normalized_login = login.trim().to_lowercase();

    database.users.iter().find(|user| {
        user.username.eq_ignore_ascii_case(&normalized_login)
            || user.email.eq_ignore_ascii_case(&normalized_login)
    })
}

fn find_user_index(database: &AuthDatabase, login: &str) -> Option<usize> {
    let normalized_login = login.trim().to_lowercase();

    database.users.iter().position(|user| {
        user.username.eq_ignore_ascii_case(&normalized_login)
            || user.email.eq_ignore_ascii_case(&normalized_login)
    })
}

fn normalize_display_name(value: &str) -> Result<String, String> {
    let display_name = value.trim();

    if display_name.len() < 2 {
        return Err("Enter a display name with at least 2 characters.".to_string());
    }

    if display_name.len() > 80 {
        return Err("Keep the display name under 80 characters.".to_string());
    }

    Ok(display_name.to_string())
}

fn normalize_username(value: &str) -> Result<String, String> {
    let username = value.trim().trim_start_matches('@').to_lowercase();

    if username.len() < 3 {
        return Err("Choose a username with at least 3 characters.".to_string());
    }

    if username.len() > 32 {
        return Err("Keep the username under 32 characters.".to_string());
    }

    if !username
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || matches!(character, '_' | '-' | '.'))
    {
        return Err(
            "Use only letters, numbers, dots, dashes, or underscores in the username.".to_string(),
        );
    }

    Ok(username)
}

fn normalize_email(value: &str) -> Result<String, String> {
    let email = value.trim().to_lowercase();

    if email.len() > 254
        || !email.contains('@')
        || !email
            .rsplit_once('@')
            .is_some_and(|(_, domain)| domain.contains('.'))
    {
        return Err("Enter a valid email address for this local account.".to_string());
    }

    Ok(email)
}

fn normalize_password_material(
    hash: String,
    salt: String,
    algorithm: String,
    iterations: u32,
) -> Result<PasswordMaterial, String> {
    let normalized_algorithm = algorithm.trim().to_lowercase();
    let normalized_hash = hash.trim().to_string();
    let normalized_salt = salt.trim().to_string();

    if normalized_algorithm != PASSWORD_ALGORITHM {
        return Err("Unsupported local password hashing algorithm.".to_string());
    }

    if iterations < MIN_PASSWORD_ITERATIONS {
        return Err("Local password hashing iterations are too low.".to_string());
    }

    if normalized_hash.len() < 32 || normalized_salt.len() < 16 {
        return Err("The local password verifier is incomplete.".to_string());
    }

    Ok(PasswordMaterial {
        algorithm: normalized_algorithm,
        hash: normalized_hash,
        iterations,
        salt: normalized_salt,
    })
}

fn load_database(app: &tauri::AppHandle) -> Result<AuthDatabase, String> {
    if let Some(content) = storage::read_value(app, SYSTEM_NAMESPACE, AUTH_DATABASE_STORAGE_KEY)? {
        return parse_database_content(app, &content, "Gilbert Database auth record");
    }

    let database_path = legacy_database_path(app)?;

    if !database_path.exists() {
        return Ok(fresh_database());
    }

    let content = fs::read_to_string(&database_path).map_err(|error| {
        format!(
            "Could not read the local auth database at {}: {}",
            path_to_string(&database_path),
            error
        )
    })?;

    if content.trim().is_empty() {
        return Ok(fresh_database());
    }

    let database = parse_database_content(
        app,
        &content,
        &format!(
            "legacy local auth database at {}",
            path_to_string(&database_path)
        ),
    )?;
    let migrated_content = serde_json::to_string_pretty(&database).map_err(|error| {
        format!("Could not serialize the migrated local auth database: {error}")
    })?;
    storage::write_value(
        app,
        SYSTEM_NAMESPACE,
        AUTH_DATABASE_STORAGE_KEY,
        &migrated_content,
    )?;

    Ok(database)
}

fn save_database(app: &tauri::AppHandle, database: &AuthDatabase) -> Result<(), String> {
    let content = serde_json::to_string_pretty(database)
        .map_err(|error| format!("Could not serialize the local auth database: {}", error))?;

    storage::write_value(app, SYSTEM_NAMESPACE, AUTH_DATABASE_STORAGE_KEY, &content).map_err(
        |error| format!("Could not write the local auth database to Gilbert Database: {error}"),
    )
}

fn parse_database_content(
    app: &tauri::AppHandle,
    content: &str,
    source: &str,
) -> Result<AuthDatabase, String> {
    let database = serde_json::from_str::<AuthDatabase>(content).map_err(|error| {
        format!("Could not parse the local auth database from {source}: {error}")
    })?;

    if database.database_generation != AUTH_DATABASE_GENERATION {
        let fresh_database = fresh_database();
        save_database(app, &fresh_database)?;
        return Ok(fresh_database);
    }

    Ok(database)
}

fn legacy_database_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("auth").join(AUTH_DATABASE_FILE))
        .map_err(|error| format!("Could not resolve the local app data folder: {}", error))
}

fn fresh_database() -> AuthDatabase {
    AuthDatabase {
        current_session: None,
        database_generation: AUTH_DATABASE_GENERATION,
        users: Vec::new(),
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
