import {
  CalendarDays,
  Clock3,
  MapPin,
  AlignLeft,
  Users,
  Repeat2,
  ExternalLink,
  Shield,
  X,
  LockKeyhole,
  Copy,
  Check,
} from "lucide-react";
import { Dialog } from "./Dialog";
import { useState } from "react";
import { Temporal } from "temporal-polyfill";
import type { CalendarEvent } from "../../shared/types";
function formatWhen(event: CalendarEvent, timeZone: string, hour12: boolean) {
  if (event.allDay) {
    const start = Temporal.PlainDate.from(event.start).toLocaleString("en", {
      dateStyle: "full",
    });
    const last = Temporal.PlainDate.from(event.end).subtract({ days: 1 });
    return last.toString() === event.start
      ? start
      : `${start} – ${last.toLocaleString("en", { dateStyle: "long" })}`;
  }
  const format = new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
    hour12,
  });
  return `${format.format(new Date(event.start))} – ${format.format(new Date(event.end))}`;
}
export function EventDetails({
  event,
  timeZone,
  hour12,
  onClose,
  onUnlock,
  canUnlock,
  compact = false,
}: {
  event: CalendarEvent;
  timeZone: string;
  hour12: boolean;
  onClose: () => void;
  onUnlock: () => void;
  canUnlock: boolean;
  compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const when = formatWhen(event, timeZone, hour12);
  async function copy() {
    try {
      await navigator.clipboard.writeText(
        `${event.title}\n${when}${!event.redacted && event.location ? `\n${event.location}` : ""}`,
      );
      setCopied(true);
      setCopyError("");
    } catch {
      setCopyError(
        "Copy is unavailable in this browser. Select the event text to copy it.",
      );
    }
  }
  const content = (
    <aside className="event-panel" aria-label="Event details">
      {!compact && (
        <div className="panel-top">
          <span className="text-label">Event details</span>
          <button
            className="icon-button"
            aria-label="Close event details"
            onClick={onClose}
          >
            <X size={19} />
          </button>
        </div>
      )}
      <div className="panel-title">
        <span className="event-rule" />
        <h2>{event.title}</h2>
      </div>
      <div className="detail-row">
        <CalendarDays size={18} />
        <div>
          <p>{when}</p>
          <span className="text-label">
            {event.allDay ? "All day" : timeZone.replaceAll("_", " ")}
          </span>
        </div>
      </div>
      {event.redacted ? (
        <div className="privacy-note">
          <LockKeyhole size={19} />
          <p>Time reserved. Other event information is private.</p>
          {canUnlock && (
            <button className="button quiet" onClick={onUnlock}>
              View calendar details
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="detail-row">
            <Clock3 size={18} />
            <p>
              {event.availability === "free" ? "Available" : "Busy"}
              {event.status === "TENTATIVE" ? ", tentative" : ""}
            </p>
          </div>
          {event.private && (
            <div className="detail-row">
              <Shield size={18} />
              <p>Private event. Visible only to the owner.</p>
            </div>
          )}
          {event.location && (
            <div className="detail-row">
              <MapPin size={18} />
              <p>{event.location}</p>
            </div>
          )}
          {event.description && (
            <div className="detail-row">
              <AlignLeft size={18} />
              <p className="event-description">{event.description}</p>
            </div>
          )}
          {event.recurrence && (
            <div className="detail-row">
              <Repeat2 size={18} />
              <p>{event.recurrence}</p>
            </div>
          )}
          {(event.organizer || event.attendees.length > 0) && (
            <div className="detail-row">
              <Users size={18} />
              <div>
                {event.organizer && (
                  <>
                    <span className="text-label">Organizer</span>
                    <p>{event.organizer}</p>
                  </>
                )}
                {event.attendees.length > 0 && (
                  <>
                    <span className="text-label">Attendees</span>
                    <ul className="attendee-list">
                      {event.attendees.map((attendee, index) => (
                        <li key={index}>{attendee}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </div>
          )}
          {event.url && (
            <a
              className="button quiet full-width"
              href={event.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open event link
              <ExternalLink size={16} />
            </a>
          )}
        </>
      )}
      <button className="button quiet full-width" onClick={copy}>
        {copied ? <Check size={16} /> : <Copy size={16} />}
        {copied ? "Copied event" : "Copy event summary"}
      </button>
      {copyError && (
        <p className="form-message error" role="alert">
          {copyError}
        </p>
      )}
    </aside>
  );
  return compact ? (
    <Dialog
      title="Event details"
      className="event-details-dialog"
      closeLabel="Close event details"
      onClose={onClose}
    >
      {content}
    </Dialog>
  ) : (
    content
  );
}
