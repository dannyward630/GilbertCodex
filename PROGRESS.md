# Gilbert Codex Progress

This file tracks the current product state for collaborators. It should describe what is live now, not the retired local-action runtime.

## Current Phase: Tool Runtime Reset

Status: the broken model-callable tool runtime has been removed so the next implementation can start from a clean contract. Web search remains host-managed and is the only retained chat-side action path.

Delivered:

- Tauri 2 desktop shell with custom window chrome and local app metadata.
- React chat workspace with project grouping, searchable history, pinned chats, attachments, planning mode, thinking controls, and local persistence.
- Multi-provider model routing for OpenRouter, OpenAI, Anthropic, Google Gemini, xAI, LM Studio, Ollama, Groq, Mistral, and DeepSeek.
- Host-managed DuckDuckGo/Brave web search with source cards and a 6-source cap.
- Settings for appearance, provider configuration, GitHub account connection, Discord bridge setup, model, generation, thinking, and web search.
- Discord slash-command bridge setup and runtime for forwarding requests into Gilbert chat.
- SQL-backed local database for desktop auth, chats, settings, integrations, browser preview state, and agent-run records.
- Local workspace context attachment for orientation only; model-callable local read/write/terminal/Git/browser/weather/MCP/workflow actions are disabled.
- Documentation and UI copy updated to describe the reset state.

Removed in the reset:

- The legacy local-action executor tree, including local computer, file creation, Git, GitHub, weather, color, browser, workflow, and web executors.
- Self-healing tool metadata and runtime adaptation paths.
- MCP and external workflow bridge client/types/commands.
- Toolbox, MCP, and Workflows pages.
- Tool-specific prompt chunks, docs, and tests.
- Provider-native tool request wiring.

## Next Hardening Work

- Design the next local action runtime from one schema-driven contract.
- Add provider compatibility tests before exposing any model-callable action again.
- Keep destructive local or remote actions behind explicit review.
- Preserve web search as host-managed context with citations.
- Add unit tests around provider request creation, storage normalization, prompt guardrails, web-search context, and chat utilities.
- Continue GitHub/source-control UI polish as app integrations, not model-callable tools.
- Finish macOS and Linux native verification, packaging, and platform-specific fixes.

## Open Questions

- Which local actions should return first after the reset.
- Whether the next runtime should use provider-native calls, app-owned execution plans, or both.
- Which permissions belong in the first public contributor build.
- Which license should remain final if MIT is not the long-term project choice.
