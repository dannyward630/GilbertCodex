export interface GoogleCalendarUser {
  email: string;
  emailVerified?: boolean;
  name?: string;
  picture?: string;
  sub?: string;
}

export interface CalendarConnectionState {
  accounts: CalendarAccountState[];
  activeAccountEmail?: string;
  connected: boolean;
  connectedAt?: number;
  expiresAt?: number;
  lastConnectionError?: string;
  maxAccounts: number;
  pluginInstalled: boolean;
  pluginInstalledAt?: number;
  scopes: string[];
  user?: GoogleCalendarUser;
}

export interface CalendarAccountState {
  active: boolean;
  connectedAt?: number;
  email: string;
  expiresAt?: number;
  scopes: string[];
  user: GoogleCalendarUser;
}

export interface CalendarAuthenticatedRequest {
  accountEmail?: string;
  clientId?: string;
}

export interface CalendarAccountEmailRequest {
  email: string;
}

export interface CalendarListCalendarsRequest extends CalendarAuthenticatedRequest {
  maxResults?: number;
  minAccessRole?: "freeBusyReader" | "reader" | "writer" | "owner";
  pageToken?: string;
  showDeleted?: boolean;
  showHidden?: boolean;
}

export interface CalendarListEventsRequest extends CalendarAuthenticatedRequest {
  calendarId?: string;
  includeDeleted?: boolean;
  maxResults?: number;
  orderBy?: "startTime" | "updated";
  pageToken?: string;
  query?: string;
  singleEvents?: boolean;
  timeMax?: string;
  timeMin?: string;
  timeZone?: string;
}

export interface CalendarGetEventRequest extends CalendarAuthenticatedRequest {
  calendarId?: string;
  eventId: string;
}

export interface CalendarFreeBusyRequest extends CalendarAuthenticatedRequest {
  calendarIds?: string[];
  timeMax: string;
  timeMin: string;
  timeZone?: string;
}

export interface CalendarEventDateTimeInput {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

export interface CalendarEventAttendeeInput {
  displayName?: string;
  email: string;
  optional?: boolean;
  responseStatus?: "accepted" | "declined" | "needsAction" | "tentative";
}

export interface CalendarCreateEventRequest extends CalendarAuthenticatedRequest {
  attendees?: CalendarEventAttendeeInput[];
  calendarId?: string;
  createMeet?: boolean;
  description?: string;
  end: CalendarEventDateTimeInput;
  extra?: Record<string, unknown>;
  location?: string;
  sendUpdates?: "all" | "externalOnly" | "none";
  start: CalendarEventDateTimeInput;
  summary: string;
}

export interface CalendarUpdateEventRequest extends CalendarAuthenticatedRequest {
  attendees?: CalendarEventAttendeeInput[];
  calendarId?: string;
  createMeet?: boolean;
  description?: string;
  end?: CalendarEventDateTimeInput;
  eventId: string;
  extra?: Record<string, unknown>;
  location?: string;
  sendUpdates?: "all" | "externalOnly" | "none";
  start?: CalendarEventDateTimeInput;
  status?: "cancelled" | "confirmed" | "tentative";
  summary?: string;
}

export interface CalendarDeleteEventRequest extends CalendarAuthenticatedRequest {
  calendarId?: string;
  eventId: string;
  sendUpdates?: "all" | "externalOnly" | "none";
}

export type CalendarGoogleApiService = "calendar" | "tasks";
export type CalendarGoogleApiMethod = "DELETE" | "GET" | "PATCH" | "POST" | "PUT";

export interface CalendarGoogleApiRequest extends CalendarAuthenticatedRequest {
  body?: unknown;
  method: CalendarGoogleApiMethod;
  path: string;
  query?: Record<string, unknown>;
  service: CalendarGoogleApiService;
}

export interface CalendarGoogleApiResponse {
  accountEmail?: string;
  data: unknown;
  message: string;
  method: CalendarGoogleApiMethod;
  path: string;
  service: CalendarGoogleApiService;
}

export interface CalendarSummary {
  accessRole?: string;
  backgroundColor?: string;
  description?: string;
  foregroundColor?: string;
  id: string;
  primary: boolean;
  selected: boolean;
  summary?: string;
  timeZone?: string;
}

export interface CalendarListResponse {
  calendars: CalendarSummary[];
  nextPageToken?: string;
}

export interface CalendarEventDateTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

export interface CalendarEventAttendee {
  displayName?: string;
  email?: string;
  optional?: boolean;
  organizer?: boolean;
  responseStatus?: string;
  selfAttendee?: boolean;
}

export interface CalendarEventSummary {
  accountEmail?: string;
  attendees: CalendarEventAttendee[];
  calendarId: string;
  conferenceLink?: string;
  created?: string;
  description?: string;
  end?: CalendarEventDateTime;
  hangoutLink?: string;
  htmlLink?: string;
  iCalUid?: string;
  id: string;
  location?: string;
  start?: CalendarEventDateTime;
  status?: string;
  summary?: string;
  updated?: string;
}

export interface CalendarEventListResponse {
  accountEmail?: string;
  calendarId: string;
  events: CalendarEventSummary[];
  nextPageToken?: string;
  nextSyncToken?: string;
  summary?: string;
  timeZone?: string;
  updated?: string;
}

export interface CalendarActionResponse {
  accountEmail?: string;
  calendarId: string;
  event?: CalendarEventSummary;
  message: string;
}

export interface CalendarFreeBusyResponse {
  accountEmail?: string;
  calendars: CalendarFreeBusyCalendar[];
  groups: Record<string, unknown>;
  timeMax: string;
  timeMin: string;
}

export interface CalendarFreeBusyCalendar {
  busy: CalendarBusyBlock[];
  errors: string[];
  id: string;
}

export interface CalendarBusyBlock {
  end: string;
  start: string;
}
