---
name: local-computer-tools
description: Use when local filesystem, code search, code viewing, editing, file creation, terminal commands, tests, browser preview, or workspace tools are enabled.
---

# Local Computer Tools

Use local tools when they materially improve correctness:
- Search before guessing file names or architecture.
- Read code before editing.
- Treat workspace context, project memory, and index snippets as leads, not proof. Confirm current state with list_directory, search_files, read_file, or view_code before making local changes.
- Batch independent reads, searches, code views, web lookups, and GitHub inventory calls in one tool pass when you already know they are needed.
- Use focused edits for small changes.
- Use `write_file` for new files. For existing files, use `edit_file`/`inline_edit`; `write_file` can replace an existing file only when intentionally doing a whole-file replacement with `replace_entire_file=true` and `expected_sha256` from a fresh read.
- JSX/TSX `<` and `>` characters are normal source content. If fallback tool-call markup has trouble carrying them, retry with a narrow line-range edit, exact `old_str/new_str`, or CDATA-wrapped arg values instead of force-overwriting the file.
- Use rename_path or move_path for file and folder name/location changes instead of shell rename commands when structured tools are available.
- Treat edit_file misses as recoverable evidence. Unique multi-line whitespace-only drift is handled by the tool; if an edit still returns skipped/error, inspect the current lines and adapt the next precise edit instead of stopping or rewriting the full file.
- Do not mutate the same file more than once in a single tool pass. If an edit fails or verification reveals a bug, read the current file and make a narrow follow-up edit in the next pass.
- After source edits, treat automatic syntax/build check output as blocking evidence; fix exact reported file/line errors before finalizing.
- After creating or changing files, re-read the changed files or list the created folder before finalizing.
- Use terminal commands for tests, builds, setup checks, and command evidence.
- Use create_tool for reusable helpers that materially improve the task. It can write Python, TypeScript, JavaScript/Node, PowerShell, cmd, Bash, Zsh, or sh tools under `.gilbert/tools`; run_tool executes them later by `tool_name`.
- Prefer `args_json` with run_tool for structured inputs so custom Python/Node/TypeScript tools can parse one JSON argument.
- For Node/React/npm projects, inspect `package.json` and nearby README/config before deciding how to run the project; prefer existing `npm run` scripts with `cwd` set to the package root.
- For new Vite React projects, use create_vite_project, then verify with `npm install`, `npm run build`, and `npm run dev` from the returned project folder.
- If the user already selected/opened a fresh target project folder, omit `project_path` for create_vite_project so the scaffold lands directly in that folder. Use `project_path` only when intentionally creating a child or different folder.
- If the selected target project folder exists but is empty, scaffold into it. Do not inspect the parent folder or retry with a path outside the workspace.
- `create_vite_project` is not a normal edit tool for existing apps. When `package.json` already exists, use precise `edit_file`/`inline_edit`; use `repair_missing=true` only to fill missing starter files while preserving existing files.
- For a simple Hello World/starter Vite React request, finalize after scaffold, install, build, and dev-server startup succeed. Do not keep editing for visual polish unless the user asked for design work.
- Use structured `git_*` tools for local version control before falling back to raw terminal Git commands. For a brand-new local project, use `git_init` before status, staging, commits, or pushes.
- Use browser preview when visual verification matters.

Tool calls should be compact and purposeful. After tool results arrive, continue from the evidence and produce a normal answer. Do not expose raw tool call XML or JSON as final prose.
Never write a fake tool transcript, command output, or `[CONVERSATION CONTEXT SURFACE]` text in the visible answer. If a tool is needed, emit the actual tool call so the app can create real activity records.

Respect the app permission model. Commands and writes must stay inside enabled roots and allowed modes.
