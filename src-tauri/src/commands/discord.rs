use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    convert::TryInto,
    io::{Read, Write},
    net::{SocketAddr, TcpListener, TcpStream},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

const DEFAULT_DISCORD_BRIDGE_PORT: u16 = 8787;
const DISCORD_INTERACTION_EVENT: &str = "discord-interaction";
const DISCORD_BRIDGE_STATUS_EVENT: &str = "discord-bridge-status";
const MAX_HTTP_HEADER_BYTES: usize = 32 * 1024;
const MAX_HTTP_BODY_BYTES: usize = 256 * 1024;
const NGROK_API_ADDR: &str = "127.0.0.1:4040";
const NGROK_PUBLIC_URL_WAIT_MS: u64 = 20_000;
const DISCORD_MESSAGE_LIMIT: usize = 1_900;

#[derive(Default)]
pub struct DiscordBridgeState {
    runtime: Mutex<DiscordBridgeRuntime>,
}

#[derive(Default)]
struct DiscordBridgeRuntime {
    local_url: Option<String>,
    message: Option<String>,
    port: Option<u16>,
    public_url: Option<String>,
    running: bool,
    stop_signal: Option<Arc<AtomicBool>>,
    tunnel_child: Option<Child>,
    tunnel_provider: Option<DiscordTunnelProvider>,
}

impl Drop for DiscordBridgeRuntime {
    fn drop(&mut self) {
        stop_runtime(self);
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum DiscordTunnelProvider {
    Local,
    Ngrok,
}

impl Default for DiscordTunnelProvider {
    fn default() -> Self {
        Self::Ngrok
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscordBridgeStartRequest {
    pub allowed_channel_ids: Option<String>,
    pub allowed_guild_ids: Option<String>,
    pub application_id: String,
    pub local_port: Option<u16>,
    pub ngrok_auth_token: Option<String>,
    pub ngrok_path: Option<String>,
    pub public_key: String,
    pub response_style: Option<String>,
    pub tunnel_provider: Option<DiscordTunnelProvider>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscordInteractionResponseRequest {
    pub application_id: String,
    pub content: String,
    pub token: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscordSlashCommandRegisterRequest {
    pub application_id: String,
    pub bot_token: String,
    pub command_name: Option<String>,
    pub guild_id: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscordBridgeStatus {
    pub error: Option<String>,
    pub local_url: Option<String>,
    pub message: String,
    pub port: Option<u16>,
    pub public_url: Option<String>,
    pub running: bool,
    pub tunnel_provider: Option<DiscordTunnelProvider>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscordInteractionEvent {
    pub application_id: String,
    pub channel_id: Option<String>,
    pub command_name: Option<String>,
    pub guild_id: Option<String>,
    pub id: String,
    pub prompt: String,
    pub received_at: u64,
    pub token: String,
    pub user_id: Option<String>,
    pub username: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscordSlashCommandRegisterResponse {
    pub command_id: String,
    pub command_name: String,
    pub guild_id: Option<String>,
    pub message: String,
    pub scope: String,
}

#[derive(Clone)]
struct DiscordBridgeServerConfig {
    allowed_channel_ids: Vec<String>,
    allowed_guild_ids: Vec<String>,
    application_id: String,
    public_key: String,
    response_style: String,
}

struct HttpRequest {
    body: Vec<u8>,
    headers: HashMap<String, String>,
    method: String,
    path: String,
}

#[tauri::command]
pub fn discord_bridge_status(
    state: tauri::State<'_, DiscordBridgeState>,
) -> Result<DiscordBridgeStatus, String> {
    let runtime = lock_runtime(&state)?;
    Ok(runtime_status(&runtime, None))
}

#[tauri::command]
pub fn discord_bridge_stop(
    app: AppHandle,
    state: tauri::State<'_, DiscordBridgeState>,
) -> Result<DiscordBridgeStatus, String> {
    let status = {
        let mut runtime = lock_runtime(&state)?;
        stop_runtime(&mut runtime);
        runtime_status(&runtime, Some("Discord bridge stopped.".to_string()))
    };
    emit_bridge_status(&app, &status);
    Ok(status)
}

#[tauri::command]
pub fn discord_bridge_start(
    app: AppHandle,
    state: tauri::State<'_, DiscordBridgeState>,
    request: DiscordBridgeStartRequest,
) -> Result<DiscordBridgeStatus, String> {
    let application_id = request.application_id.trim().to_string();
    let public_key = request.public_key.trim().to_string();
    let port = request.local_port.unwrap_or(DEFAULT_DISCORD_BRIDGE_PORT);
    let tunnel_provider = request.tunnel_provider.unwrap_or_default();
    let response_style = request
        .response_style
        .unwrap_or_else(|| "channel".to_string());

    if application_id.is_empty() {
        return Err("Add the Discord Application ID before starting the bridge.".to_string());
    }

    validate_public_key(&public_key)?;

    if !(1024..=65535).contains(&port) {
        return Err("Use a local Discord bridge port between 1024 and 65535.".to_string());
    }

    {
        let mut runtime = lock_runtime(&state)?;
        stop_runtime(&mut runtime);
    }

    thread::sleep(Duration::from_millis(90));

    let listener = TcpListener::bind(("127.0.0.1", port)).map_err(|error| {
        format!(
            "Could not start the local Discord receiver on 127.0.0.1:{}: {}",
            port, error
        )
    })?;

    let stop_signal = Arc::new(AtomicBool::new(false));
    let local_url = format!("http://127.0.0.1:{}/discord/interactions", port);
    let server_config = DiscordBridgeServerConfig {
        allowed_channel_ids: parse_id_list(
            request.allowed_channel_ids.as_deref().unwrap_or_default(),
        ),
        allowed_guild_ids: parse_id_list(request.allowed_guild_ids.as_deref().unwrap_or_default()),
        application_id: application_id.clone(),
        public_key,
        response_style: response_style.clone(),
    };

    spawn_discord_server(listener, stop_signal.clone(), app.clone(), server_config);

    let (public_url, tunnel_child, message) = match tunnel_provider {
        DiscordTunnelProvider::Ngrok => match start_ngrok_tunnel(
            port,
            request.ngrok_path.as_deref(),
            request.ngrok_auth_token.as_deref(),
        ) {
            Ok((child, public_base_url)) => (
                Some(format!("{}/discord/interactions", public_base_url.trim_end_matches('/'))),
                Some(child),
                "Discord bridge is running through ngrok.".to_string(),
            ),
            Err(error) => {
                stop_signal.store(true, Ordering::SeqCst);
                return Err(error);
            }
        },
        DiscordTunnelProvider::Local => (
            None,
            None,
            "Local receiver is running. Use a public HTTPS tunnel before saving the URL in Discord.".to_string(),
        ),
    };

    let status = {
        let mut runtime = lock_runtime(&state)?;
        runtime.local_url = Some(local_url);
        runtime.message = Some(message);
        runtime.port = Some(port);
        runtime.public_url = public_url;
        runtime.running = true;
        runtime.stop_signal = Some(stop_signal);
        runtime.tunnel_child = tunnel_child;
        runtime.tunnel_provider = Some(tunnel_provider);
        runtime_status(&runtime, None)
    };

    emit_bridge_status(&app, &status);
    Ok(status)
}

#[tauri::command]
pub async fn discord_bridge_send_interaction_response(
    request: DiscordInteractionResponseRequest,
) -> Result<(), String> {
    let application_id = request.application_id.trim();
    let token = request.token.trim();

    if application_id.is_empty() || token.is_empty() {
        return Err(
            "Discord interaction response is missing the application ID or token.".to_string(),
        );
    }

    let body = json!({
        "allowed_mentions": {
            "parse": []
        },
        "content": limit_discord_message(&request.content),
    });
    let client = reqwest::Client::new();
    let edit_url = format!(
        "https://discord.com/api/v10/webhooks/{}/{}/messages/@original",
        application_id, token
    );
    let edit_response = client
        .patch(&edit_url)
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("Could not send the Discord interaction response: {}", error))?;

    if edit_response.status().is_success() {
        return Ok(());
    }

    let edit_status = edit_response.status();
    let followup_url = format!(
        "https://discord.com/api/v10/webhooks/{}/{}",
        application_id, token
    );
    let followup_response = client
        .post(&followup_url)
        .json(&body)
        .send()
        .await
        .map_err(|error| {
            format!(
                "Could not send the Discord interaction follow-up: {}",
                error
            )
        })?;

    if followup_response.status().is_success() {
        return Ok(());
    }

    Err(format!(
        "Discord rejected the interaction response. Edit status: {}. Follow-up status: {}.",
        edit_status,
        followup_response.status()
    ))
}

#[tauri::command]
pub async fn discord_register_slash_command(
    request: DiscordSlashCommandRegisterRequest,
) -> Result<DiscordSlashCommandRegisterResponse, String> {
    let application_id = request.application_id.trim();
    let bot_token = normalize_bot_token(&request.bot_token);
    let command_name = request
        .command_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("gilbert")
        .to_ascii_lowercase();
    let guild_id = request
        .guild_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    if application_id.is_empty() {
        return Err("Add the Discord Application ID before registering /gilbert.".to_string());
    }

    if bot_token.is_empty() {
        return Err("Add the Discord Bot token before registering /gilbert.".to_string());
    }

    if !is_valid_slash_command_name(&command_name) {
        return Err("Slash command names can only use lowercase letters, numbers, hyphens, and underscores.".to_string());
    }

    let url = if let Some(guild_id) = guild_id.as_deref() {
        format!(
            "https://discord.com/api/v10/applications/{}/guilds/{}/commands",
            application_id, guild_id
        )
    } else {
        format!(
            "https://discord.com/api/v10/applications/{}/commands",
            application_id
        )
    };
    let description = if command_name == "gilbertnewchat" {
        "Start a new Gilbert Codex chat"
    } else {
        "Continue your Gilbert Codex chat"
    };
    let body = json!({
        "name": command_name,
        "type": 1,
        "description": description,
        "options": [
            {
                "name": "prompt",
                "type": 3,
                "description": "What should Gilbert do?",
                "required": true
            }
        ]
    });
    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .header("Authorization", format!("Bot {}", bot_token))
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("Could not register the Discord slash command: {}", error))?;
    let status = response.status();
    let response_text = response
        .text()
        .await
        .unwrap_or_else(|_| "Discord returned an unreadable response.".to_string());

    if !status.is_success() {
        return Err(format!(
            "Discord rejected /{} registration with status {}. {}",
            command_name, status, response_text
        ));
    }

    let response_json: Value = serde_json::from_str(&response_text).unwrap_or(Value::Null);
    let command_id = response_json
        .get("id")
        .and_then(value_to_string)
        .unwrap_or_default();
    let registered_name = response_json
        .get("name")
        .and_then(value_to_string)
        .unwrap_or_else(|| command_name.clone());
    let scope = if guild_id.is_some() {
        "guild"
    } else {
        "global"
    }
    .to_string();
    let message = if let Some(guild_id) = guild_id.as_deref() {
        format!(
            "/{} was registered for server {}. It should appear immediately in that server.",
            registered_name, guild_id
        )
    } else {
        format!(
            "/{} was registered globally. Discord may take a little while to show it everywhere.",
            registered_name
        )
    };

    Ok(DiscordSlashCommandRegisterResponse {
        command_id,
        command_name: registered_name,
        guild_id,
        message,
        scope,
    })
}

fn lock_runtime<'a>(
    state: &'a tauri::State<'_, DiscordBridgeState>,
) -> Result<std::sync::MutexGuard<'a, DiscordBridgeRuntime>, String> {
    state
        .runtime
        .lock()
        .map_err(|_| "The Discord bridge runtime is busy. Try again in a moment.".to_string())
}

fn stop_runtime(runtime: &mut DiscordBridgeRuntime) {
    if let Some(stop_signal) = runtime.stop_signal.take() {
        stop_signal.store(true, Ordering::SeqCst);
    }

    if let Some(mut child) = runtime.tunnel_child.take() {
        let _ = child.kill();
        let _ = child.wait();
    }

    runtime.local_url = None;
    runtime.message = None;
    runtime.port = None;
    runtime.public_url = None;
    runtime.running = false;
    runtime.tunnel_provider = None;
}

fn runtime_status(runtime: &DiscordBridgeRuntime, message: Option<String>) -> DiscordBridgeStatus {
    DiscordBridgeStatus {
        error: None,
        local_url: runtime.local_url.clone(),
        message: message
            .or_else(|| runtime.message.clone())
            .unwrap_or_else(|| "Discord bridge is not running.".to_string()),
        port: runtime.port,
        public_url: runtime.public_url.clone(),
        running: runtime.running,
        tunnel_provider: runtime.tunnel_provider.clone(),
    }
}

fn emit_bridge_status(app: &AppHandle, status: &DiscordBridgeStatus) {
    let _ = app.emit(DISCORD_BRIDGE_STATUS_EVENT, status.clone());
}

fn spawn_discord_server(
    listener: TcpListener,
    stop_signal: Arc<AtomicBool>,
    app: AppHandle,
    config: DiscordBridgeServerConfig,
) {
    thread::spawn(move || {
        if listener.set_nonblocking(true).is_err() {
            return;
        }

        while !stop_signal.load(Ordering::SeqCst) {
            match listener.accept() {
                Ok((stream, _)) => {
                    let app_handle = app.clone();
                    let request_config = config.clone();
                    thread::spawn(move || {
                        handle_discord_connection(stream, app_handle, request_config)
                    });
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(50));
                }
                Err(_) => break,
            }
        }
    });
}

fn handle_discord_connection(
    mut stream: TcpStream,
    app: AppHandle,
    config: DiscordBridgeServerConfig,
) {
    let request = match read_http_request(&mut stream) {
        Ok(request) => request,
        Err(error) => {
            write_text_response(&mut stream, 400, &error);
            return;
        }
    };

    if request.method == "GET" && request.path == "/health" {
        write_json_response(&mut stream, 200, &json!({ "ok": true }));
        return;
    }

    if request.method != "POST" || request.path != "/discord/interactions" {
        write_text_response(&mut stream, 404, "Not found.");
        return;
    }

    let signature = match header_value(&request.headers, "x-signature-ed25519") {
        Some(value) => value,
        None => {
            write_text_response(&mut stream, 401, "Missing Discord signature.");
            return;
        }
    };
    let timestamp = match header_value(&request.headers, "x-signature-timestamp") {
        Some(value) => value,
        None => {
            write_text_response(&mut stream, 401, "Missing Discord signature timestamp.");
            return;
        }
    };

    if let Err(error) =
        verify_discord_signature(&config.public_key, signature, timestamp, &request.body)
    {
        write_text_response(&mut stream, 401, &error);
        return;
    }

    let payload: Value = match serde_json::from_slice(&request.body) {
        Ok(value) => value,
        Err(error) => {
            write_text_response(
                &mut stream,
                400,
                &format!("Invalid Discord interaction JSON: {}", error),
            );
            return;
        }
    };

    match payload.get("type").and_then(Value::as_i64) {
        Some(1) => write_json_response(&mut stream, 200, &json!({ "type": 1 })),
        Some(2) => handle_application_command(&mut stream, app, config, payload),
        _ => write_json_response(
            &mut stream,
            200,
            &interaction_message_response(
                "Gilbert only accepts slash-command interactions right now.",
                true,
            ),
        ),
    }
}

fn handle_application_command(
    mut stream: &mut TcpStream,
    app: AppHandle,
    config: DiscordBridgeServerConfig,
    payload: Value,
) {
    if !interaction_is_allowed(&payload, &config) {
        write_json_response(
            &mut stream,
            200,
            &interaction_message_response(
                "Gilbert is not configured to respond in this Discord server or channel.",
                true,
            ),
        );
        return;
    }

    let prompt = extract_prompt(&payload).unwrap_or_default();

    if prompt.trim().is_empty() {
        write_json_response(
            &mut stream,
            200,
            &interaction_message_response(
                "Add a prompt to the slash command so Gilbert knows what to do.",
                true,
            ),
        );
        return;
    }

    let event = DiscordInteractionEvent {
        application_id: string_field(&payload, "application_id").unwrap_or(config.application_id),
        channel_id: string_field(&payload, "channel_id"),
        command_name: payload
            .pointer("/data/name")
            .and_then(Value::as_str)
            .map(str::to_string),
        guild_id: string_field(&payload, "guild_id"),
        id: string_field(&payload, "id").unwrap_or_default(),
        prompt,
        received_at: now_millis(),
        token: string_field(&payload, "token").unwrap_or_default(),
        user_id: payload
            .pointer("/member/user/id")
            .or_else(|| payload.pointer("/user/id"))
            .and_then(value_to_string),
        username: payload
            .pointer("/member/user/global_name")
            .or_else(|| payload.pointer("/member/user/username"))
            .or_else(|| payload.pointer("/user/global_name"))
            .or_else(|| payload.pointer("/user/username"))
            .and_then(value_to_string),
    };

    let ephemeral = config.response_style == "ephemeral";
    let _ = app.emit(DISCORD_INTERACTION_EVENT, event);
    write_json_response(&mut stream, 200, &deferred_interaction_response(ephemeral));
}

fn read_http_request(stream: &mut TcpStream) -> Result<HttpRequest, String> {
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .map_err(|error| format!("Could not configure Discord request timeout: {}", error))?;

    let mut bytes = Vec::new();
    let mut buffer = [0_u8; 4096];
    let header_end = loop {
        let read = stream
            .read(&mut buffer)
            .map_err(|error| format!("Could not read Discord request: {}", error))?;

        if read == 0 {
            return Err("Discord closed the request before sending headers.".to_string());
        }

        bytes.extend_from_slice(&buffer[..read]);

        if bytes.len() > MAX_HTTP_HEADER_BYTES + MAX_HTTP_BODY_BYTES {
            return Err("Discord request is too large.".to_string());
        }

        if let Some(index) = find_header_end(&bytes) {
            break index;
        }

        if bytes.len() > MAX_HTTP_HEADER_BYTES {
            return Err("Discord request headers are too large.".to_string());
        }
    };

    let header_bytes = &bytes[..header_end];
    let header_text = String::from_utf8_lossy(header_bytes);
    let mut lines = header_text.split("\r\n");
    let request_line = lines
        .next()
        .ok_or_else(|| "Discord request is missing a request line.".to_string())?;
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts.next().unwrap_or_default().to_string();
    let raw_path = request_parts.next().unwrap_or_default();
    let path = raw_path.split('?').next().unwrap_or(raw_path).to_string();
    let mut headers = HashMap::new();

    for line in lines {
        if let Some((name, value)) = line.split_once(':') {
            headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_string());
        }
    }

    let content_length = headers
        .get("content-length")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0);

    if content_length > MAX_HTTP_BODY_BYTES {
        return Err("Discord request body is too large.".to_string());
    }

    let body_start = header_end + 4;
    let mut body = bytes.get(body_start..).unwrap_or_default().to_vec();

    while body.len() < content_length {
        let read = stream
            .read(&mut buffer)
            .map_err(|error| format!("Could not read Discord request body: {}", error))?;

        if read == 0 {
            break;
        }

        body.extend_from_slice(&buffer[..read]);
    }

    body.truncate(content_length);

    Ok(HttpRequest {
        body,
        headers,
        method,
        path,
    })
}

fn find_header_end(bytes: &[u8]) -> Option<usize> {
    bytes.windows(4).position(|window| window == b"\r\n\r\n")
}

fn write_json_response(stream: &mut TcpStream, status: u16, value: &Value) {
    let body = value.to_string();
    write_http_response(stream, status, "application/json", body.as_bytes());
}

fn write_text_response(stream: &mut TcpStream, status: u16, body: &str) {
    write_http_response(stream, status, "text/plain; charset=utf-8", body.as_bytes());
}

fn write_http_response(stream: &mut TcpStream, status: u16, content_type: &str, body: &[u8]) {
    let status_text = match status {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        404 => "Not Found",
        _ => "OK",
    };
    let header = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        status,
        status_text,
        content_type,
        body.len()
    );
    let _ = stream.write_all(header.as_bytes());
    let _ = stream.write_all(body);
}

fn header_value<'a>(headers: &'a HashMap<String, String>, name: &str) -> Option<&'a str> {
    headers.get(&name.to_ascii_lowercase()).map(String::as_str)
}

fn verify_discord_signature(
    public_key: &str,
    signature: &str,
    timestamp: &str,
    body: &[u8],
) -> Result<(), String> {
    let public_key = decode_hex(public_key)?;
    let signature = decode_hex(signature)?;
    let public_key: [u8; 32] = public_key
        .as_slice()
        .try_into()
        .map_err(|_| "Discord public key must be 32 bytes of hex.".to_string())?;
    let signature: [u8; 64] = signature
        .as_slice()
        .try_into()
        .map_err(|_| "Discord signature must be 64 bytes of hex.".to_string())?;
    let verifying_key = VerifyingKey::from_bytes(&public_key)
        .map_err(|_| "Discord public key is invalid.".to_string())?;
    let signature = Signature::from_bytes(&signature);
    let mut signed_message = Vec::with_capacity(timestamp.len() + body.len());

    signed_message.extend_from_slice(timestamp.as_bytes());
    signed_message.extend_from_slice(body);

    verifying_key
        .verify(&signed_message, &signature)
        .map_err(|_| "Invalid Discord request signature.".to_string())
}

fn validate_public_key(public_key: &str) -> Result<(), String> {
    let public_key = decode_hex(public_key)?;

    if public_key.len() != 32 {
        return Err("Discord public key must be 64 hex characters.".to_string());
    }

    let public_key: [u8; 32] = public_key
        .as_slice()
        .try_into()
        .map_err(|_| "Discord public key must be 64 hex characters.".to_string())?;
    VerifyingKey::from_bytes(&public_key)
        .map_err(|_| "Discord public key is invalid.".to_string())?;
    Ok(())
}

fn decode_hex(value: &str) -> Result<Vec<u8>, String> {
    let value = value.trim();

    if value.len() % 2 != 0 {
        return Err("Expected an even-length hex value.".to_string());
    }

    (0..value.len())
        .step_by(2)
        .map(|index| {
            u8::from_str_radix(&value[index..index + 2], 16)
                .map_err(|_| "Expected a hex value.".to_string())
        })
        .collect()
}

fn deferred_interaction_response(ephemeral: bool) -> Value {
    if ephemeral {
        json!({
            "type": 5,
            "data": {
                "flags": 64
            }
        })
    } else {
        json!({
            "type": 5
        })
    }
}

fn interaction_message_response(content: &str, ephemeral: bool) -> Value {
    let mut data = json!({
        "allowed_mentions": {
            "parse": []
        },
        "content": content,
    });

    if ephemeral {
        data["flags"] = json!(64);
    }

    json!({
        "type": 4,
        "data": data
    })
}

fn interaction_is_allowed(payload: &Value, config: &DiscordBridgeServerConfig) -> bool {
    if !config.allowed_guild_ids.is_empty() {
        let guild_id = match string_field(payload, "guild_id") {
            Some(value) => value,
            None => return false,
        };

        if !config
            .allowed_guild_ids
            .iter()
            .any(|allowed| allowed == &guild_id)
        {
            return false;
        }
    }

    if !config.allowed_channel_ids.is_empty() {
        let channel_id = match string_field(payload, "channel_id") {
            Some(value) => value,
            None => return false,
        };

        if !config
            .allowed_channel_ids
            .iter()
            .any(|allowed| allowed == &channel_id)
        {
            return false;
        }
    }

    true
}

fn extract_prompt(payload: &Value) -> Option<String> {
    let options = payload.pointer("/data/options").and_then(Value::as_array)?;

    find_option_value(options, "prompt").or_else(|| collect_option_values(options))
}

fn find_option_value(options: &[Value], name: &str) -> Option<String> {
    for option in options {
        if option.get("name").and_then(Value::as_str) == Some(name) {
            if let Some(value) = option.get("value").and_then(value_to_string) {
                return Some(value);
            }
        }

        if let Some(child_options) = option.get("options").and_then(Value::as_array) {
            if let Some(value) = find_option_value(child_options, name) {
                return Some(value);
            }
        }
    }

    None
}

fn collect_option_values(options: &[Value]) -> Option<String> {
    let mut values = Vec::new();
    collect_option_values_into(options, &mut values);

    if values.is_empty() {
        None
    } else {
        Some(values.join("\n"))
    }
}

fn collect_option_values_into(options: &[Value], values: &mut Vec<String>) {
    for option in options {
        if let (Some(name), Some(value)) = (
            option.get("name").and_then(Value::as_str),
            option.get("value").and_then(value_to_string),
        ) {
            values.push(format!("{}: {}", name, value));
        }

        if let Some(child_options) = option.get("options").and_then(Value::as_array) {
            collect_option_values_into(child_options, values);
        }
    }
}

fn value_to_string(value: &Value) -> Option<String> {
    match value {
        Value::String(value) => Some(value.to_string()),
        Value::Number(value) => Some(value.to_string()),
        Value::Bool(value) => Some(value.to_string()),
        _ => None,
    }
}

fn string_field(payload: &Value, name: &str) -> Option<String> {
    payload.get(name).and_then(value_to_string)
}

fn parse_id_list(value: &str) -> Vec<String> {
    value
        .split(|character: char| character == ',' || character.is_whitespace())
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .map(str::to_string)
        .collect()
}

fn normalize_bot_token(value: &str) -> String {
    value
        .trim()
        .strip_prefix("Bot ")
        .unwrap_or_else(|| value.trim())
        .trim()
        .to_string()
}

fn is_valid_slash_command_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 32
        && value.chars().all(|character| {
            character.is_ascii_lowercase()
                || character.is_ascii_digit()
                || character == '-'
                || character == '_'
        })
}

fn start_ngrok_tunnel(
    port: u16,
    ngrok_path: Option<&str>,
    ngrok_auth_token: Option<&str>,
) -> Result<(Child, String), String> {
    let executable = resolve_ngrok_executable(ngrok_path);
    let upstream = format!("http://127.0.0.1:{}", port);
    let auth_token = ngrok_auth_token
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    if auth_token.is_none() {
        check_ngrok_config(&executable)?;
    }

    let mut command = Command::new(&executable);

    command
        .arg("http")
        .arg(&upstream)
        .arg("--log=stdout")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .stdin(Stdio::null());

    if let Some(token) = auth_token.as_deref() {
        command.arg("--authtoken").arg(token);
    }

    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    let mut child = command.spawn().map_err(|error| {
        format!(
            "Could not start ngrok from `{}`. Install ngrok, paste your ngrok auth token in Settings > Discord, or set the full ngrok path. Detail: {}",
            executable,
            error
        )
    })?;

    match wait_for_ngrok_public_url(port, &mut child) {
        Ok(public_url) => Ok((child, public_url)),
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            Err(error)
        }
    }
}

fn check_ngrok_config(executable: &str) -> Result<(), String> {
    let mut command = Command::new(executable);

    command
        .arg("config")
        .arg("check")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());

    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    let output = command.output().map_err(|error| {
        format!(
            "Could not run `{}`. Install ngrok, paste the full ngrok path, or place the ngrok executable under `.tools/ngrok/`. Detail: {}",
            executable, error
        )
    })?;

    if output.status.success() {
        return Ok(());
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let detail = [stdout, stderr]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ");

    Err(format!(
        "ngrok is installed but not configured. Paste your ngrok auth token in Settings > Discord and start the bridge again.{}",
        if detail.is_empty() {
            "".to_string()
        } else {
            format!(" Detail: {}", detail)
        }
    ))
}

fn resolve_ngrok_executable(ngrok_path: Option<&str>) -> String {
    let configured_path = ngrok_path
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("ngrok");

    if configured_path != "ngrok" {
        return configured_path.to_string();
    }

    for candidate in ngrok_path_candidates() {
        if candidate.is_file() {
            return candidate.to_string_lossy().to_string();
        }
    }

    configured_path.to_string()
}

fn ngrok_path_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(current_dir) = std::env::current_dir() {
        push_ngrok_candidates(&mut candidates, current_dir.join(".tools").join("ngrok"));
        push_ngrok_candidates(&mut candidates, current_dir.join("tools").join("ngrok"));
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));

    if let Some(repo_root) = manifest_dir.parent() {
        push_ngrok_candidates(&mut candidates, repo_root.join(".tools").join("ngrok"));
        push_ngrok_candidates(&mut candidates, repo_root.join("tools").join("ngrok"));
    }

    candidates
}

fn push_ngrok_candidates(candidates: &mut Vec<PathBuf>, directory: PathBuf) {
    candidates.push(directory.join(ngrok_executable_name()));
}

fn ngrok_executable_name() -> &'static str {
    if cfg!(windows) {
        "ngrok.exe"
    } else {
        "ngrok"
    }
}

fn wait_for_ngrok_public_url(port: u16, child: &mut Child) -> Result<String, String> {
    let started_at = Instant::now();

    while started_at.elapsed() < Duration::from_millis(NGROK_PUBLIC_URL_WAIT_MS) {
        if let Ok(Some(status)) = child.try_wait() {
            return Err(format!(
                "ngrok exited before publishing a public URL. Exit status: {}. Confirm your ngrok auth token is configured.",
                status
            ));
        }

        if let Some(public_url) = find_ngrok_public_url(port) {
            return Ok(public_url);
        }

        thread::sleep(Duration::from_millis(450));
    }

    Err("ngrok started, but Gilbert could not find its public HTTPS URL from the local ngrok Agent API.".to_string())
}

fn find_ngrok_public_url(port: u16) -> Option<String> {
    read_ngrok_api_json("/api/endpoints")
        .and_then(|json| find_ngrok_endpoint_url(&json, port))
        .or_else(|| {
            read_ngrok_api_json("/api/tunnels").and_then(|json| find_ngrok_tunnel_url(&json, port))
        })
}

fn read_ngrok_api_json(path: &str) -> Option<Value> {
    let address: SocketAddr = NGROK_API_ADDR.parse().ok()?;
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_millis(600)).ok()?;
    let request = format!(
        "GET {} HTTP/1.1\r\nHost: {}\r\nAccept: application/json\r\nConnection: close\r\n\r\n",
        path, NGROK_API_ADDR
    );
    let mut response = String::new();

    stream
        .set_read_timeout(Some(Duration::from_millis(900)))
        .ok()?;
    stream.write_all(request.as_bytes()).ok()?;
    stream.read_to_string(&mut response).ok()?;

    let (_, body) = response.split_once("\r\n\r\n")?;
    serde_json::from_str(body).ok()
}

fn find_ngrok_endpoint_url(json: &Value, port: u16) -> Option<String> {
    let endpoints = json.get("endpoints").and_then(Value::as_array)?;
    let port_text = port.to_string();

    find_matching_ngrok_url(endpoints, &port_text, |endpoint| {
        endpoint
            .pointer("/upstream/url")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_default()
    })
    .or_else(|| single_https_url(endpoints, "url"))
}

fn find_ngrok_tunnel_url(json: &Value, port: u16) -> Option<String> {
    let tunnels = json.get("tunnels").and_then(Value::as_array)?;
    let port_text = port.to_string();

    find_matching_ngrok_url(tunnels, &port_text, |tunnel| {
        tunnel
            .pointer("/config/addr")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_default()
    })
    .or_else(|| single_https_url(tunnels, "public_url"))
}

fn find_matching_ngrok_url<F>(items: &[Value], port_text: &str, upstream_value: F) -> Option<String>
where
    F: Fn(&Value) -> String,
{
    items.iter().find_map(|item| {
        let upstream = upstream_value(item);

        if !upstream.contains(port_text) {
            return None;
        }

        item.get("url")
            .or_else(|| item.get("public_url"))
            .and_then(Value::as_str)
            .filter(|url| url.starts_with("https://"))
            .map(str::to_string)
    })
}

fn single_https_url(items: &[Value], key: &str) -> Option<String> {
    if items.len() != 1 {
        return None;
    }

    items[0]
        .get(key)
        .and_then(Value::as_str)
        .filter(|url| url.starts_with("https://"))
        .map(str::to_string)
}

fn limit_discord_message(content: &str) -> String {
    let normalized = content.trim();

    if normalized.chars().count() <= DISCORD_MESSAGE_LIMIT {
        return normalized.to_string();
    }

    let mut limited = normalized
        .chars()
        .take(DISCORD_MESSAGE_LIMIT - 32)
        .collect::<String>();
    limited.push_str("\n\n[Truncated in Discord.]");
    limited
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}
