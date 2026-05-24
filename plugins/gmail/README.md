# Gmail Plugin

Gmail is the first Gilbert Codex plugin. This bundle defines the app-facing metadata, skill rules, and local tool bridge used by the AI runtime.

## Product Scope

- Read inbox, thread, label, attachment, draft, history, settings, filter, forwarding, send-as, and search data after the user connects Gmail.
- Read full message/thread bodies when the user's request needs them.
- Rank fuzzy email requests with local vector search over Gmail metadata and snippets before reading bodies.
- Summarize relevant email context without leaking unrelated messages into the conversation.
- Draft replies, forwards, labels, filters, and cleanup actions.
- Send direct messages and separate bulk messages through Gmail API tools when the user asks to send.
- Run mutating Gmail actions when the app permission mode allows it, while destructive actions still use the app's hard approval path.
- Detect attachments, image attachments, and links during full reads; list links without opening them.
- Keep authenticated-user data separate from guest mode and unrelated accounts.

## User Connection Flow

1. Open Apps.
2. Choose Gmail.
3. Click Install Gmail.
4. Pick the Gmail account in the browser.
5. Approve the Google permission screen.
6. Return to Gilbert Codex after the browser says Gmail connected.

The user should never need to paste a Google secret, token, or authorization code. Installing the plugin opens Google in the browser automatically, lets the user choose the account, and receives the approval through a local loopback callback on the same device.

End users do not create Google credentials. The app build should already be configured with the public OAuth client ID, the same way hosted products hide connector setup from normal users.

Official releases get that public client ID from the `VITE_GOOGLE_OAUTH_CLIENT_ID` GitHub repository variable or secret during the release workflow. Local development can use `.env` with the same key.

The Google desktop OAuth client secret is backend-only. Local builds read `GOOGLE_OAUTH_CLIENT_SECRET` from ignored environment files or process environment, and release builds read it from the GitHub repository secret with the same name.

## Developer Setup

- Create a Google OAuth client for a desktop app in Google Cloud.
- Enable the Gmail API for the same Google Cloud project.
- Put the public client ID in `VITE_GOOGLE_OAUTH_CLIENT_ID`.
- Put the desktop client secret in `GOOGLE_OAUTH_CLIENT_SECRET`.
- Restart the Vite or Tauri app after changing environment values.
- Do not commit Google client secrets, refresh tokens, access tokens, or exported OAuth credentials.
- The Gmail plugin requests full Gmail API scopes because the app exposes full mailbox control through specific tools plus generic Gmail API tools.

Default scopes:

- `openid`
- `email`
- `profile`
- `https://mail.google.com/`
- `https://www.googleapis.com/auth/gmail.modify`
- `https://www.googleapis.com/auth/gmail.compose`
- `https://www.googleapis.com/auth/gmail.send`
- `https://www.googleapis.com/auth/gmail.labels`
- `https://www.googleapis.com/auth/gmail.settings.basic`
- `https://www.googleapis.com/auth/gmail.settings.sharing`

Existing connected accounts that only show `gmail.modify` should reconnect Gmail from Apps so Google grants the expanded permissions. Public distribution with restricted Gmail scopes requires the production Google Cloud OAuth consent app to be approved for the requested scopes before users get the polished account-selection experience.

## Implementation Notes

- `.codex-plugin/plugin.json` is the user-visible plugin manifest.
- `.app.json` declares the Gilbert Gmail connector boundary, OAuth client env key, loopback redirect mode, and core scopes.
- `.mcp.json` stays empty because Gmail runs through Gilbert Codex's local tool bridge, not a separate MCP server.
- `skills/gmail/SKILL.md` is the model-facing workflow rulebook.
- `src-tauri/src/commands/gmail.rs` owns desktop OAuth and account-state storage.
- `src/app/gmailClient.ts` owns the frontend command wrapper.
- `src/toolBridge/tools/gmail/index.ts` exposes the AI-callable Gmail tools.

AI tool ids:

- `gmail_account`
- `gmail_search_messages`
- `gmail_semantic_search`
- `gmail_get_message`
- `gmail_read_full_message`
- `gmail_get_thread`
- `gmail_read_full_thread`
- `gmail_list_labels`
- `gmail_create_draft`
- `gmail_send_message`
- `gmail_send_separate_messages`
- `gmail_send_draft`
- `gmail_delete_draft`
- `gmail_modify_message_labels`
- `gmail_batch_modify_messages`
- `gmail_trash_message`
- `gmail_untrash_message`
- `gmail_create_label`
- `gmail_api_read`
- `gmail_api_write`
- `gmail_api_delete`

## Safety Rules

- Read actions can run after auth when they match the user's current request, including full-body reads when needed.
- Metadata reads should come before full-body reads whenever they can answer the request.
- Plugin installation is stored locally before Google account authorization starts.
- Mutating tools can run directly when the app permission mode allows mutating actions.
- Destructive actions still go through the app's hard approval circuit breaker and should show target counts, affected labels or threads, and a reversible path when one exists.
- Links found in email content may be listed for review, but the Gmail plugin must not open them automatically.
- Sensitive email content should be summarized narrowly and cited by message or thread identity in the UI.
- Tokens are stored in the current local user namespace, not a shared guest or system namespace.
