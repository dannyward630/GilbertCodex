# Gilbert Codex Progress

This file tracks the product state so collaborators can see what has actually been built, what is still prototype-grade, and where the next work should land.

## Phase 1: Desktop Workspace Foundation

Status: complete for the first public backup.

Delivered:

- Tauri 2 desktop shell with custom window chrome and local app metadata.
- React app structure split into app, pages, components, services, styles, lib, and types.
- Chat-first workspace with project grouping, searchable history, pinned chats, and local persistence.
- OpenRouter provider path with streaming chat completions, connection validation, model selection, temperature, max-token controls, and thinking controls.
- Markdown assistant rendering with GitHub-flavored markdown support.
- File and image attachment flow with local previews, attachment status, and image-capable model routing.
- Confirmation dialogs for destructive chat deletion and settings reset flows.
- Right-side activity rail for reasoning and thinking-state visibility.
- Browser preview panel with local URL detection, resize controls, expanded mode, and keyboard resizing.
- Settings page for appearance, provider key, model, generation, and reasoning controls.
- Responsive styling pass across the shell, sidebar, chat surface, composer, settings, dialogs, and utility pages.
- Rust host scaffolding for commands, providers, jobs, storage, and agent-session concepts.
- Repository hygiene for generated outputs, logs, local secrets, and dependency folders.

## UI Completed So Far

- Application shell with sidebar, header, top bar, and custom window controls.
- Primary navigation for Chat, Workflows, Toolbox, and Settings.
- Chat thread layout with assistant/user message treatments.
- Composer with attachments, voice-control placeholder state, thinking toggles, review mode, model picker, and send affordance.
- Conversation header with pinning, inspector, and browser-preview controls.
- Search dialog for chats and project navigation.
- Project and inspector panels.
- Settings cards for appearance, OpenRouter, model, generation, and thinking.
- App, notice, confirm, and text-input dialogs.
- Empty, loading, streaming, success, warning, and disabled states across the main flows.

## Phase 2: Native Capability Layer

Planned:

- Move provider secrets from browser local storage to OS-backed secure storage.
- Add Rust-backed file workspace indexing with explicit user approval boundaries.
- Add terminal and Git tool surfaces with confirmation cards for risky operations.
- Introduce a typed tool registry shared between the UI and the Tauri command layer.
- Add durable job state for long-running agent tasks.
- Add structured event streaming from Rust to React for command progress.
- Add unit tests around chat utilities, storage normalization, provider request creation, and attachment handling.

## Phase 3: Collaboration-Ready Agent Workflows

Planned:

- Review cards for diffs, file edits, command execution, and destructive actions.
- Workspace task plans that survive app restarts.
- Model/provider profiles for local, OpenRouter, and future backends.
- Better project import flow with explicit ignored-folder handling.
- Exportable conversation and task summaries.
- First packaged desktop release with installer artifacts and release notes.

## Open Questions

- Which license should remain final if MIT is not the long-term project choice.
- Whether OpenRouter remains the default provider once local-model support arrives.
- Which tool permissions should be available in the first public contributor build.
- How much of the phase-two native command layer should ship before external issues are invited.
