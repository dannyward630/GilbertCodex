# Gilbert Codex Progress

This file tracks the product state so collaborators can see what has actually been built, what is still prototype-grade, and where the next work should land.

## Current Phase: Local Capability Foundation

Status: active and ready for focused collaboration.

Delivered:

- Tauri 2 desktop shell with custom window chrome and local app metadata.
- React app structure split into app, pages, components, services, tools, styles, lib, and types.
- Local account creation and sign-in with namespaced app state.
- Chat-first workspace with project grouping, searchable history, pinned chats, and local persistence.
- OpenRouter provider path with streaming completions, connection validation, model selection, temperature, max-token controls, thinking controls, and context usage estimates.
- Planning mode with bounded planning passes and user-input checkpoints.
- Markdown assistant rendering with GitHub-flavored markdown support.
- File and image attachment flow with local previews, attachment status, and image-capable model routing.
- Web search path backed by DuckDuckGo context and source cards.
- Local computer workspace context with folder selection, browser folder fallback, file indexing, file search, read, and write helpers.
- Terminal panel for desktop PowerShell or cmd sessions.
- Toolbox feature toggles for provider, planning, thinking, web search, local computer, terminal, browser preview, and future tools.
- Confirmation dialogs for destructive chat deletion and settings reset flows.
- Right-side activity rail for reasoning, tool calls, sources, and thinking-state visibility.
- Browser preview panel with local URL detection, resize controls, expanded mode, and keyboard resizing.
- Settings page for appearance, OpenRouter, model, generation, thinking, and web-search controls.
- Rust host commands for auth, app info, computer files, terminal, and web search.
- Repository hygiene for generated outputs, logs, local secrets, local databases, dependency folders, and build output.

## UI Completed So Far

- Application shell with sidebar, header, top bar, custom window controls, and terminal dock.
- Primary navigation for Chat, Workflows, Toolbox, and Settings.
- Chat thread layout with assistant and user message treatments.
- Composer with attachments, voice-control placeholder state, thinking toggles, planning mode, review mode, model picker, web search, local workspace controls, and send affordance.
- Conversation header with pinning, inspector, terminal, and browser-preview controls.
- Search dialog for chats and project navigation.
- Project, inspector, activity, browser preview, and terminal panels.
- Settings cards for appearance, OpenRouter, model, generation, thinking, and web search.
- App, notice, confirm, and text-input dialogs.
- Empty, loading, streaming, success, warning, disabled, and unavailable states across the main flows.

## Next Hardening Work

- Move provider secrets from browser local storage to OS-backed secure storage.
- Add unit tests around chat utilities, storage normalization, provider request creation, attachment handling, and tool-call parsing.
- Add review cards for file edits, terminal commands, source-control operations, and destructive actions.
- Add durable job state for long-running agent tasks.
- Improve ignored-folder handling in local workspace indexing.
- Add model/provider profiles for local, OpenRouter, and future backends.
- Add exportable conversation and task summaries.
- Prepare the first packaged desktop release with installer artifacts and release notes.

## Open Questions

- Which license should remain final if MIT is not the long-term project choice.
- Whether OpenRouter remains the default provider once local-model support arrives.
- Which tool permissions should be available in the first public contributor build.
- How much of the native command layer should ship before external issues are invited.
