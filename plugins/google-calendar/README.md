# Google Calendar Plugin

Google Calendar is a first-party Gilbert Codex plugin for schedule awareness, availability checks, meeting prep, Calendar management, Google Tasks, and reviewed calendar changes. It is intentionally separate from Gmail even though both use the same Google OAuth project and loopback sign-in flow.

## User Workflow

1. Open Apps.
2. Choose Google Calendar.
3. Click Install Calendar.
4. Pick the Google account in the browser.
5. Return to Gilbert Codex after the browser says Google Calendar connected.

The user should never paste a Google secret, token, or authorization code. Installing the plugin opens Google account selection and receives the approval through a local loopback callback on the same device.

## Capabilities

- List connected Google Calendar accounts and active account state.
- List calendars visible to the active account.
- Search or list events by date window, text query, calendar id, and page token.
- Read event details including attendees, links, conference links, location, and status.
- Query free/busy data for one or more calendars.
- Create, update, move, import, and delete events, including recurring events, reminders, Meet links, visibility, transparency, colors, guests, attachments, and advanced event fields.
- Create Google Meet links by requesting fresh conference data for each event.
- Create, update, and delete secondary calendars.
- Read colors, settings, ACL sharing rules, event instances, and any other Calendar API resource through the generic Calendar API tools.
- List, create, update, move, clear, and delete Google Tasks task lists and tasks through the Google Tasks API.

## Google Setup

The desktop app reuses the existing Google OAuth environment contract:

- `VITE_GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`

Enable the Google Calendar API for the same Google Cloud project used by Gmail.

Core scopes:

- `openid`
- `email`
- `profile`
- `https://www.googleapis.com/auth/calendar`
- `https://www.googleapis.com/auth/calendar.readonly`
- `https://www.googleapis.com/auth/calendar.events`
- `https://www.googleapis.com/auth/calendar.freebusy`
- `https://www.googleapis.com/auth/tasks`

`calendar` gives the plugin full Calendar API read/write coverage, `calendar.readonly` and `calendar.events` preserve compatibility with earlier installs, `calendar.freebusy` is used for availability checks without exposing event titles, and `tasks` enables Google Tasks task-list and task operations. Existing connected accounts that do not show the full scopes should reconnect Google Calendar from Apps so Google grants the expanded permissions.

## Files

- `.codex-plugin/plugin.json` is the user-visible plugin manifest.
- `.app.json` declares the Gilbert Calendar connector boundary, OAuth client env keys, loopback redirect mode, and core scopes.
- `.mcp.json` stays empty because Calendar runs through Gilbert Codex's local tool bridge, not a separate MCP server.
- `skills/google-calendar/SKILL.md` is the model-facing workflow rulebook.
- `src-tauri/src/commands/google_calendar.rs` owns desktop OAuth and Google Calendar API calls.
- `src/app/googleCalendarClient.ts` owns the frontend command wrapper.
- `src/toolBridge/tools/googleCalendar/index.ts` exposes AI-callable Calendar tools.

## Tool Surface

- `calendar_account`
- `calendar_list_calendars`
- `calendar_search_events`
- `calendar_get_event`
- `calendar_free_busy`
- `calendar_create_event`
- `calendar_update_event`
- `calendar_delete_event`
- `calendar_create_calendar`
- `calendar_update_calendar`
- `calendar_delete_calendar`
- `calendar_api_read`
- `calendar_api_write`
- `calendar_api_delete`
- `calendar_list_task_lists`
- `calendar_list_tasks`
- `calendar_get_task`
- `calendar_create_task_list`
- `calendar_update_task_list`
- `calendar_delete_task_list`
- `calendar_create_task`
- `calendar_update_task`
- `calendar_move_task`
- `calendar_clear_completed_tasks`
- `calendar_delete_task`

## Safety Rules

- Calendar writes can run directly when the workspace permission mode allows mutating tools; destructive actions still use the app's hard approval circuit breaker.
- Free/busy should be preferred when the user only asks about availability.
- Calendar data must stay scoped to the active Gilbert user namespace and selected Google account.
- Never mix Google Calendar account data across app users, guest mode, or accounts.
- Timezone, attendee list, title, start, end, and affected calendar must be shown before writes.
