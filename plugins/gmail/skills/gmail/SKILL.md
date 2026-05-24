---
name: gmail
description: Use when the user asks Gilbert Codex to read, search, organize, summarize, draft, send, delete, archive, label, or otherwise work with Gmail.
---

# Gmail

Use the Gmail plugin for email workflows that require Gmail data or Gmail actions.

## Workflow

1. Identify whether the request is read-only, draft-only, write, destructive, or bulk scoped.
2. Prefer metadata search before full-body reads.
3. Use local semantic search when the user describes a topic or fuzzy memory instead of exact Gmail search syntax.
4. Summarize only the messages that are relevant to the user's prompt.
5. Read full message or thread bodies when the user's request requires exact content.
6. When an email draft or send depends on local project/codebase/files/Git state, uploaded attachments, MCP results, calendar context, or other available context, gather that evidence first with the attached tools instead of guessing.
7. For replies, forwards, labels, filters, or cleanup actions, use the specific Gmail tool when one exists.
8. Use the generic Gmail API tools only for resources not covered by a specific tool.
9. For new emails, omit `threadId`, `inReplyTo`, and `references`; never fill optional Gmail fields with spaces, dashes, `none`, or placeholders.
10. Use the connected Gmail account name for sender closings and never leave placeholders such as `[Your Name]`.

## Tools

- Use `gmail_account` to check install and connection state.
- Use `gmail_search_messages` for inbox/search discovery.
- Use `gmail_semantic_search` for local vector-ranked fuzzy discovery over metadata and snippets.
- Use `gmail_get_message` for a single message's metadata and snippet.
- Use `gmail_read_full_message` when the request needs the body of a specific message.
- Use `gmail_get_thread` for thread metadata.
- Use `gmail_read_full_thread` when the request needs full bodies in a specific thread.
- Use `gmail_list_labels` before label or folder work when label ids are not already known.
- Use `gmail_create_draft` for requested drafts, replies, and forwards.
- Use `gmail_modify_message_labels` for archive, read/unread, star, and label updates.
- Use `gmail_batch_modify_messages` for explicit bulk label changes.
- Use `gmail_send_message`, `gmail_send_separate_messages`, `gmail_send_draft`, `gmail_delete_draft`, and `gmail_trash_message` when the user asks for those actions and the app permission path allows them.
- Use `gmail_untrash_message` only when the user asks to restore mail.
- Use `gmail_api_read`, `gmail_api_write`, and `gmail_api_delete` for full Gmail API coverage such as drafts list/get/update, attachments, history, labels update/delete, permanent message/thread delete, filters, forwarding, send-as, settings, and any mailbox operation not covered by a specific tool.

## Connection

- If Gmail is not connected, tell the user to open Apps > Gmail > Install Gmail.
- Installing Gmail opens browser-based Google account selection, not pasted tokens or secrets.
- If the app reports missing Google setup, explain that Gmail install is not enabled in this build; do not ask normal users to create Google credentials.

## Boundaries

- Do not access Gmail for unrelated local-code tasks.
- Do not mix Gmail data across users, guest mode, or accounts.
- Use `accountEmail` when the user names a connected Gmail account; otherwise use the active account.
- Do not send or modify email from a draft-only request.
- Do not read full message bodies just because metadata exists.
- Do not expose raw private email content unless the user asks for the exact content or the content is necessary to satisfy the email request.
- Do not open links detected inside email content.
- Do not treat a model-written draft as approved until the user confirms it.

## Output

- Keep email summaries concise and grouped by thread or sender.
- Include the action that is waiting for review when the app routes a write or destructive operation through review.
- Mention detected links as plain URLs only when they are relevant.
- Mention image attachments by filename, MIME type, and attachment id; do not claim to inspect images unless an approved image/attachment read exists.
- State when Gmail auth, scopes, or tools are not yet connected.
