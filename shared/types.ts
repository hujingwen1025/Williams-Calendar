export type Role = "public" | "viewer" | "owner";
export type SourceKind = "busy" | "detailed";
export interface CalendarSettings {
  title: string;
  timeZone: string;
  weekStart: number;
  workStart: string;
  workEnd: string;
  refreshMinutes: number;
}
export interface BusyEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  redacted: true;
}
export interface DetailedEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  redacted: false;
  description: string;
  location: string;
  url: string | null;
  organizer: string;
  attendees: string[];
  status: string;
  availability: "busy" | "free";
  recurrence: string | null;
  timeZone: string;
  updated: string | null;
  private: boolean;
}
export type CalendarEvent = BusyEvent | DetailedEvent;
export interface SyncStatus {
  configured: boolean;
  lastSuccess: string | null;
  stale: boolean;
  syncing: boolean;
  available: boolean;
}
export interface CalendarResponse {
  events: CalendarEvent[];
  source: SourceKind;
  status: SyncStatus;
  role: Role;
  fallback: boolean;
}
export interface SessionInfo {
  role: Role;
  expiresAt: string | null;
  csrfToken: string;
  viewerEnabled: boolean;
  settings: CalendarSettings;
}
export interface SourceInfo extends SyncStatus {
  kind: SourceKind;
  url: string;
  username: string;
  hasPassword: boolean;
  error: string | null;
  lastAttempt: string | null;
  eventCount: number;
}
export interface SourceInput {
  url: string;
  username?: string;
  password?: string;
  keepPassword?: boolean;
}
