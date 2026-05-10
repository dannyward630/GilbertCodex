# Gilbert Codex Progress

This file tracks the product state so collaborators can see what has actually been built, what is still prototype-grade, and where the next work should land.

## Current Phase: First Public Alpha

Status: public alpha release packaged and ready for focused collaboration.

Delivered:

- Tauri 2 desktop shell with custom window chrome and local app metadata.
- React app structure split into app, pages, components, services, tools, styles, lib, and types.
- Local account creation and sign-in with namespaced app state.
- Chat-first workspace with project grouping, searchable history, pinned chats, and local persistence.
- Multi-provider model routing for OpenRouter, OpenAI, Anthropic, Google Gemini, xAI, LM Studio, Ollama, Groq, Mistral, and DeepSeek with current default model IDs, streaming, thinking controls, and live catalogs where available.
- Planning mode with bounded planning passes and user-input checkpoints.
- Markdown assistant rendering with GitHub-flavored markdown support.
- File and image attachment flow with local previews, attachment status, and image-capable model routing.
- Web search path backed by DuckDuckGo context and source cards.
- GitHub source-control path with Settings browser login, repository listing, branch/tree/file reads, code search, branch creation, API-backed commits, and draft pull requests without local Git.
- Discord slash-command bridge setup and runtime with chat-mode selection, Discord application fields, signed interaction receiver, ngrok-backed public URL discovery, incoming channel webhook storage, GitHub-to-Discord event options, generated GitHub payload URL, and setup checklist copying.
- Local computer workspace context with folder selection, browser folder fallback, file indexing, file search, read, and write helpers.
- Typed file creation tools for TXT, Markdown, code, React, HTML, PDF, notes, duplicate-safe writes, delete-file safety, and multi-file batches.
- Coding tool pack for chat PDF generation, inline edits, vectors, tests, TypeScript checks, SQL files, React Native screens, unit tests, API routes, dependency reports, and codebase health scans.
- Terminal panel for desktop PowerShell or cmd sessions.
- Toolbox feature toggles for provider, planning, thinking, web search, GitHub source control, local computer, terminal, browser preview, and future tools.
- Confirmation dialogs for destructive chat deletion and settings reset flows.
- Right-side activity rail for reasoning, tool calls, sources, and thinking-state visibility.
- Browser preview panel with local URL detection, resize controls, expanded mode, and keyboard resizing.
- Settings page for appearance, provider configuration, GitHub account connection, Discord bridge setup, model, generation, thinking, and web-search controls.
- Tauri security hardening with a configured CSP and least-privilege notification permissions.
- Rust host commands for auth, app info, computer files, Discord interactions, GitHub API operations, terminal, and web search.
- Repository hygiene for generated outputs, logs, local secrets, local databases, dependency folders, and build output.
- First public Windows x64 alpha packaged with a Tauri NSIS installer, GitHub release notes, and SHA-256 checksum details.

## UI Completed So Far

- Application shell with sidebar, header, top bar, custom window controls, and terminal dock.
- Primary navigation for Chat, Workflows, Toolbox, and Settings.
- Chat thread layout with assistant and user message treatments.
- Composer with attachments, voice-control placeholder state, thinking toggles, planning mode, review mode, model picker, web search, local workspace controls, and send affordance.
- Conversation header with pinning, inspector, terminal, and browser-preview controls.
- Search dialog for chats and project navigation.
- Project, inspector, activity, browser preview, and terminal panels.
- Settings cards for appearance, provider configuration, GitHub browser login and account connection, model, generation, thinking, and web search.
- App, notice, confirm, and text-input dialogs.
- Empty, loading, streaming, success, warning, disabled, and unavailable states across the main flows.

## Next Hardening Work

- Move provider secrets and stored GitHub access tokens to OS-backed secure storage.
- Add unit tests around chat utilities, storage normalization, provider request creation, attachment handling, and tool-call parsing.
- Add provider-contract tests for reasoning payloads, model fallback normalization, and live catalog merging.
- Expand review cards for source-control operations with richer diffs before remote commits.
- Add durable job state for long-running agent tasks.
- Add the Discord bot-gateway runtime for DM, mention, and approved message-content flows.
- Improve ignored-folder handling in local workspace indexing.
- Add model/provider profiles for local, OpenRouter, and future backends.
- Add exportable conversation and task summaries.
- Add code signing, automatic updates, and multi-platform release artifacts.

## Open Questions

- Which license should remain final if MIT is not the long-term project choice.
- Whether OpenRouter remains the default provider once local-model support arrives.
- Which tool permissions should be available in the first public contributor build.
- Which native command-layer features should be promoted from alpha to stable first.
