import { invoke } from "@tauri-apps/api/core";
import { getDefaultGoogleOAuthClientId } from "./gmailClient";
import { isTauriDesktopRuntime } from "./tauriClient";
import type {
  CalendarAccountEmailRequest,
  CalendarActionResponse,
  CalendarConnectionState,
  CalendarCreateEventRequest,
  CalendarDeleteEventRequest,
  CalendarEventListResponse,
  CalendarEventSummary,
  CalendarFreeBusyRequest,
  CalendarFreeBusyResponse,
  CalendarGetEventRequest,
  CalendarGoogleApiRequest,
  CalendarGoogleApiResponse,
  CalendarListCalendarsRequest,
  CalendarListEventsRequest,
  CalendarListResponse,
  CalendarUpdateEventRequest,
} from "../types/googleCalendar";

export const GOOGLE_CALENDAR_CORE_OAUTH_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
  "https://www.googleapis.com/auth/tasks",
] as const;

const DEFAULT_GOOGLE_CALENDAR_OAUTH_SCOPE = GOOGLE_CALENDAR_CORE_OAUTH_SCOPES.join(" ");

export interface CalendarConnectOAuthRequest {
  clientId: string;
  clientSecret?: string;
  scope?: string;
}

export function googleCalendarDesktopAvailable() {
  return isTauriDesktopRuntime();
}

export function getDefaultGoogleCalendarOAuthScope() {
  return DEFAULT_GOOGLE_CALENDAR_OAUTH_SCOPE;
}

export async function getGoogleCalendarState(): Promise<CalendarConnectionState> {
  assertCalendarDesktop();
  return invoke<CalendarConnectionState>("calendar_get_state");
}

export async function installGoogleCalendarPlugin(): Promise<CalendarConnectionState> {
  assertCalendarDesktop();
  return invoke<CalendarConnectionState>("calendar_install_plugin");
}

export async function connectGoogleCalendarOAuth(request: CalendarConnectOAuthRequest): Promise<CalendarConnectionState> {
  assertCalendarDesktop();
  return invoke<CalendarConnectionState>("calendar_connect_oauth", {
    request: {
      clientId: request.clientId,
      clientSecret: request.clientSecret,
      scope: request.scope || DEFAULT_GOOGLE_CALENDAR_OAUTH_SCOPE,
    },
  });
}

export async function disconnectGoogleCalendar(): Promise<CalendarConnectionState> {
  assertCalendarDesktop();
  return invoke<CalendarConnectionState>("calendar_disconnect");
}

export async function disconnectGoogleCalendarAccount(request: CalendarAccountEmailRequest): Promise<CalendarConnectionState> {
  assertCalendarDesktop();
  return invoke<CalendarConnectionState>("calendar_disconnect_account", {
    request,
  });
}

export async function setActiveGoogleCalendarAccount(request: CalendarAccountEmailRequest): Promise<CalendarConnectionState> {
  assertCalendarDesktop();
  return invoke<CalendarConnectionState>("calendar_set_active_account", {
    request,
  });
}

export async function listGoogleCalendars(request: CalendarListCalendarsRequest = {}): Promise<CalendarListResponse> {
  assertCalendarDesktop();
  return invoke<CalendarListResponse>("calendar_list_calendars", {
    request: withDefaultClientId(request),
  });
}

export async function listGoogleCalendarEvents(request: CalendarListEventsRequest = {}): Promise<CalendarEventListResponse> {
  assertCalendarDesktop();
  return invoke<CalendarEventListResponse>("calendar_list_events", {
    request: withDefaultClientId(request),
  });
}

export async function getGoogleCalendarEvent(request: CalendarGetEventRequest): Promise<CalendarEventSummary> {
  assertCalendarDesktop();
  return invoke<CalendarEventSummary>("calendar_get_event", {
    request: withDefaultClientId(request),
  });
}

export async function queryGoogleCalendarFreeBusy(request: CalendarFreeBusyRequest): Promise<CalendarFreeBusyResponse> {
  assertCalendarDesktop();
  return invoke<CalendarFreeBusyResponse>("calendar_free_busy", {
    request: withDefaultClientId(request),
  });
}

export async function createGoogleCalendarEvent(request: CalendarCreateEventRequest): Promise<CalendarActionResponse> {
  assertCalendarDesktop();
  return invoke<CalendarActionResponse>("calendar_create_event", {
    request: withDefaultClientId(request),
  });
}

export async function updateGoogleCalendarEvent(request: CalendarUpdateEventRequest): Promise<CalendarActionResponse> {
  assertCalendarDesktop();
  return invoke<CalendarActionResponse>("calendar_update_event", {
    request: withDefaultClientId(request),
  });
}

export async function deleteGoogleCalendarEvent(request: CalendarDeleteEventRequest): Promise<CalendarActionResponse> {
  assertCalendarDesktop();
  return invoke<CalendarActionResponse>("calendar_delete_event", {
    request: withDefaultClientId(request),
  });
}

export async function requestGoogleCalendarApi(request: CalendarGoogleApiRequest): Promise<CalendarGoogleApiResponse> {
  assertCalendarDesktop();
  return invoke<CalendarGoogleApiResponse>("calendar_google_api", {
    request: withDefaultClientId(request),
  });
}

function assertCalendarDesktop() {
  if (!googleCalendarDesktopAvailable()) {
    throw new Error("Google Calendar integration is available in the Tauri desktop app.");
  }
}

function withDefaultClientId<TRequest extends { clientId?: string }>(request: TRequest): TRequest {
  return {
    ...request,
    clientId: request.clientId || getDefaultGoogleOAuthClientId() || undefined,
  };
}
