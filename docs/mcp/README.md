# MCP Support

Gilbert Codex supports Model Context Protocol servers through the Apps page.

The desktop app currently supports both standard MCP transports:

- `https://...` remote endpoints
- `http://localhost`, `http://127.0.0.1`, and `http://[::1]` development endpoints
- optional bearer-token authentication stored through the app's OS-backed secure storage
- command-line stdio servers launched as subprocesses
- stdio command arguments, working directories, and environment variables

Configured servers are saved per local Gilbert user. Bearer tokens and stdio environment values are not returned to the React UI or chat tools; the UI only sees whether a secret exists.

## Stdio Servers

Many MCP servers are installed as command-line tools. Add these from Apps > MCP with transport set to `Stdio`:

- `Command`: executable to launch, such as `node`, `python`, `uvx`, or `npx`
- `Arguments`: one argument per line, such as the server script path or package command args
- `Working directory`: optional folder used as the subprocess current directory
- `Environment`: `NAME=value` lines, with values protected through secure storage

The desktop backend starts a fresh subprocess for each list or call operation, initializes MCP over stdin/stdout, sends `notifications/initialized`, then performs `tools/list` or `tools/call`. Stderr is captured only for diagnostics, because MCP stdio servers must write only JSON-RPC messages to stdout.

## Chat Tools

When MCP is enabled in tool settings and the request asks for MCP or external connected tools, the runtime can attach:

- `mcp_list_servers` to inspect configured servers and cached tool names
- `mcp_list_tools` to initialize one server and refresh its `tools/list` schema
- `mcp_call_tool` to call one server tool with JSON object arguments

`mcp_call_tool` uses the same app-owned permission path as other external actions. The model should list servers and tools before calling a tool unless the exact server id, tool name, and input schema are already known.

## Protocol Notes

The implementation follows MCP JSON-RPC flows for Streamable HTTP and stdio:

- Streamable HTTP posts JSON-RPC requests to the configured endpoint.
- HTTP sends `MCP-Protocol-Version: 2025-03-26`, accepts `application/json` and `text/event-stream`, and preserves `Mcp-Session-Id` from server responses when present.
- Stdio launches the server as a subprocess, writes one JSON-RPC message per newline to stdin, and reads newline-delimited JSON-RPC responses from stdout.
- Both transports initialize the server, send `notifications/initialized`, then use `tools/list` or `tools/call`.

References:

- [OpenAI MCP tool docs](https://developers.openai.com/api/docs/mcp)
- [MCP transports specification](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)
- [MCP tools specification](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)
