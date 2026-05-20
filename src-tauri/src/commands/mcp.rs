//! MCP desktop commands for Streamable HTTP and stdio server connections and tool calls.

use crate::{
    commands::auth,
    core::{secure_storage, storage},
};
use reqwest::{header, Method, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::{
    io::{BufRead, BufReader, Write},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{mpsc, Mutex},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

const MCP_DATABASE_STORAGE_KEY: &str = "mcp-servers.v1";
const MCP_DATABASE_GENERATION: u32 = 1;
const MCP_PROTOCOL_VERSION: &str = "2025-03-26";
const MCP_TRANSPORT_HTTP: &str = "http";
const MCP_TRANSPORT_STDIO: &str = "stdio";
const MCP_HTTP_CONNECT_TIMEOUT_SECS: u64 = 8;
const MCP_HTTP_TIMEOUT_SECS: u64 = 30;
const MCP_STDIO_TIMEOUT_SECS: u64 = 30;
const MCP_STDIO_SHUTDOWN_TIMEOUT_MS: u64 = 1_200;
const MCP_MAX_SERVERS: usize = 20;
const MCP_MAX_TOOL_LIST_PAGES: usize = 8;
const MCP_MAX_TOOLS_PER_SERVER: usize = 200;
const MCP_MAX_ARGUMENT_BYTES: usize = 256_000;
const MCP_MAX_RESULT_CHARS: usize = 80_000;
const MCP_MAX_STDIO_ARGS: usize = 80;
const MCP_MAX_STDIO_ENV: usize = 80;
const USER_AGENT: &str = "GilbertCodex/0.5 (desktop MCP)";

#[derive(Default)]
pub struct McpState {
    lock: Mutex<()>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
struct McpDatabase {
    database_generation: u32,
    servers: Vec<McpServerRecord>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
struct McpServerRecord {
    authorization_token: Option<String>,
    args: Vec<String>,
    command: Option<String>,
    created_at: Option<u64>,
    enabled: bool,
    endpoint: Option<String>,
    environment: Vec<McpEnvironmentVariable>,
    id: String,
    last_connected_at: Option<u64>,
    last_error: Option<String>,
    name: String,
    protocol_version: Option<String>,
    server_name: Option<String>,
    server_version: Option<String>,
    tools: Vec<McpToolSummary>,
    transport: String,
    updated_at: Option<u64>,
    working_directory: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct McpEnvironmentVariable {
    pub name: String,
    pub value: String,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct McpToolSummary {
    pub description: Option<String>,
    pub input_schema: Option<Value>,
    pub name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpConnectionState {
    pub connected: bool,
    pub enabled_server_count: usize,
    pub max_servers: usize,
    pub servers: Vec<McpServerState>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerState {
    pub args: Vec<String>,
    pub command: Option<String>,
    pub created_at: Option<u64>,
    pub enabled: bool,
    pub endpoint: Option<String>,
    pub environment: Vec<McpEnvironmentVariableState>,
    pub has_authorization_token: bool,
    pub id: String,
    pub last_connected_at: Option<u64>,
    pub last_error: Option<String>,
    pub name: String,
    pub protocol_version: Option<String>,
    pub server_name: Option<String>,
    pub server_version: Option<String>,
    pub tools: Vec<McpToolSummary>,
    pub transport: String,
    pub updated_at: Option<u64>,
    pub working_directory: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpEnvironmentVariableState {
    pub has_value: bool,
    pub name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpSaveServerRequest {
    pub authorization_token: Option<String>,
    pub args: Option<Vec<String>>,
    pub command: Option<String>,
    pub enabled: Option<bool>,
    pub endpoint: Option<String>,
    pub environment: Option<Vec<McpEnvironmentVariable>>,
    pub id: Option<String>,
    pub name: String,
    pub transport: Option<String>,
    pub working_directory: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpSaveServerResponse {
    pub server: McpServerState,
    pub state: McpConnectionState,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerIdRequest {
    pub id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpTestServerRequest {
    pub authorization_token: Option<String>,
    pub args: Option<Vec<String>>,
    pub command: Option<String>,
    pub endpoint: Option<String>,
    pub environment: Option<Vec<McpEnvironmentVariable>>,
    pub id: Option<String>,
    pub transport: Option<String>,
    pub working_directory: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerTestResponse {
    pub message: String,
    pub ok: bool,
    pub protocol_version: Option<String>,
    pub server: Option<McpServerState>,
    pub server_name: Option<String>,
    pub server_version: Option<String>,
    pub state: Option<McpConnectionState>,
    pub tools: Vec<McpToolSummary>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpListToolsRequest {
    pub server_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpListToolsResponse {
    pub server: McpServerState,
    pub state: McpConnectionState,
    pub tools: Vec<McpToolSummary>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpCallToolRequest {
    pub arguments: Option<Value>,
    pub server_id: String,
    pub tool_name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolCallResponse {
    pub content: String,
    pub is_error: bool,
    pub ok: bool,
    pub raw_result: Value,
    pub server: McpServerState,
    pub structured_content: Option<Value>,
    pub tool_name: String,
}

struct McpProbeResult {
    protocol_version: Option<String>,
    server_name: Option<String>,
    server_version: Option<String>,
    tools: Vec<McpToolSummary>,
}

struct McpInitializeResult {
    protocol_version: Option<String>,
    server_name: Option<String>,
    server_version: Option<String>,
    session_id: Option<String>,
}

struct McpRpcResponse {
    result: Value,
    session_id: Option<String>,
}

struct NormalizedMcpServerInput {
    args: Vec<String>,
    authorization_token: Option<String>,
    command: Option<String>,
    endpoint: Option<String>,
    environment: Vec<McpEnvironmentVariable>,
    transport: String,
    working_directory: Option<String>,
}

struct StdioMcpSession {
    child: Child,
    stderr_rx: mpsc::Receiver<String>,
    stdin: ChildStdin,
    stdout_rx: mpsc::Receiver<String>,
}

#[tauri::command(rename_all = "camelCase")]
pub fn mcp_get_state(app: tauri::AppHandle) -> Result<McpConnectionState, String> {
    let database = load_database(&app)?;
    Ok(create_connection_state(&database))
}

#[tauri::command(rename_all = "camelCase")]
pub fn mcp_save_server(
    app: tauri::AppHandle,
    state: tauri::State<'_, McpState>,
    request: McpSaveServerRequest,
) -> Result<McpSaveServerResponse, String> {
    let _guard = state
        .lock
        .lock()
        .map_err(|_| "The MCP server store is busy. Try again in a moment.".to_string())?;
    let mut database = load_database(&app)?;
    let now = now_millis();
    let name = normalize_server_name(&request.name)?;
    let input = normalize_server_input(&request)?;
    let requested_id = request.id.as_ref().and_then(|id| normalize_optional_id(id));
    let existing_index = requested_id
        .as_ref()
        .and_then(|id| database.servers.iter().position(|server| server.id == *id));
    let target_hint = normalized_server_target_hint(&input);
    let server_id = requested_id.unwrap_or_else(|| create_server_id(&name, &target_hint));

    if let Some(index) = existing_index {
        let existing = &mut database.servers[index];
        let merged_environment = if input.transport == MCP_TRANSPORT_STDIO {
            merge_stdio_environment(input.environment.clone(), &existing.environment)
        } else {
            Vec::new()
        };

        existing.name = name;
        existing.args = input.args;
        existing.command = input.command;
        existing.endpoint = input.endpoint;
        existing.environment = merged_environment;
        existing.enabled = request.enabled.unwrap_or(existing.enabled);
        existing.authorization_token = if input.transport == MCP_TRANSPORT_HTTP {
            input
                .authorization_token
                .or_else(|| existing.authorization_token.clone())
        } else {
            None
        };
        existing.last_error = None;
        existing.protocol_version = None;
        existing.server_name = None;
        existing.server_version = None;
        existing.tools.clear();
        existing.transport = input.transport;
        existing.updated_at = Some(now);
        existing.working_directory = input.working_directory;
    } else {
        if database.servers.len() >= MCP_MAX_SERVERS {
            return Err(format!(
                "MCP already has {MCP_MAX_SERVERS} servers configured. Remove one before adding another."
            ));
        }

        database.servers.push(McpServerRecord {
            args: input.args,
            authorization_token: input.authorization_token,
            command: input.command,
            created_at: Some(now),
            enabled: request.enabled.unwrap_or(true),
            endpoint: input.endpoint,
            environment: input.environment,
            id: server_id.clone(),
            last_connected_at: None,
            last_error: None,
            name,
            protocol_version: None,
            server_name: None,
            server_version: None,
            tools: Vec::new(),
            transport: input.transport,
            updated_at: Some(now),
            working_directory: input.working_directory,
        });
    }

    normalize_database(&mut database);
    save_database(&app, &database)?;

    let state = create_connection_state(&database);
    let server = state
        .servers
        .iter()
        .find(|server| server.id == server_id)
        .cloned()
        .ok_or_else(|| "MCP server was saved but could not be reloaded.".to_string())?;

    Ok(McpSaveServerResponse { server, state })
}

#[tauri::command(rename_all = "camelCase")]
pub fn mcp_remove_server(
    app: tauri::AppHandle,
    state: tauri::State<'_, McpState>,
    request: McpServerIdRequest,
) -> Result<McpConnectionState, String> {
    let _guard = state
        .lock
        .lock()
        .map_err(|_| "The MCP server store is busy. Try again in a moment.".to_string())?;
    let mut database = load_database(&app)?;
    let id = normalize_id(&request.id, "MCP server id")?;
    let before = database.servers.len();
    let removed_server = database
        .servers
        .iter()
        .find(|server| server.id == id)
        .cloned();

    database.servers.retain(|server| server.id != id);

    if database.servers.len() == before {
        return Err("MCP server was not found.".to_string());
    }

    save_database(&app, &database)?;
    delete_mcp_server_secrets(&app, &id, removed_server.as_ref());
    Ok(create_connection_state(&database))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn mcp_test_server(
    app: tauri::AppHandle,
    state: tauri::State<'_, McpState>,
    request: McpTestServerRequest,
) -> Result<McpServerTestResponse, String> {
    let id = request.id.as_ref().and_then(|id| normalize_optional_id(id));
    let record = match id.as_ref() {
        Some(server_id) => find_server_record(&app, server_id)?,
        None => create_probe_record(&request)?,
    };

    let probe = probe_server(&record).await;

    match probe {
        Ok(probe) => {
            if let Some(server_id) = id.as_ref() {
                let (state_response, server) =
                    update_server_after_probe(&app, &state, server_id, &probe, None)?;

                Ok(McpServerTestResponse {
                    message: format!(
                        "Connected to {}. Discovered {} tool{}.",
                        server.name,
                        probe.tools.len(),
                        if probe.tools.len() == 1 { "" } else { "s" }
                    ),
                    ok: true,
                    protocol_version: probe.protocol_version,
                    server: Some(server),
                    server_name: probe.server_name,
                    server_version: probe.server_version,
                    state: Some(state_response),
                    tools: probe.tools,
                })
            } else {
                Ok(McpServerTestResponse {
                    message: format!(
                        "Connected to MCP server. Discovered {} tool{}.",
                        probe.tools.len(),
                        if probe.tools.len() == 1 { "" } else { "s" }
                    ),
                    ok: true,
                    protocol_version: probe.protocol_version,
                    server: None,
                    server_name: probe.server_name,
                    server_version: probe.server_version,
                    state: None,
                    tools: probe.tools,
                })
            }
        }
        Err(error) => {
            if let Some(server_id) = id.as_ref() {
                let (state_response, server) =
                    update_server_after_error(&app, &state, server_id, &error)?;

                Ok(McpServerTestResponse {
                    message: error,
                    ok: false,
                    protocol_version: None,
                    server: Some(server),
                    server_name: None,
                    server_version: None,
                    state: Some(state_response),
                    tools: Vec::new(),
                })
            } else {
                Ok(McpServerTestResponse {
                    message: error,
                    ok: false,
                    protocol_version: None,
                    server: None,
                    server_name: None,
                    server_version: None,
                    state: None,
                    tools: Vec::new(),
                })
            }
        }
    }
}

#[tauri::command(rename_all = "camelCase")]
pub async fn mcp_list_tools(
    app: tauri::AppHandle,
    state: tauri::State<'_, McpState>,
    request: McpListToolsRequest,
) -> Result<McpListToolsResponse, String> {
    let server_id = normalize_id(&request.server_id, "MCP server id")?;
    let record = find_server_record(&app, &server_id)?;
    let probe = probe_server(&record)
        .await
        .map_err(|error| format!("Could not list tools for {}: {error}", record.name.trim()))?;
    let tools = probe.tools.clone();
    let (state_response, server) =
        update_server_after_probe(&app, &state, &server_id, &probe, None)?;

    Ok(McpListToolsResponse {
        server,
        state: state_response,
        tools,
    })
}

#[tauri::command(rename_all = "camelCase")]
pub async fn mcp_call_tool(
    app: tauri::AppHandle,
    state: tauri::State<'_, McpState>,
    request: McpCallToolRequest,
) -> Result<McpToolCallResponse, String> {
    let server_id = normalize_id(&request.server_id, "MCP server id")?;
    let tool_name = normalize_tool_name(&request.tool_name)?;
    let arguments = normalize_tool_arguments(request.arguments)?;
    let record = find_server_record(&app, &server_id)?;

    if !record.enabled {
        return Err(format!("MCP server {} is disabled.", record.name));
    }

    let raw_result = call_server_tool(&record, &tool_name, arguments).await?;
    let structured_content = raw_result.get("structuredContent").cloned();
    let is_error = raw_result
        .get("isError")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let content = format_mcp_tool_result_content(&raw_result);
    let probe = McpProbeResult {
        protocol_version: record.protocol_version.clone(),
        server_name: record.server_name.clone(),
        server_version: record.server_version.clone(),
        tools: record.tools.clone(),
    };
    let (_state_response, server) =
        update_server_after_probe(&app, &state, &server_id, &probe, None)?;

    Ok(McpToolCallResponse {
        content,
        is_error,
        ok: !is_error,
        raw_result,
        server,
        structured_content,
        tool_name,
    })
}

fn load_database(app: &tauri::AppHandle) -> Result<McpDatabase, String> {
    let namespace = auth::current_user_storage_namespace(app)?;

    if let Some(content) = storage::read_value(app, &namespace, MCP_DATABASE_STORAGE_KEY)? {
        return parse_database_content(&content);
    }

    Ok(fresh_database())
}

fn save_database(app: &tauri::AppHandle, database: &McpDatabase) -> Result<(), String> {
    let namespace = auth::current_user_storage_namespace(app)?;
    let content = serde_json::to_string_pretty(database)
        .map_err(|error| format!("Could not serialize the MCP server store: {error}"))?;

    storage::write_value(app, &namespace, MCP_DATABASE_STORAGE_KEY, &content)
        .map_err(|error| format!("Could not write the MCP server store: {error}"))
}

fn parse_database_content(content: &str) -> Result<McpDatabase, String> {
    let mut database = serde_json::from_str::<McpDatabase>(content)
        .map_err(|error| format!("Could not parse the MCP server store: {error}"))?;

    if database.database_generation != MCP_DATABASE_GENERATION {
        return Ok(fresh_database());
    }

    normalize_database(&mut database);
    Ok(database)
}

fn fresh_database() -> McpDatabase {
    McpDatabase {
        database_generation: MCP_DATABASE_GENERATION,
        servers: Vec::new(),
    }
}

fn normalize_database(database: &mut McpDatabase) {
    database.database_generation = MCP_DATABASE_GENERATION;
    database
        .servers
        .retain(|server| !server.id.trim().is_empty() && !server.name.trim().is_empty());
    database.servers.truncate(MCP_MAX_SERVERS);

    for server in &mut database.servers {
        server.transport = normalize_existing_transport(server);
        server.name = server.name.trim().to_string();

        if server.transport == MCP_TRANSPORT_STDIO {
            server.endpoint = None;
            server.authorization_token = None;
            server.command = normalize_optional_stdio_command(server.command.as_deref());
            server.args = normalize_existing_stdio_args(&server.args);
            server.environment = normalize_existing_stdio_environment(&server.environment);
            server.working_directory =
                normalize_optional_working_directory(server.working_directory.as_deref());
        } else {
            server.endpoint = server
                .endpoint
                .as_deref()
                .map(str::trim)
                .filter(|endpoint| !endpoint.is_empty())
                .map(str::to_string);
            server.command = None;
            server.args.clear();
            server.environment.clear();
            server.working_directory = None;
            server.authorization_token =
                normalize_optional_secret(server.authorization_token.as_deref());
        }

        let target_hint = server_record_target_hint(server);
        server.id = normalize_optional_id(&server.id)
            .unwrap_or_else(|| create_server_id(&server.name, &target_hint));
        server.tools.truncate(MCP_MAX_TOOLS_PER_SERVER);
    }

    database.servers.retain(has_valid_record_target);
}

fn create_connection_state(database: &McpDatabase) -> McpConnectionState {
    let servers: Vec<McpServerState> = database.servers.iter().map(sanitize_server).collect();
    let enabled_server_count = servers.iter().filter(|server| server.enabled).count();

    McpConnectionState {
        connected: enabled_server_count > 0,
        enabled_server_count,
        max_servers: MCP_MAX_SERVERS,
        servers,
    }
}

fn sanitize_server(server: &McpServerRecord) -> McpServerState {
    McpServerState {
        args: if server.transport == MCP_TRANSPORT_STDIO {
            server.args.clone()
        } else {
            Vec::new()
        },
        command: if server.transport == MCP_TRANSPORT_STDIO {
            server.command.clone()
        } else {
            None
        },
        created_at: server.created_at,
        enabled: server.enabled,
        endpoint: server.endpoint.clone(),
        environment: if server.transport == MCP_TRANSPORT_STDIO {
            server
                .environment
                .iter()
                .map(|item| McpEnvironmentVariableState {
                    has_value: !item.value.trim().is_empty(),
                    name: item.name.clone(),
                })
                .collect()
        } else {
            Vec::new()
        },
        has_authorization_token: server
            .authorization_token
            .as_deref()
            .map(str::trim)
            .filter(|token| !token.is_empty())
            .is_some(),
        id: server.id.clone(),
        last_connected_at: server.last_connected_at,
        last_error: server.last_error.clone(),
        name: server.name.clone(),
        protocol_version: server.protocol_version.clone(),
        server_name: server.server_name.clone(),
        server_version: server.server_version.clone(),
        tools: server.tools.clone(),
        transport: server.transport.clone(),
        updated_at: server.updated_at,
        working_directory: server.working_directory.clone(),
    }
}

fn find_server_record(app: &tauri::AppHandle, id: &str) -> Result<McpServerRecord, String> {
    let database = load_database(app)?;
    database
        .servers
        .into_iter()
        .find(|server| server.id == id)
        .ok_or_else(|| "MCP server was not found.".to_string())
}

fn create_probe_record(request: &McpTestServerRequest) -> Result<McpServerRecord, String> {
    let input = normalize_test_server_input(request)?;

    Ok(McpServerRecord {
        args: input.args,
        authorization_token: input.authorization_token,
        command: input.command,
        created_at: None,
        enabled: true,
        endpoint: input.endpoint,
        environment: input.environment,
        id: "test".to_string(),
        last_connected_at: None,
        last_error: None,
        name: "Test MCP server".to_string(),
        protocol_version: None,
        server_name: None,
        server_version: None,
        tools: Vec::new(),
        transport: input.transport,
        updated_at: None,
        working_directory: input.working_directory,
    })
}

fn update_server_after_probe(
    app: &tauri::AppHandle,
    state: &tauri::State<'_, McpState>,
    server_id: &str,
    probe: &McpProbeResult,
    last_error: Option<String>,
) -> Result<(McpConnectionState, McpServerState), String> {
    let _guard = state
        .lock
        .lock()
        .map_err(|_| "The MCP server store is busy. Try again in a moment.".to_string())?;
    let mut database = load_database(app)?;
    let now = now_millis();
    let server = database
        .servers
        .iter_mut()
        .find(|server| server.id == server_id)
        .ok_or_else(|| "MCP server was not found.".to_string())?;

    server.last_connected_at = Some(now);
    server.last_error = last_error;
    server.protocol_version = probe.protocol_version.clone();
    server.server_name = probe.server_name.clone();
    server.server_version = probe.server_version.clone();
    server.tools = probe.tools.clone();
    server.updated_at = Some(now);

    save_database(app, &database)?;
    let state_response = create_connection_state(&database);
    let server_response = state_response
        .servers
        .iter()
        .find(|server| server.id == server_id)
        .cloned()
        .ok_or_else(|| "MCP server was updated but could not be reloaded.".to_string())?;

    Ok((state_response, server_response))
}

fn update_server_after_error(
    app: &tauri::AppHandle,
    state: &tauri::State<'_, McpState>,
    server_id: &str,
    error: &str,
) -> Result<(McpConnectionState, McpServerState), String> {
    let _guard = state
        .lock
        .lock()
        .map_err(|_| "The MCP server store is busy. Try again in a moment.".to_string())?;
    let mut database = load_database(app)?;
    let now = now_millis();
    let server = database
        .servers
        .iter_mut()
        .find(|server| server.id == server_id)
        .ok_or_else(|| "MCP server was not found.".to_string())?;

    server.last_error = Some(error.to_string());
    server.updated_at = Some(now);

    save_database(app, &database)?;
    let state_response = create_connection_state(&database);
    let server_response = state_response
        .servers
        .iter()
        .find(|server| server.id == server_id)
        .cloned()
        .ok_or_else(|| "MCP server was updated but could not be reloaded.".to_string())?;

    Ok((state_response, server_response))
}

async fn probe_server(record: &McpServerRecord) -> Result<McpProbeResult, String> {
    if is_stdio_transport(record) {
        let record = record.clone();
        return tauri::async_runtime::spawn_blocking(move || probe_stdio_server(&record))
            .await
            .map_err(|error| format!("MCP stdio task failed: {error}"))?;
    }

    let client = mcp_client()?;
    let initialized = initialize_server(&client, record).await?;
    let tools = list_server_tools(&client, record, initialized.session_id.as_deref()).await?;

    Ok(McpProbeResult {
        protocol_version: initialized.protocol_version,
        server_name: initialized.server_name,
        server_version: initialized.server_version,
        tools,
    })
}

async fn initialize_server(
    client: &reqwest::Client,
    record: &McpServerRecord,
) -> Result<McpInitializeResult, String> {
    let response = mcp_rpc_request(
        client,
        record,
        "initialize",
        Some(json!({
            "protocolVersion": MCP_PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": {
                "name": "Gilbert Codex",
                "version": "0.5.0"
            }
        })),
        None,
    )
    .await?;

    let session_id = response.session_id;
    let _ = mcp_rpc_notification(
        client,
        record,
        "notifications/initialized",
        Some(json!({})),
        session_id.as_deref(),
    )
    .await;

    Ok(McpInitializeResult {
        protocol_version: response
            .result
            .get("protocolVersion")
            .and_then(Value::as_str)
            .map(str::to_string),
        server_name: response
            .result
            .pointer("/serverInfo/name")
            .and_then(Value::as_str)
            .map(str::to_string),
        server_version: response
            .result
            .pointer("/serverInfo/version")
            .and_then(Value::as_str)
            .map(str::to_string),
        session_id,
    })
}

async fn list_server_tools(
    client: &reqwest::Client,
    record: &McpServerRecord,
    session_id: Option<&str>,
) -> Result<Vec<McpToolSummary>, String> {
    let mut tools = Vec::new();
    let mut cursor: Option<String> = None;
    let mut next_session_id = session_id.map(str::to_string);

    for _ in 0..MCP_MAX_TOOL_LIST_PAGES {
        let params = cursor
            .as_ref()
            .map(|cursor| json!({ "cursor": cursor }))
            .unwrap_or_else(|| json!({}));
        let response = mcp_rpc_request(
            client,
            record,
            "tools/list",
            Some(params),
            next_session_id.as_deref(),
        )
        .await?;

        if response.session_id.is_some() {
            next_session_id = response.session_id;
        }

        extend_tool_summaries(&mut tools, &response.result);
        tools.truncate(MCP_MAX_TOOLS_PER_SERVER);

        cursor = response
            .result
            .get("nextCursor")
            .and_then(Value::as_str)
            .map(str::to_string);

        if cursor.is_none() || tools.len() >= MCP_MAX_TOOLS_PER_SERVER {
            break;
        }
    }

    Ok(tools)
}

async fn call_server_tool(
    record: &McpServerRecord,
    tool_name: &str,
    arguments: Value,
) -> Result<Value, String> {
    if is_stdio_transport(record) {
        let record = record.clone();
        let tool_name = tool_name.to_string();
        return tauri::async_runtime::spawn_blocking(move || {
            call_stdio_server_tool(&record, &tool_name, arguments)
        })
        .await
        .map_err(|error| format!("MCP stdio task failed: {error}"))?;
    }

    let client = mcp_client()?;
    let initialized = initialize_server(&client, record).await?;
    let response = mcp_rpc_request(
        &client,
        record,
        "tools/call",
        Some(json!({
            "name": tool_name,
            "arguments": arguments,
        })),
        initialized.session_id.as_deref(),
    )
    .await?;

    Ok(response.result)
}

async fn mcp_rpc_request(
    client: &reqwest::Client,
    record: &McpServerRecord,
    method: &str,
    params: Option<Value>,
    session_id: Option<&str>,
) -> Result<McpRpcResponse, String> {
    let request_id = Uuid::new_v4().to_string();
    let body = json!({
        "jsonrpc": "2.0",
        "id": request_id,
        "method": method,
        "params": params.unwrap_or_else(|| json!({})),
    });
    let response = create_rpc_request(client, record, Method::POST, session_id)?
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("MCP request `{method}` failed: {error}"))?;
    let headers = response.headers().clone();
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| format!("Could not read MCP `{method}` response: {error}"))?;

    if !status.is_success() {
        return Err(format!(
            "MCP request `{method}` failed with HTTP {}: {}",
            status.as_u16(),
            summarize_response_text(&text)
        ));
    }

    let result = parse_json_rpc_result(&text, Some(&request_id))
        .map_err(|error| format!("MCP `{method}` returned an invalid response: {error}"))?;
    let session_id = response_header(&headers, "mcp-session-id");

    Ok(McpRpcResponse { result, session_id })
}

async fn mcp_rpc_notification(
    client: &reqwest::Client,
    record: &McpServerRecord,
    method: &str,
    params: Option<Value>,
    session_id: Option<&str>,
) -> Result<(), String> {
    let body = json!({
        "jsonrpc": "2.0",
        "method": method,
        "params": params.unwrap_or_else(|| json!({})),
    });
    let response = create_rpc_request(client, record, Method::POST, session_id)?
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("MCP notification `{method}` failed: {error}"))?;
    let status = response.status();
    let text = response.text().await.unwrap_or_default();

    if status.is_success() {
        return Ok(());
    }

    Err(format!(
        "MCP notification `{method}` failed with HTTP {}: {}",
        status.as_u16(),
        summarize_response_text(&text)
    ))
}

fn create_rpc_request(
    client: &reqwest::Client,
    record: &McpServerRecord,
    method: Method,
    session_id: Option<&str>,
) -> Result<reqwest::RequestBuilder, String> {
    let endpoint = record
        .endpoint
        .as_deref()
        .map(str::trim)
        .filter(|endpoint| !endpoint.is_empty())
        .ok_or_else(|| "This MCP server does not have an HTTP endpoint configured.".to_string())?;
    let mut request = client
        .request(method, endpoint)
        .header(header::ACCEPT, "application/json, text/event-stream")
        .header(header::CONTENT_TYPE, "application/json")
        .header("MCP-Protocol-Version", MCP_PROTOCOL_VERSION)
        .header(header::USER_AGENT, USER_AGENT);

    if let Some(session_id) = session_id.map(str::trim).filter(|value| !value.is_empty()) {
        request = request.header("Mcp-Session-Id", session_id);
    }

    if let Some(token) = record
        .authorization_token
        .as_deref()
        .map(str::trim)
        .filter(|token| !token.is_empty())
    {
        request = request.bearer_auth(token);
    }

    Ok(request)
}

fn probe_stdio_server(record: &McpServerRecord) -> Result<McpProbeResult, String> {
    let mut session = open_stdio_session(record)?;
    let result = (|| {
        let initialized = initialize_stdio_server(&mut session)?;
        let _ = stdio_rpc_notification(&mut session, "notifications/initialized", Some(json!({})));
        let tools = list_stdio_server_tools(&mut session)?;

        Ok(McpProbeResult {
            protocol_version: initialized.protocol_version,
            server_name: initialized.server_name,
            server_version: initialized.server_version,
            tools,
        })
    })();

    shutdown_stdio_session(session);
    result
}

fn call_stdio_server_tool(
    record: &McpServerRecord,
    tool_name: &str,
    arguments: Value,
) -> Result<Value, String> {
    let mut session = open_stdio_session(record)?;
    let result = (|| {
        let _initialized = initialize_stdio_server(&mut session)?;
        let _ = stdio_rpc_notification(&mut session, "notifications/initialized", Some(json!({})));
        stdio_rpc_request(
            &mut session,
            "tools/call",
            Some(json!({
                "name": tool_name,
                "arguments": arguments,
            })),
        )
    })();

    shutdown_stdio_session(session);
    result
}

fn initialize_stdio_server(session: &mut StdioMcpSession) -> Result<McpInitializeResult, String> {
    let result = stdio_rpc_request(
        session,
        "initialize",
        Some(json!({
            "protocolVersion": MCP_PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": {
                "name": "Gilbert Codex",
                "version": "0.5.0"
            }
        })),
    )?;

    Ok(McpInitializeResult {
        protocol_version: result
            .get("protocolVersion")
            .and_then(Value::as_str)
            .map(str::to_string),
        server_name: result
            .pointer("/serverInfo/name")
            .and_then(Value::as_str)
            .map(str::to_string),
        server_version: result
            .pointer("/serverInfo/version")
            .and_then(Value::as_str)
            .map(str::to_string),
        session_id: None,
    })
}

fn list_stdio_server_tools(session: &mut StdioMcpSession) -> Result<Vec<McpToolSummary>, String> {
    let mut tools = Vec::new();
    let mut cursor: Option<String> = None;

    for _ in 0..MCP_MAX_TOOL_LIST_PAGES {
        let params = cursor
            .as_ref()
            .map(|cursor| json!({ "cursor": cursor }))
            .unwrap_or_else(|| json!({}));
        let result = stdio_rpc_request(session, "tools/list", Some(params))?;

        extend_tool_summaries(&mut tools, &result);
        tools.truncate(MCP_MAX_TOOLS_PER_SERVER);

        cursor = result
            .get("nextCursor")
            .and_then(Value::as_str)
            .map(str::to_string);

        if cursor.is_none() || tools.len() >= MCP_MAX_TOOLS_PER_SERVER {
            break;
        }
    }

    Ok(tools)
}

fn open_stdio_session(record: &McpServerRecord) -> Result<StdioMcpSession, String> {
    let command = record
        .command
        .as_deref()
        .map(str::trim)
        .filter(|command| !command.is_empty())
        .ok_or_else(|| "This MCP stdio server does not have a command configured.".to_string())?;
    let mut process = Command::new(command);

    process
        .args(&record.args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Some(working_directory) = record
        .working_directory
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        process.current_dir(working_directory);
    }

    for item in &record.environment {
        let name = item.name.trim();

        if !name.is_empty() {
            process.env(name, &item.value);
        }
    }

    let mut child = process
        .spawn()
        .map_err(|error| format!("Could not start MCP stdio server `{command}`: {error}"))?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Could not open stdin for the MCP stdio server.".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Could not open stdout for the MCP stdio server.".to_string())?;
    let stderr = child.stderr.take();
    let (stdout_tx, stdout_rx) = mpsc::channel();
    let (stderr_tx, stderr_rx) = mpsc::channel();

    thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            match line {
                Ok(line) => {
                    if stdout_tx.send(line).is_err() {
                        break;
                    }
                }
                Err(error) => {
                    let _ = stdout_tx.send(format!("__gilbert_stdio_read_error__:{error}"));
                    break;
                }
            }
        }
    });

    if let Some(stderr) = stderr {
        thread::spawn(move || {
            for line in BufReader::new(stderr).lines() {
                match line {
                    Ok(line) => {
                        if stderr_tx.send(line).is_err() {
                            break;
                        }
                    }
                    Err(error) => {
                        let _ = stderr_tx.send(format!("stderr read error: {error}"));
                        break;
                    }
                }
            }
        });
    }

    Ok(StdioMcpSession {
        child,
        stderr_rx,
        stdin,
        stdout_rx,
    })
}

fn stdio_rpc_request(
    session: &mut StdioMcpSession,
    method: &str,
    params: Option<Value>,
) -> Result<Value, String> {
    let request_id = Uuid::new_v4().to_string();
    let body = json!({
        "jsonrpc": "2.0",
        "id": request_id,
        "method": method,
        "params": params.unwrap_or_else(|| json!({})),
    });

    write_stdio_message(session, &body, method)?;
    wait_for_stdio_response(session, &request_id, method)
}

fn stdio_rpc_notification(
    session: &mut StdioMcpSession,
    method: &str,
    params: Option<Value>,
) -> Result<(), String> {
    let body = json!({
        "jsonrpc": "2.0",
        "method": method,
        "params": params.unwrap_or_else(|| json!({})),
    });

    write_stdio_message(session, &body, method)
}

fn write_stdio_message(
    session: &mut StdioMcpSession,
    body: &Value,
    method: &str,
) -> Result<(), String> {
    let text = serde_json::to_string(body)
        .map_err(|error| format!("Could not serialize MCP stdio `{method}` request: {error}"))?;

    if text.contains('\n') || text.contains('\r') {
        return Err(format!(
            "MCP stdio `{method}` request contained an embedded newline."
        ));
    }

    session
        .stdin
        .write_all(text.as_bytes())
        .and_then(|_| session.stdin.write_all(b"\n"))
        .and_then(|_| session.stdin.flush())
        .map_err(|error| format!("Could not write MCP stdio `{method}` request: {error}"))
}

fn wait_for_stdio_response(
    session: &mut StdioMcpSession,
    request_id: &str,
    method: &str,
) -> Result<Value, String> {
    let deadline = Instant::now() + Duration::from_secs(MCP_STDIO_TIMEOUT_SECS);
    let mut last_non_matching: Option<String> = None;

    loop {
        let now = Instant::now();

        if now >= deadline {
            return Err(format!(
                "MCP stdio request `{method}` timed out waiting for a JSON-RPC response.{}",
                format_stdio_stderr_suffix(session)
            ));
        }

        let remaining = deadline.saturating_duration_since(now);

        match session.stdout_rx.recv_timeout(remaining) {
            Ok(line) => {
                let line = line.trim_end_matches('\r').trim();

                if line.is_empty() {
                    continue;
                }

                if let Some(error) = line.strip_prefix("__gilbert_stdio_read_error__:") {
                    return Err(format!("Could not read MCP stdio stdout: {error}"));
                }

                let value = serde_json::from_str::<Value>(line).map_err(|error| {
                    format!(
                        "MCP stdio server wrote non-JSON-RPC stdout for `{method}`: {error}.{}",
                        format_stdio_stderr_suffix(session)
                    )
                })?;

                if let Some(result) =
                    parse_json_rpc_value(value, Some(request_id), &mut last_non_matching)?
                {
                    return Ok(result);
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                return Err(format!(
                    "MCP stdio request `{method}` timed out waiting for a JSON-RPC response.{}",
                    format_stdio_stderr_suffix(session)
                ));
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                let exit_status = match session.child.try_wait() {
                    Ok(Some(status)) => format!(" Process exited with {status}."),
                    Ok(None) => " Stdout closed while the process was still running.".to_string(),
                    Err(error) => format!(" Could not inspect process status: {error}."),
                };

                return Err(format!(
                    "MCP stdio server closed stdout before responding to `{method}`.{exit_status}{}",
                    format_stdio_stderr_suffix(session)
                ));
            }
        }
    }
}

fn format_stdio_stderr_suffix(session: &StdioMcpSession) -> String {
    let stderr = drain_stdio_stderr(session);

    if stderr.is_empty() {
        String::new()
    } else {
        format!(" Stderr: {}", truncate_chars(&stderr.join("\n"), 900))
    }
}

fn drain_stdio_stderr(session: &StdioMcpSession) -> Vec<String> {
    let mut lines = Vec::new();

    while let Ok(line) = session.stderr_rx.try_recv() {
        if !line.trim().is_empty() {
            lines.push(line);
        }

        if lines.len() >= 12 {
            break;
        }
    }

    lines
}

fn shutdown_stdio_session(mut session: StdioMcpSession) {
    drop(session.stdin);
    let deadline = Instant::now() + Duration::from_millis(MCP_STDIO_SHUTDOWN_TIMEOUT_MS);

    while Instant::now() < deadline {
        match session.child.try_wait() {
            Ok(Some(_)) => return,
            Ok(None) => thread::sleep(Duration::from_millis(40)),
            Err(_) => break,
        }
    }

    let _ = session.child.kill();
    let _ = session.child.wait();
}

fn mcp_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .connect_timeout(Duration::from_secs(MCP_HTTP_CONNECT_TIMEOUT_SECS))
        .timeout(Duration::from_secs(MCP_HTTP_TIMEOUT_SECS))
        .build()
        .map_err(|error| format!("Could not create MCP HTTP client: {error}"))
}

fn parse_json_rpc_result(text: &str, expected_id: Option<&str>) -> Result<Value, String> {
    let payloads = extract_json_payloads(text);

    if payloads.is_empty() {
        return Err("empty response body".to_string());
    }

    let mut last_non_matching: Option<String> = None;

    for payload in payloads {
        let value = serde_json::from_str::<Value>(&payload)
            .map_err(|error| format!("invalid JSON-RPC JSON: {error}"))?;

        if let Some(result) = parse_json_rpc_value(value, expected_id, &mut last_non_matching)? {
            return Ok(result);
        }
    }

    Err(last_non_matching.unwrap_or_else(|| "no JSON-RPC result was returned".to_string()))
}

fn parse_json_rpc_value(
    value: Value,
    expected_id: Option<&str>,
    last_non_matching: &mut Option<String>,
) -> Result<Option<Value>, String> {
    if let Value::Array(items) = value {
        for item in items {
            if let Some(result) = parse_json_rpc_value(item, expected_id, last_non_matching)? {
                return Ok(Some(result));
            }
        }

        return Ok(None);
    }

    let Value::Object(mut object) = value else {
        *last_non_matching = Some("JSON-RPC response was not an object".to_string());
        return Ok(None);
    };

    if let Some(expected_id) = expected_id {
        let id_matches = object
            .get("id")
            .map(|id| json_rpc_id_matches(id, expected_id))
            .unwrap_or(false);

        if !id_matches {
            *last_non_matching =
                Some("JSON-RPC response id did not match the request id".to_string());
            return Ok(None);
        }
    }

    if let Some(error) = object.remove("error") {
        return Err(format_json_rpc_error(&error));
    }

    object
        .remove("result")
        .map(Some)
        .ok_or_else(|| "JSON-RPC response did not contain result".to_string())
}

fn extract_json_payloads(text: &str) -> Vec<String> {
    let trimmed = text.trim();

    if trimmed.starts_with('{') || trimmed.starts_with('[') {
        return vec![trimmed.to_string()];
    }

    let mut payloads = Vec::new();
    let mut event_data = String::new();

    for raw_line in text.lines() {
        let line = raw_line.trim_end_matches('\r');

        if line.is_empty() {
            push_sse_event(&mut payloads, &mut event_data);
            continue;
        }

        if line.starts_with(':') {
            continue;
        }

        if let Some(data) = line.strip_prefix("data:") {
            if !event_data.is_empty() {
                event_data.push('\n');
            }
            event_data.push_str(data.trim_start());
        }
    }

    push_sse_event(&mut payloads, &mut event_data);
    payloads
}

fn push_sse_event(payloads: &mut Vec<String>, event_data: &mut String) {
    let payload = event_data.trim();

    if !payload.is_empty() && payload != "[DONE]" {
        payloads.push(payload.to_string());
    }

    event_data.clear();
}

fn json_rpc_id_matches(value: &Value, expected_id: &str) -> bool {
    value.as_str().map(|id| id == expected_id).unwrap_or(false)
        || value
            .as_i64()
            .map(|id| id.to_string() == expected_id)
            .unwrap_or(false)
        || value
            .as_u64()
            .map(|id| id.to_string() == expected_id)
            .unwrap_or(false)
}

fn format_json_rpc_error(error: &Value) -> String {
    let message = error
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or("MCP server returned a JSON-RPC error");
    let code = error.get("code").and_then(Value::as_i64);

    match code {
        Some(code) => format!("{message} (code {code})"),
        None => message.to_string(),
    }
}

fn extend_tool_summaries(tools: &mut Vec<McpToolSummary>, result: &Value) {
    let Some(items) = result.get("tools").and_then(Value::as_array) else {
        return;
    };

    for item in items {
        if tools.len() >= MCP_MAX_TOOLS_PER_SERVER {
            break;
        }

        let Some(name) = item
            .get("name")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|name| !name.is_empty())
        else {
            continue;
        };

        tools.push(McpToolSummary {
            description: item
                .get("description")
                .and_then(Value::as_str)
                .map(str::to_string),
            input_schema: item.get("inputSchema").cloned(),
            name: name.to_string(),
        });
    }
}

fn format_mcp_tool_result_content(result: &Value) -> String {
    let mut lines = Vec::new();

    if let Some(items) = result.get("content").and_then(Value::as_array) {
        for (index, item) in items.iter().enumerate() {
            let item_type = item
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or("content");

            match item_type {
                "text" => {
                    let text = item.get("text").and_then(Value::as_str).unwrap_or("");
                    lines.push(format!("--- Text content {} ---\n{}", index + 1, text));
                }
                "resource" => {
                    let resource = item.get("resource").unwrap_or(item);
                    let uri = resource
                        .get("uri")
                        .and_then(Value::as_str)
                        .unwrap_or("resource");
                    let mime_type = resource.get("mimeType").and_then(Value::as_str);
                    let text = resource.get("text").and_then(Value::as_str);
                    lines.push(
                        [
                            format!("--- Resource content {} ---", index + 1),
                            format!("URI: {uri}"),
                            mime_type
                                .map(|value| format!("MIME: {value}"))
                                .unwrap_or_default(),
                            text.map(|value| format!("Text:\n{value}"))
                                .unwrap_or_default(),
                        ]
                        .into_iter()
                        .filter(|part| !part.is_empty())
                        .collect::<Vec<_>>()
                        .join("\n"),
                    );
                }
                "image" | "audio" => {
                    let mime_type = item
                        .get("mimeType")
                        .and_then(Value::as_str)
                        .unwrap_or("unknown");
                    lines.push(format!(
                        "--- {} content {} ---\nMIME: {}\nBinary data omitted from visible tool result.",
                        item_type,
                        index + 1,
                        mime_type
                    ));
                }
                _ => {
                    lines.push(format!(
                        "--- {} content {} ---\n{}",
                        item_type,
                        index + 1,
                        serde_json::to_string_pretty(item).unwrap_or_else(|_| item.to_string())
                    ));
                }
            }
        }
    }

    if lines.is_empty() {
        if let Some(structured) = result.get("structuredContent") {
            lines.push(format!(
                "Structured content:\n{}",
                serde_json::to_string_pretty(structured).unwrap_or_else(|_| structured.to_string())
            ));
        } else {
            lines.push(serde_json::to_string_pretty(result).unwrap_or_else(|_| result.to_string()));
        }
    }

    truncate_chars(&lines.join("\n\n"), MCP_MAX_RESULT_CHARS)
}

fn normalize_server_input(
    request: &McpSaveServerRequest,
) -> Result<NormalizedMcpServerInput, String> {
    normalize_server_config(
        request.transport.as_deref(),
        request.endpoint.as_deref(),
        request.authorization_token.as_deref(),
        request.command.as_deref(),
        request.args.as_ref(),
        request.environment.as_ref(),
        request.working_directory.as_deref(),
    )
}

fn normalize_test_server_input(
    request: &McpTestServerRequest,
) -> Result<NormalizedMcpServerInput, String> {
    normalize_server_config(
        request.transport.as_deref(),
        request.endpoint.as_deref(),
        request.authorization_token.as_deref(),
        request.command.as_deref(),
        request.args.as_ref(),
        request.environment.as_ref(),
        request.working_directory.as_deref(),
    )
}

fn normalize_server_config(
    transport: Option<&str>,
    endpoint: Option<&str>,
    authorization_token: Option<&str>,
    command: Option<&str>,
    args: Option<&Vec<String>>,
    environment: Option<&Vec<McpEnvironmentVariable>>,
    working_directory: Option<&str>,
) -> Result<NormalizedMcpServerInput, String> {
    let transport = normalize_transport(transport, endpoint, command)?;

    if transport == MCP_TRANSPORT_STDIO {
        return Ok(NormalizedMcpServerInput {
            args: normalize_stdio_args(args)?,
            authorization_token: None,
            command: Some(normalize_stdio_command(command)?),
            endpoint: None,
            environment: normalize_stdio_environment(environment)?,
            transport,
            working_directory: normalize_working_directory(working_directory)?,
        });
    }

    let endpoint = normalize_mcp_endpoint(
        endpoint.ok_or_else(|| "Enter an MCP endpoint before testing.".to_string())?,
    )?;

    Ok(NormalizedMcpServerInput {
        args: Vec::new(),
        authorization_token: normalize_optional_secret(authorization_token),
        command: None,
        endpoint: Some(endpoint),
        environment: Vec::new(),
        transport,
        working_directory: None,
    })
}

fn normalize_transport(
    value: Option<&str>,
    endpoint: Option<&str>,
    command: Option<&str>,
) -> Result<String, String> {
    let inferred = if command
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_some()
        && endpoint
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .is_none()
    {
        MCP_TRANSPORT_STDIO
    } else {
        MCP_TRANSPORT_HTTP
    };
    let normalized = value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(inferred)
        .to_ascii_lowercase()
        .replace(['_', '-'], "");

    match normalized.as_str() {
        "http" | "streamablehttp" => Ok(MCP_TRANSPORT_HTTP.to_string()),
        "stdio" => Ok(MCP_TRANSPORT_STDIO.to_string()),
        _ => Err("MCP transport must be either Streamable HTTP or stdio.".to_string()),
    }
}

fn normalize_existing_transport(server: &McpServerRecord) -> String {
    normalize_transport(
        Some(&server.transport),
        server.endpoint.as_deref(),
        server.command.as_deref(),
    )
    .unwrap_or_else(|_| {
        if server
            .command
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .is_some()
        {
            MCP_TRANSPORT_STDIO.to_string()
        } else {
            MCP_TRANSPORT_HTTP.to_string()
        }
    })
}

fn normalized_server_target_hint(input: &NormalizedMcpServerInput) -> String {
    if input.transport == MCP_TRANSPORT_STDIO {
        input.command.clone().unwrap_or_else(|| "stdio".to_string())
    } else {
        input.endpoint.clone().unwrap_or_else(|| "mcp".to_string())
    }
}

fn server_record_target_hint(server: &McpServerRecord) -> String {
    if server.transport == MCP_TRANSPORT_STDIO {
        server
            .command
            .clone()
            .unwrap_or_else(|| "stdio".to_string())
    } else {
        server.endpoint.clone().unwrap_or_else(|| "mcp".to_string())
    }
}

fn has_valid_record_target(server: &McpServerRecord) -> bool {
    if server.transport == MCP_TRANSPORT_STDIO {
        return server
            .command
            .as_deref()
            .map(str::trim)
            .filter(|command| !command.is_empty())
            .is_some();
    }

    server
        .endpoint
        .as_deref()
        .map(str::trim)
        .filter(|endpoint| !endpoint.is_empty())
        .is_some()
}

fn is_stdio_transport(record: &McpServerRecord) -> bool {
    record.transport == MCP_TRANSPORT_STDIO
}

fn normalize_stdio_command(value: Option<&str>) -> Result<String, String> {
    let command = value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Enter a command for this MCP stdio server.".to_string())?;

    if command.contains('\0') || command.chars().count() > 512 {
        return Err("MCP stdio command is invalid or too long.".to_string());
    }

    Ok(command.to_string())
}

fn normalize_optional_stdio_command(value: Option<&str>) -> Option<String> {
    normalize_stdio_command(value).ok()
}

fn normalize_stdio_args(value: Option<&Vec<String>>) -> Result<Vec<String>, String> {
    let Some(args) = value else {
        return Ok(Vec::new());
    };

    if args.len() > MCP_MAX_STDIO_ARGS {
        return Err(format!(
            "MCP stdio servers can have at most {MCP_MAX_STDIO_ARGS} arguments."
        ));
    }

    let mut normalized = Vec::new();

    for arg in args {
        let arg = arg.trim();

        if arg.is_empty() {
            continue;
        }

        if arg.contains('\0')
            || arg.contains('\n')
            || arg.contains('\r')
            || arg.chars().count() > 2_048
        {
            return Err("One MCP stdio argument is invalid or too long.".to_string());
        }

        normalized.push(arg.to_string());
    }

    Ok(normalized)
}

fn normalize_existing_stdio_args(value: &[String]) -> Vec<String> {
    normalize_stdio_args(Some(&value.to_vec())).unwrap_or_default()
}

fn normalize_stdio_environment(
    value: Option<&Vec<McpEnvironmentVariable>>,
) -> Result<Vec<McpEnvironmentVariable>, String> {
    let Some(items) = value else {
        return Ok(Vec::new());
    };

    if items.len() > MCP_MAX_STDIO_ENV {
        return Err(format!(
            "MCP stdio servers can have at most {MCP_MAX_STDIO_ENV} environment variables."
        ));
    }

    let mut normalized = Vec::new();

    for item in items {
        let name = item.name.trim();

        if name.is_empty() {
            continue;
        }

        if name.contains('=') || name.contains('\0') || name.chars().count() > 128 {
            return Err("One MCP stdio environment variable name is invalid.".to_string());
        }

        if item.value.contains('\0') || item.value.chars().count() > 16_000 {
            return Err(format!(
                "Environment variable `{name}` is invalid or too long."
            ));
        }

        normalized.push(McpEnvironmentVariable {
            name: name.to_string(),
            value: item.value.trim().to_string(),
        });
    }

    normalized.truncate(MCP_MAX_STDIO_ENV);
    Ok(normalized)
}

fn normalize_existing_stdio_environment(
    value: &[McpEnvironmentVariable],
) -> Vec<McpEnvironmentVariable> {
    normalize_stdio_environment(Some(&value.to_vec())).unwrap_or_default()
}

fn merge_stdio_environment(
    next: Vec<McpEnvironmentVariable>,
    existing: &[McpEnvironmentVariable],
) -> Vec<McpEnvironmentVariable> {
    next.into_iter()
        .map(|item| {
            if !item.value.is_empty() {
                return item;
            }

            existing
                .iter()
                .find(|old| old.name.eq_ignore_ascii_case(&item.name))
                .cloned()
                .unwrap_or(item)
        })
        .collect()
}

fn normalize_working_directory(value: Option<&str>) -> Result<Option<String>, String> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };

    if value.contains('\0') || value.chars().count() > 1_024 {
        return Err("MCP stdio working directory is invalid or too long.".to_string());
    }

    Ok(Some(value.to_string()))
}

fn normalize_optional_working_directory(value: Option<&str>) -> Option<String> {
    normalize_working_directory(value).ok().flatten()
}

fn normalize_server_name(value: &str) -> Result<String, String> {
    let name = value.trim();

    if name.is_empty() {
        return Err("Enter a name for this MCP server.".to_string());
    }

    if name.chars().count() > 80 {
        return Err("MCP server names must be 80 characters or shorter.".to_string());
    }

    Ok(name.to_string())
}

fn normalize_mcp_endpoint(value: &str) -> Result<String, String> {
    let trimmed = value.trim();

    if trimmed.is_empty() {
        return Err("Enter an MCP endpoint URL.".to_string());
    }

    let url =
        Url::parse(trimmed).map_err(|error| format!("MCP endpoint is not a valid URL: {error}"))?;
    let scheme = url.scheme();

    if scheme != "https" && scheme != "http" {
        return Err(
            "MCP endpoints must use https://, or http:// for localhost development.".to_string(),
        );
    }

    if !url.username().is_empty() || url.password().is_some() {
        return Err("Put MCP credentials in the bearer token field, not in the URL.".to_string());
    }

    if url.fragment().is_some() {
        return Err("MCP endpoint URLs cannot include fragments.".to_string());
    }

    let host = url
        .host_str()
        .ok_or_else(|| "MCP endpoint URL must include a host.".to_string())?;

    if scheme == "http" && !is_loopback_host(host) {
        return Err("Plain HTTP MCP endpoints are only allowed for localhost or loopback development servers.".to_string());
    }

    Ok(url.to_string())
}

fn is_loopback_host(host: &str) -> bool {
    let normalized = host.trim_matches(['[', ']']).to_ascii_lowercase();

    normalized == "localhost"
        || normalized.ends_with(".localhost")
        || normalized == "127.0.0.1"
        || normalized == "::1"
}

fn normalize_tool_name(value: &str) -> Result<String, String> {
    let name = value.trim();

    if name.is_empty() {
        return Err("MCP tool name is required.".to_string());
    }

    Ok(name.to_string())
}

fn normalize_tool_arguments(arguments: Option<Value>) -> Result<Value, String> {
    let arguments = arguments.unwrap_or_else(|| Value::Object(Map::new()));

    if !arguments.is_object() {
        return Err("MCP tool arguments must be a JSON object.".to_string());
    }

    let size = serde_json::to_vec(&arguments)
        .map_err(|error| format!("Could not serialize MCP tool arguments: {error}"))?
        .len();

    if size > MCP_MAX_ARGUMENT_BYTES {
        return Err("MCP tool arguments are too large for one call.".to_string());
    }

    Ok(arguments)
}

fn normalize_id(value: &str, label: &str) -> Result<String, String> {
    normalize_optional_id(value).ok_or_else(|| format!("{label} is required."))
}

fn normalize_optional_id(value: &str) -> Option<String> {
    let normalized = value
        .trim()
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
        .take(96)
        .collect::<String>();

    if normalized.is_empty() {
        None
    } else {
        Some(normalized)
    }
}

fn normalize_optional_secret(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn create_server_id(name: &str, endpoint: &str) -> String {
    let mut slug = name
        .to_ascii_lowercase()
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character
            } else {
                '-'
            }
        })
        .collect::<String>();

    while slug.contains("--") {
        slug = slug.replace("--", "-");
    }

    slug = slug.trim_matches('-').chars().take(36).collect();

    if slug.is_empty() {
        slug = "mcp-server".to_string();
    }

    let suffix = Uuid::new_v4()
        .to_string()
        .chars()
        .take(8)
        .collect::<String>();
    let endpoint_hint = endpoint
        .split('/')
        .filter(|part| !part.is_empty())
        .next_back()
        .unwrap_or("mcp")
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .take(8)
        .collect::<String>();

    if endpoint_hint.is_empty() {
        format!("{slug}-{suffix}")
    } else {
        format!("{slug}-{endpoint_hint}-{suffix}")
    }
}

fn response_header(headers: &header::HeaderMap, name: &str) -> Option<String> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn summarize_response_text(text: &str) -> String {
    let trimmed = text.trim();

    if trimmed.is_empty() {
        return "(empty response)".to_string();
    }

    truncate_chars(trimmed, 900)
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_string();
    }

    let mut truncated = value.chars().take(max_chars).collect::<String>();
    truncated.push_str("\n[truncated]");
    truncated
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

fn delete_mcp_server_secrets(
    app: &tauri::AppHandle,
    server_id: &str,
    server: Option<&McpServerRecord>,
) {
    let Ok(namespace) = auth::current_user_storage_namespace(app) else {
        return;
    };
    delete_mcp_secret_field(
        &namespace,
        &format!("servers.{server_id}.authorizationToken"),
    );

    if let Some(server) = server {
        for item in &server.environment {
            delete_mcp_secret_field(
                &namespace,
                &format!("servers.{server_id}.environment.{}", item.name),
            );
        }
    }
}

fn delete_mcp_secret_field(namespace: &str, field: &str) {
    let target = secret_target(namespace, MCP_DATABASE_STORAGE_KEY, field);
    let _ = secure_storage::delete_secret(&target);
}

fn secret_target(namespace: &str, storage_key: &str, field: &str) -> String {
    format!(
        "GilbertCodex/{}/{}/{}",
        sanitize_secret_component(namespace),
        sanitize_secret_component(storage_key),
        sanitize_secret_component(field)
    )
}

fn sanitize_secret_component(value: &str) -> String {
    let mut sanitized = String::new();

    for character in value.chars() {
        if sanitized.len() >= 96 {
            break;
        }

        if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.') {
            sanitized.push(character);
        } else {
            sanitized.push('-');
        }
    }

    if sanitized.is_empty() {
        "value".to_string()
    } else {
        sanitized
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{env, fs, path::PathBuf};

    fn node_available() -> bool {
        Command::new("node").arg("--version").output().is_ok()
    }

    fn write_echo_stdio_server() -> PathBuf {
        let path = env::temp_dir().join(format!("gilbert-mcp-echo-{}.js", Uuid::new_v4()));
        let script = r#"
const readline = require("readline");
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
function send(payload) {
  process.stdout.write(JSON.stringify(payload) + "\n");
}
rl.on("line", (line) => {
  if (!line.trim()) return;
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: "2025-03-26",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "Local Echo MCP", version: "test" }
      }
    });
    return;
  }
  if (message.method === "notifications/initialized") {
    return;
  }
  if (message.method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        tools: [{
          name: "echo",
          description: "Echo a message back to the caller.",
          inputSchema: {
            type: "object",
            properties: { message: { type: "string" } },
            required: ["message"]
          }
        }]
      }
    });
    return;
  }
  if (message.method === "tools/call") {
    const text = message.params && message.params.arguments ? message.params.arguments.message : "";
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        content: [{ type: "text", text: `hello ${text}` }],
        structuredContent: { message: text },
        isError: false
      }
    });
    return;
  }
  send({
    jsonrpc: "2.0",
    id: message.id,
    error: { code: -32601, message: "Method not found" }
  });
});
"#;

        fs::write(&path, script).expect("write echo MCP server");
        path
    }

    fn echo_stdio_record(script_path: &PathBuf) -> McpServerRecord {
        McpServerRecord {
            args: vec![script_path.to_string_lossy().to_string()],
            command: Some("node".to_string()),
            enabled: true,
            id: "local-echo".to_string(),
            name: "Local Echo".to_string(),
            transport: MCP_TRANSPORT_STDIO.to_string(),
            ..Default::default()
        }
    }

    #[test]
    fn stdio_probe_lists_echo_tool() {
        if !node_available() {
            eprintln!("Skipping stdio MCP test because node is not available.");
            return;
        }

        let script_path = write_echo_stdio_server();
        let record = echo_stdio_record(&script_path);
        let probe = probe_stdio_server(&record).expect("probe echo stdio server");

        assert_eq!(probe.server_name.as_deref(), Some("Local Echo MCP"));
        assert_eq!(probe.tools.len(), 1);
        assert_eq!(probe.tools[0].name, "echo");

        let _ = fs::remove_file(script_path);
    }

    #[test]
    fn stdio_call_invokes_echo_tool() {
        if !node_available() {
            eprintln!("Skipping stdio MCP test because node is not available.");
            return;
        }

        let script_path = write_echo_stdio_server();
        let record = echo_stdio_record(&script_path);
        let result = call_stdio_server_tool(&record, "echo", json!({ "message": "from Gilbert" }))
            .expect("call echo stdio tool");
        let content = format_mcp_tool_result_content(&result);

        assert!(content.contains("hello from Gilbert"));
        assert_eq!(
            result
                .pointer("/structuredContent/message")
                .and_then(Value::as_str),
            Some("from Gilbert")
        );

        let _ = fs::remove_file(script_path);
    }
}
