# Gmail Plugin Setup

The user flow should stay simple:

1. Open Apps.
2. Choose Gmail.
3. Click Install Gmail.
4. Pick the Gmail account in the browser.
5. Approve the permission screen.
6. Return to Gilbert Codex when the browser says Gmail connected.

Installing Gmail opens Google account selection automatically. Users should never paste Google secrets, tokens, refresh tokens, or authorization codes into Gilbert Codex.

End users do not complete developer setup. A release build should already include the public Google OAuth client ID needed to open Google account selection.

Users can connect up to six Gmail accounts. Tool calls use the active account by default and can target another connected account with `accountEmail`.

## Release Setup

Official downloadable builds should include the public Google OAuth desktop client ID at build time:

1. Create or choose the production Google Cloud project for Gilbert Codex.
2. Enable the Gmail API.
3. Configure the OAuth consent screen for external users.
4. Create a Desktop app OAuth client.
5. Add the client ID to GitHub as a repository variable named `VITE_GOOGLE_OAUTH_CLIENT_ID`.
6. Add the desktop OAuth client secret to GitHub as a repository secret named `GOOGLE_OAUTH_CLIENT_SECRET`.
7. Use a repository secret for the client ID only if you prefer to hide it from repository settings viewers.

The release workflow fails before building if either value is missing. The client ID is public application identity. The desktop client secret is backend-only and must not be exposed through `VITE_` variables or committed to source control; shipped desktop apps can still contain it because installed-app OAuth clients cannot keep client secrets truly confidential. Never put user access tokens, refresh tokens, or exported user credential JSON in GitHub variables, GitHub secrets, `.env`, or source files.

## Developer Setup

1. Open Google Cloud Console.
2. Create or choose a Google Cloud project.
3. Enable the Gmail API.
4. Create an OAuth client for a desktop app.
5. Copy `.env.example` to `.env`.
6. Set `VITE_GOOGLE_OAUTH_CLIENT_ID` to the public OAuth client ID.
7. Set `GOOGLE_OAUTH_CLIENT_SECRET` to the desktop OAuth client secret.
8. Restart Gilbert Codex, Vite, or Tauri after changing environment values.

If Google shows `Error 403: access_denied` with a message that Gilbert Codex has not completed verification, open Google Auth Platform > Audience and add the Gmail account as a test user. While the app is in Testing, only listed test users can authorize Gmail scopes.

The Google OAuth client ID is public app identity. Keep `GOOGLE_OAUTH_CLIENT_SECRET` in ignored local `.env` files or GitHub release secrets only. Do not commit downloaded credential JSON, access tokens, refresh tokens, or Gmail payload exports.

## Current Scope Bundle

- `openid`
- `email`
- `profile`
- `https://www.googleapis.com/auth/gmail.modify`

Google classifies `gmail.modify` as a restricted Gmail scope. Keep it only because the product goal is more than read-only Gmail: labels, drafts, archive/trash actions, and send proposals need broad Gmail action support.

## AI Tool Surface

Gmail tools are exposed through the local tool bridge, backed by Tauri commands that call the Gmail REST API with the user's stored OAuth token.

- Metadata and search tools: `gmail_account`, `gmail_search_messages`, `gmail_semantic_search`, `gmail_get_message`, `gmail_get_thread`, `gmail_list_labels`
- Full-content tools: `gmail_read_full_message`, `gmail_read_full_thread`
- Draft and organize tools: `gmail_create_draft`, `gmail_create_label`, `gmail_modify_message_labels`, `gmail_batch_modify_messages`, `gmail_untrash_message`
- Confirmation-gated send tools: `gmail_send_message`, `gmail_send_separate_messages`, `gmail_send_draft`
- Confirmation-gated destructive tools: `gmail_delete_draft`, `gmail_trash_message`

The tool bridge treats send, draft deletion, and trash as destructive so the app approval path stays visible before the operation runs.

Full-content reads are also approval-gated. Metadata tools can show sender, recipient, subject, date, labels, snippets, ids, and thread ids without exposing the full body. Approved full reads can return body text, attachment metadata, detected image attachments, and detected links. Detected links are never opened automatically.

`gmail_semantic_search` uses local vector-style hashing over metadata and snippets to rank fuzzy requests. It does not send email content to a separate embedding provider.

`gmail_batch_modify_messages` uses Gmail's batch label modify capability for explicit message IDs. Separate-recipient sends intentionally send one message per recipient so addresses are not exposed to each other.

## Public Distribution Requirements

- The OAuth consent screen must be configured for external users and moved out of testing before the app is treated as public.
- Sensitive or restricted Gmail scopes need Google OAuth verification.
- If restricted Gmail data is stored on servers or transmitted outside the user's device, Google can require an additional security assessment.
- The public home page and privacy policy should clearly explain how Gilbert Codex accesses, uses, stores, and shares Google user data.
- Release notes should not claim Gmail is broadly available until the production Google Cloud project is verified for the requested scopes.

## Safety Contract

- Reading Gmail requires the connected Google account.
- Installing the Gmail plugin writes a local installed-plugin record before Google auth starts.
- Metadata-first reads should be preferred before full-body reads.
- Full message or thread body reads require visible approval for the exact id.
- Drafting is safe to propose without sending.
- Sending, deleting, archiving, spam, unsubscribe, and bulk label changes require a visible confirmation card.
- Approval previews must not execute the Gmail action.
- Links detected in email content must be listed only; never open them automatically.
- Tokens are stored under the signed-in local Gilbert user namespace.
- Guest mode must not read or write authenticated Gmail state.
