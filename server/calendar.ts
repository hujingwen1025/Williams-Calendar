import ical, {
  type CalendarResponse as ParsedCalendar,
  type VEvent,
  type ParameterValue,
  type EventInstance,
} from "node-ical";
import { Temporal } from "temporal-polyfill";
import { opaqueId, safeUrl } from "./security.js";
import type {
  BusyEvent,
  CalendarEvent,
  DetailedEvent,
  Role,
} from "../shared/types.js";
export const text = (value: ParameterValue | undefined): string =>
  typeof value === "string" ? value : (value?.val ?? "");
export function normalizeFloating(raw: string, fallbackZone: string) {
  const unfolded = raw.replace(/\r?\n[ \t]/g, "");
  let zone =
    unfolded.match(/^X-WR-TIMEZONE:(.+)$/im)?.[1]?.trim() || fallbackZone;
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone }).format();
  } catch {
    zone = fallbackZone;
  }
  return unfolded
    .split(/\r?\n/)
    .map((line) => {
      const m =
        /^(DTSTART|DTEND|RECURRENCE-ID|EXDATE|RDATE)([^:]*):(.+)$/i.exec(line);
      if (
        m &&
        !/TZID=|VALUE=DATE(?:;|$)/i.test(m[2]) &&
        m[3].split(",").every((v) => /^\d{8}T\d{6}$/.test(v))
      ) {
        return `${m[1]}${m[2]};TZID=${zone}:${m[3]}`;
      }
      return line;
    })
    .join("\r\n");
}
export async function parseCalendar(
  raw: string,
  timeZone: string,
): Promise<ParsedCalendar> {
  if (!/^BEGIN:VCALENDAR\s*$/im.test(raw) || !/^END:VCALENDAR\s*$/im.test(raw))
    throw new Error("The source is not a valid ICS calendar.");
  try {
    const parsed = await ical.async.parseICS(normalizeFloating(raw, timeZone));
    const components = Object.values(parsed).filter(
      (c) => c?.type === "VEVENT" || c?.type === "VFREEBUSY",
    );
    if (components.length > 50_000)
      throw new Error("Too many calendar records.");
    for (const item of components) {
      if (
        item?.type === "VEVENT" &&
        (!item.start || Number.isNaN(item.start.getTime()))
      )
        throw new Error("Invalid event start.");
    }
    return parsed;
  } catch {
    throw new Error(
      "The calendar could not be parsed. Check its ICS format and event dates.",
    );
  }
}
function endpoint(date: Date, allDay: boolean) {
  // node-ical represents DATE values at local midnight; UTC serialization can
  // shift a date to the previous day on hosts east of UTC.
  return allDay
    ? `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
    : date.toISOString();
}
function address(value: unknown): string {
  if (typeof value === "string") return value.replace(/^mailto:/i, "");
  if (value && typeof value === "object") {
    const v = value as { val?: string; params?: { CN?: string } };
    return v.params?.CN || v.val?.replace(/^mailto:/i, "") || "";
  }
  return "";
}
export function expandCalendar(
  parsed: ParsedCalendar,
  from: Date,
  to: Date,
  role: Role,
  key: Buffer,
  timeZone: string,
  displayZone = timeZone,
): CalendarEvent[] {
  const results: CalendarEvent[] = [];
  const firstDay = Temporal.Instant.from(from.toISOString())
    .toZonedDateTimeISO(displayZone)
    .toPlainDate()
    .toString();
  const lastDay = Temporal.Instant.from(to.toISOString())
    .toZonedDateTimeISO(displayZone)
    .toPlainDate()
    .toString();
  const pushInstance = (master: VEvent, instance: EventInstance) => {
    const event = { ...master, ...instance.event };
    if (event.status === "CANCELLED") return;
    const free =
      event.transparency === "TRANSPARENT" ||
      String(event["MICROSOFT-CDO-BUSYSTATUS"] || "").toUpperCase() === "FREE";
    if (role === "public" && free) return;
    const start = endpoint(instance.start, instance.isFullDay);
    let end = endpoint(instance.end, instance.isFullDay);
    if (end <= start)
      end = instance.isFullDay
        ? Temporal.PlainDate.from(start).add({ days: 1 }).toString()
        : new Date(instance.start.getTime() + 60_000).toISOString();
    const id = opaqueId(
      key,
      `event:${master.uid}:${event.recurrenceid?.toISOString() || start}`,
    );
    const isPrivate = ["PRIVATE", "CONFIDENTIAL"].includes(event.class || "");
    if (role === "public" || (isPrivate && role !== "owner")) {
      if (!free)
        results.push({
          id,
          title: "Busy",
          start,
          end,
          allDay: instance.isFullDay,
          redacted: true,
        });
      return;
    }
    const attendees = event.attendee
      ? (Array.isArray(event.attendee) ? event.attendee : [event.attendee])
          .map(address)
          .filter(Boolean)
      : [];
    const detail: DetailedEvent = {
      id,
      title: text(instance.summary) || text(event.summary) || "Untitled event",
      start,
      end,
      allDay: instance.isFullDay,
      redacted: false,
      description: text(event.description),
      location: text(event.location),
      url: safeUrl(event.url),
      organizer: address(event.organizer),
      attendees,
      status: event.status || "CONFIRMED",
      availability: free ? "free" : "busy",
      recurrence: master.rrule ? master.rrule.toText() : null,
      timeZone: event.start.tz || timeZone,
      updated: event.lastmodified?.toISOString() || null,
      private: isPrivate,
    };
    results.push(detail);
  };
  for (const component of Object.values(parsed)) {
    if (!component) continue;
    if (component.type === "VEVENT") {
      const dateOnly =
        component.datetype === "date" || component.start.dateOnly;
      const instances = ical.expandRecurringEvent(component, {
        // DATE values are represented in the host zone by the parser. Widen
        // expansion, then compare calendar dates in the viewer's date window.
        from: dateOnly ? new Date(from.getTime() - 2 * 86400_000) : from,
        to: dateOnly ? new Date(to.getTime() + 2 * 86400_000) : to,
        includeOverrides: true,
        excludeExdates: true,
        expandOngoing: true,
        maxIterations: 20_000,
      });
      for (const instance of instances) {
        if (instance.isFullDay) {
          if (
            endpoint(instance.start, true) >= lastDay ||
            endpoint(instance.end, true) <= firstDay
          )
            continue;
        } else if (instance.start >= to || instance.end <= from) continue;
        pushInstance(component, instance);
        if (results.length > 20_000)
          throw new Error(
            "This range contains too many events. Choose a shorter date range.",
          );
      }
    } else if (component.type === "VFREEBUSY") {
      for (const period of component.freebusy || []) {
        if (period.type === "FREE" || period.start >= to || period.end <= from)
          continue;
        results.push({
          id: opaqueId(
            key,
            `period:${period.start.toISOString()}:${period.end.toISOString()}`,
          ),
          title: "Busy",
          start: period.start.toISOString(),
          end: period.end.toISOString(),
          allDay: false,
          redacted: true,
        });
      }
    }
  }
  return role === "public"
    ? mergeBusy(results as BusyEvent[], key, timeZone)
    : results.sort((a, b) => a.start.localeCompare(b.start));
}
function instant(event: BusyEvent, edge: "start" | "end", timeZone: string) {
  return event.allDay
    ? Temporal.PlainDate.from(event[edge]).toZonedDateTime(timeZone)
        .epochMilliseconds
    : Date.parse(event[edge]);
}
export function mergeBusy(
  events: BusyEvent[],
  key: Buffer,
  timeZone: string,
): BusyEvent[] {
  const intervals = events
    .map((event) => ({
      event,
      start: instant(event, "start", timeZone),
      end: instant(event, "end", timeZone),
    }))
    .sort((a, b) => a.start - b.start);
  const merged: typeof intervals = [];
  for (const interval of intervals) {
    const previous = merged.at(-1);
    if (previous && interval.start < previous.end) {
      const sameDayKind = previous.event.allDay && interval.event.allDay;
      previous.end = Math.max(previous.end, interval.end);
      if (sameDayKind)
        previous.event.end =
          previous.event.end > interval.event.end
            ? previous.event.end
            : interval.event.end;
      else
        previous.event = {
          ...previous.event,
          allDay: false,
          start: new Date(previous.start).toISOString(),
          end: new Date(previous.end).toISOString(),
        };
    } else merged.push({ ...interval, event: { ...interval.event } });
  }
  return merged.map(({ event }) => ({
    ...event,
    id: opaqueId(key, `busy:${event.start}:${event.end}`),
  }));
}
