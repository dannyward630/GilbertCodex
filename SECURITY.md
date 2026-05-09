# Security Policy

Gilbert Codex is a local desktop agent workspace in early development. Please report security issues privately instead of opening a public issue with exploit details.

## Supported Versions

The project is pre-1.0. Security fixes target the latest main branch until formal releases exist.

## Reporting a Vulnerability

Send a private report to the repository owner with:

- A concise description of the issue.
- Steps to reproduce.
- Any affected files or flows.
- Suggested mitigations, if you have them.

Please do not include real API keys, tokens, passwords, customer data, or private repository content in reports.

## Secret Handling

- Do not commit `.env` files, API keys, logs, build output, or local dependency folders.
- OpenRouter keys are user-provided through the Settings UI and should be treated as local user data.
- Moving provider credentials to OS-backed secure storage is a Phase 2 requirement before broad public distribution.
