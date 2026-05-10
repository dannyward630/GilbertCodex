# Security Policy

Gilbert Codex is a local desktop agent workspace in early development. Please report security issues privately instead of opening a public issue with exploit details.

## Supported Versions

The project is pre-1.0. Security fixes target the latest `main` branch until formal releases exist.

## Reporting A Vulnerability

Send a private report to the repository owner with:

- A concise description of the issue.
- Steps to reproduce.
- Any affected files, commands, or user flows.
- Suggested mitigations, if you have them.

Do not include real API keys, tokens, passwords, private workspace content, customer data, or sensitive terminal output in reports.

## Local Data Handling

- Provider keys and local model endpoint URLs are user-provided through Settings and should be treated as local user data.
- GitHub access tokens are created by browser login, stored in the local app data area, and used only by the desktop Tauri GitHub command layer. The default browser login requests broad GitHub OAuth scopes for full source-control, workflow, package, gist, organization, and repository-admin capability; users should only authorize accounts they intend Gilbert Codex to operate.
- Local accounts are for app state separation, not cloud identity or multi-user hardening.
- The Tauri desktop app stores local account records in the app data area.
- The browser preview uses localStorage fallbacks for development-only account and workspace state.
- Terminal sessions and local file tools can expose private paths or file contents in logs and screenshots.
- The desktop app uses a Tauri CSP and grants only the notification commands needed for permission checks and sending notifications.

## Secret Handling

- Do not commit `.env` files, API keys, logs, build output, local databases, dependency folders, or generated targets.
- Do not paste real provider keys, GitHub tokens, GitHub OAuth client secrets, or private repository content into issues, examples, fixtures, or docs.
- Keep release signing keys and packaging credentials outside the repository.
- Moving provider and GitHub credentials to OS-backed secure storage remains a pre-release hardening requirement.
