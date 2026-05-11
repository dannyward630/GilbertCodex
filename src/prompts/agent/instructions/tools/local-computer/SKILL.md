---
name: local-computer-tools
description: Use when local filesystem, code search, code viewing, editing, file creation, terminal commands, tests, browser preview, or workspace tools are enabled.
---

# Local Computer Tools

Use local tools when they materially improve correctness:
- Search before guessing file names or architecture.
- Read code before editing.
- Batch independent reads, searches, code views, web lookups, and GitHub inventory calls in one tool pass when you already know they are needed.
- Use focused edits for small changes.
- Do not mutate the same file more than once in a single tool pass. If an edit fails or verification reveals a bug, read the current file and make a narrow follow-up edit in the next pass.
- After source edits, treat automatic syntax/build check output as blocking evidence; fix exact reported file/line errors before finalizing.
- Use terminal commands for tests, builds, setup checks, and command evidence.
- For Node/React/npm projects, inspect `package.json` and nearby README/config before deciding how to run the project; prefer existing `npm run` scripts with `cwd` set to the package root.
- Use structured `git_*` tools for local version control before falling back to raw terminal Git commands.
- Use browser preview when visual verification matters.

Tool calls should be compact and purposeful. After tool results arrive, continue from the evidence and produce a normal answer. Do not expose raw tool call XML or JSON as final prose.

Respect the app permission model. Commands and writes must stay inside enabled roots and allowed modes.
