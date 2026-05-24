---
name: google-calendar
description: Use when the user asks Gilbert Codex to read, search, summarize, prepare for, create, update, delete, or find availability in Google Calendar or Google Tasks.
---

# Google Calendar

Use the Google Calendar plugin for scheduling workflows that require Google Calendar data or calendar actions.

## Workflow

1. Check `calendar_account` before assuming Calendar is installed or connected.
2. Prefer `calendar_free_busy` when the user asks only about availability.
3. Use `calendar_search_events` for agenda, date-range, person, location, or keyword discovery.
4. Use `calendar_get_event` before detailed event reasoning or any update/delete.
5. Use specific event, calendar, or task tools first. Use generic API tools only for Calendar/Tasks resources not covered by a specific tool.
6. Mention the active account when account identity matters.

## Tool Guide

- Use `calendar_account` to check install and connection state.
- Use `calendar_list_calendars` to discover calendar ids and primary calendars.
- Use `calendar_search_events` to list agenda windows or search events.
- Use `calendar_get_event` to read a single event by id.
- Use `calendar_free_busy` to answer availability without reading event titles.
- Use `calendar_create_event`, `calendar_update_event`, and `calendar_delete_event` for events.
- Use `calendar_create_calendar`, `calendar_update_calendar`, and `calendar_delete_calendar` for secondary calendar management.
- Use `calendar_list_task_lists`, `calendar_list_tasks`, `calendar_get_task`, `calendar_create_task_list`, `calendar_update_task_list`, `calendar_delete_task_list`, `calendar_create_task`, `calendar_update_task`, `calendar_move_task`, `calendar_clear_completed_tasks`, and `calendar_delete_task` for Google Tasks.
- Use `calendar_api_read`, `calendar_api_write`, and `calendar_api_delete` for advanced Google Calendar API or Google Tasks API actions such as ACL sharing, settings, colors, CalendarList updates, event import/move/quickAdd, recurring instances, or advanced event fields.

## Setup

- If Calendar is not connected, tell the user to open Apps > Google Calendar > Install Calendar.
- Installing Calendar opens browser-based Google account selection, not pasted tokens or secrets.
- If the app reports missing Google setup, explain that Google Calendar install is not enabled in this build; do not ask normal users to create Google credentials.

## Safety

- Mutating Calendar/Tasks tools may execute directly when the app's permission mode allows mutating tools and the user clearly asked for the action.
- Destructive actions still require the app's approval circuit breaker.
- Do not infer private event details from free/busy responses.
- Do not mix Calendar data across users, guest mode, or connected Google accounts.
- Use `accountEmail` when the user names a connected Google account; otherwise use the active account.
- For scheduling, preserve explicit timezone, attendee, recurrence, conference, and notification details when the user provides them.

## Response Style

- For agendas, group by day and include times, titles, calendars, locations, and obvious prep notes.
- For availability, show the checked window and calendars before recommending slots.
- For write proposals, summarize the proposed event in plain language and wait for confirmation when the tool has not actually executed.
- State when Calendar auth, scopes, or tools are not connected.
