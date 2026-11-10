import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import FullCalendar, {
  type CalendarRef,
  type DatesSetInfo,
  type EventDisplayInfo,
} from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/react/daygrid";
import timeGridPlugin from "@fullcalendar/react/timegrid";
import listPlugin from "@fullcalendar/react/list";
import multiMonthPlugin from "@fullcalendar/react/multimonth";
import interactionPlugin from "@fullcalendar/react/interaction";
import classicThemePlugin from "@fullcalendar/react/themes/classic";
import { Temporal } from "temporal-polyfill";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  Filter,
  Globe2,
  List,
  LockKeyhole,
  LockKeyholeOpen,
  Printer,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  X,
  AlertCircle,
  Check,
  ZoomIn,
  ZoomOut,
  MoreHorizontal,
} from "lucide-react";
import type {
  CalendarEvent,
  CalendarResponse,
  SessionInfo,
} from "../shared/types";
import { api, post, setCsrf } from "./api";
import { useMediaQuery } from "./useMediaQuery";
import { Dialog } from "./components/Dialog";
import { Login } from "./components/Login";
import { Settings } from "./components/Settings";
import { EventDetails } from "./components/EventDetails";
import {
  useCalendarZoom,
  clampCalendarZoom,
  MIN_CALENDAR_ZOOM,
  MAX_CALENDAR_ZOOM,
  CALENDAR_ZOOM_STEP,
} from "./useCalendarZoom";
const plugins = [
  dayGridPlugin,
  timeGridPlugin,
  listPlugin,
  multiMonthPlugin,
  interactionPlugin,
  classicThemePlugin,
];
const views = [
  { id: "dayGridMonth", label: "Month", short: "M" },
  { id: "timeGridWeek", label: "Week", short: "W" },
  { id: "timeGridDay", label: "Day", short: "D" },
  { id: "listMonth", label: "Agenda", short: "A" },
  { id: "workWeek", label: "Work week", short: "" },
  { id: "multiMonthYear", label: "Year", short: "Y" },
];
interface Preferences {
  timeZone?: string;
  hour12: boolean;
  weekends: boolean;
  weekStart?: number;
  zoom: number;
}
function readPreferences(): Preferences {
  try {
    const saved = JSON.parse(
      localStorage.getItem("calendar-preferences") || "{}",
    );
    return {
      hour12: false,
      weekends: true,
      ...saved,
      zoom: clampCalendarZoom(saved?.zoom),
    };
  } catch {
    return { hour12: false, weekends: true, zoom: 100 };
  }
}
const dateInZone = (zone: string) =>
  Temporal.Now.zonedDateTimeISO(zone).toPlainDate().toString();
function validDate(date: string | null) {
  try {
    return date ? Temporal.PlainDate.from(date).toString() : undefined;
  } catch {
    return undefined;
  }
}
const PHONE_QUERY =
  "(max-width: 640px), (max-width: 950px) and (max-height: 500px)";
export function App() {
  const isPhone = useMediaQuery(PHONE_QUERY);
  const compactDetails = useMediaQuery("(max-width: 950px)");
  const calendar = useRef<CalendarRef>(null);
  const calendarSheet = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const initial = useMemo(() => new URLSearchParams(location.search), []);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [initialError, setInitialError] = useState("");
  const [preferences, setPreferences] = useState<Preferences>(readPreferences);
  const [view, setView] = useState(() =>
    views.some((v) => v.id === initial.get("view"))
      ? initial.get("view")!
      : matchMedia(PHONE_QUERY).matches
        ? "listMonth"
        : "dayGridMonth",
  );
  const [anchorDate, setAnchorDate] = useState<string | undefined>(() =>
    validDate(initial.get("date")),
  );
  const [range, setRange] = useState<{ start: string; end: string } | null>(
    null,
  );
  const [heading, setHeading] = useState("");
  const [data, setData] = useState<CalendarResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState(initial.get("q") || "");
  const [search, setSearch] = useState(query);
  const [filter, setFilter] = useState(
    ["all", "busy", "free", "tentative"].includes(initial.get("filter") || "")
      ? initial.get("filter")!
      : "all",
  );
  const [selected, setSelected] = useState<CalendarEvent | null>(null);
  const [modal, setModal] = useState<
    "viewer" | "owner" | "settings" | "help" | "preferences" | "options" | null
  >(null);
  const [preview, setPreview] = useState(false);
  const [revision, setRevision] = useState(0);
  const [now, setNow] = useState(new Date());
  const [actionError, setActionError] = useState("");
  const actualRole = session?.role || "public";
  const effectiveRole = preview ? "public" : actualRole;
  const timeZone =
    preferences.timeZone || session?.settings.timeZone || "Asia/Shanghai";
  const weekStart = preferences.weekStart ?? session?.settings.weekStart ?? 1;
  const zoom = preferences.zoom;
  const isTimeline = ["timeGridDay", "timeGridWeek", "workWeek"].includes(view);
  const isPannableWeek = isPhone && ["timeGridWeek", "workWeek"].includes(view);
  const setZoom = useCalendarZoom(
    calendarSheet,
    zoom,
    (value) => setPreferences((old) => ({ ...old, zoom: value })),
    Boolean(session) && !modal,
  );
  const loadSession = useCallback(async () => {
    const next = await api<SessionInfo>("/api/session");
    setCsrf(next.csrfToken);
    setSession((previous) => {
      if (previous && previous.role !== next.role) {
        setData(null);
        setSelected(null);
        setPreview(false);
        setQuery("");
        setSearch("");
        setFilter("all");
        if (next.role === "public") setModal(null);
      }
      return next;
    });
    document.title = next.settings.title;
    setInitialError("");
  }, []);
  useEffect(() => {
    void loadSession().catch((error) => setInitialError(error.message));
  }, [loadSession]);
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const poll = () => {
      void loadSession().catch(() => undefined);
      setRevision((value) => value + 1);
    };
    const t = setInterval(poll, 30_000);
    const visible = () => {
      if (!document.hidden) poll();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [loadSession]);
  useEffect(() => {
    if (!session?.expiresAt) return;
    const expiresAt = Date.parse(session.expiresAt);
    let timer: ReturnType<typeof setTimeout>;
    function checkExpiry() {
      const remaining = expiresAt - Date.now();
      if (remaining > 0) {
        // Browsers clamp delays longer than about 24.8 days to 1 ms.
        timer = setTimeout(checkExpiry, Math.min(remaining, 2_147_483_647));
        return;
      }
      setSelected(null);
      setData(null);
      void loadSession().catch(() => {
        setSession(null);
      });
    }
    checkExpiry();
    return () => clearTimeout(timer);
  }, [session?.expiresAt, loadSession]);
  useEffect(() => {
    try {
      localStorage.setItem("calendar-preferences", JSON.stringify(preferences));
    } catch {
      /* Browsing works without storage. */
    }
  }, [preferences]);
  useEffect(() => {
    const t = setTimeout(() => setSearch(query), 250);
    return () => clearTimeout(t);
  }, [query]);
  useEffect(() => {
    if (!session || !range) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      ...range,
      q: search,
      timeZone,
      filter,
      preview: String(preview),
    });
    void api<CalendarResponse>(`/api/calendar/events?${params}`, {
      signal: controller.signal,
    })
      .then((next) => {
        if (controller.signal.aborted) return;
        setData(next);
        setSelected((previous) =>
          previous
            ? next.events.find((event) => event.id === previous.id) || null
            : null,
        );
        if (
          next.role === "public" &&
          !next.fallback &&
          actualRole !== "public" &&
          !preview
        ) {
          setSelected(null);
          void loadSession();
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setError(error.message);
          setData(null);
          setSelected(null);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [
    range?.start,
    range?.end,
    session?.role,
    session?.settings.timeZone,
    timeZone,
    search,
    filter,
    preview,
    revision,
    loadSession,
  ]);
  useEffect(() => {
    const params = new URLSearchParams();
    params.set("view", view);
    if (anchorDate) params.set("date", anchorDate);
    if (search) params.set("q", search);
    if (filter !== "all") params.set("filter", filter);
    history.replaceState(null, "", `${location.pathname}?${params}`);
  }, [view, anchorDate, search, filter]);
  const changeView = useCallback((id: string) => {
    setView(id);
    calendar.current?.getApi().changeView(id);
    setSelected(null);
  }, []);
  const navigate = useCallback((direction: "prev" | "next" | "today") => {
    const instance = calendar.current?.getApi();
    if (!instance) return;
    instance[direction]();
    setSelected(null);
  }, []);
  useEffect(() => {
    function keyboard(event: KeyboardEvent) {
      if (
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        modal ||
        Boolean(document.querySelector("dialog[open]")) ||
        /^(INPUT|TEXTAREA|SELECT)$/.test(
          (event.target as HTMLElement).tagName,
        ) ||
        (event.target as HTMLElement).isContentEditable
      )
        return;
      const key = event.key.toLowerCase();
      if (
        ["arrowleft", "arrowright"].includes(key) &&
        (event.target as HTMLElement).closest(
          '.calendar-pan-frame[data-pannable="true"]',
        )
      )
        return;
      if (["+", "=", "-", "_", "0"].includes(key)) {
        event.preventDefault();
        setZoom(
          key === "0"
            ? 100
            : zoom +
                (["+", "="].includes(key)
                  ? CALENDAR_ZOOM_STEP
                  : -CALENDAR_ZOOM_STEP),
        );
        return;
      }
      if (key === "/" && effectiveRole !== "public") {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (key === "t") navigate("today");
      if (key === "arrowleft") {
        event.preventDefault();
        navigate("prev");
      }
      if (key === "arrowright") {
        event.preventDefault();
        navigate("next");
      }
      const target = views.find((view) => view.short.toLowerCase() === key);
      if (target) changeView(target.id);
      if (key === "?") setModal("help");
      if (key === "escape") setSelected(null);
    }
    document.addEventListener("keydown", keyboard);
    return () => document.removeEventListener("keydown", keyboard);
  }, [modal, effectiveRole, navigate, changeView, zoom, setZoom]);
  async function lock() {
    setData(null);
    setSelected(null);
    setActionError("");
    setQuery("");
    setSearch("");
    try {
      await post("/api/auth/logout");
      await loadSession();
      setRevision((value) => value + 1);
    } catch (error) {
      setActionError((error as Error).message);
      await loadSession().catch(() => setSession(null));
    }
  }
  async function settingsChanged() {
    await loadSession();
    setRevision((value) => value + 1);
  }
  function datesChanged(info: DatesSetInfo) {
    setHeading(info.view.title);
    setRange((previous) =>
      previous?.start === info.startStr && previous.end === info.endStr
        ? previous
        : { start: info.startStr, end: info.endStr },
    );
    const date = Temporal.Instant.from(info.view.currentStart.toISOString())
      .toZonedDateTimeISO(timeZone)
      .toPlainDate()
      .toString();
    setAnchorDate(date);
  }
  const calendarEvents = useMemo(
    () =>
      (data?.events || []).map((event) => ({
        id: event.id,
        title: event.title,
        start: event.start,
        end: event.end,
        allDay: event.allDay,
        extendedProps: { record: event },
        interactive: true,
      })),
    [data],
  );
  const today = dateInZone(timeZone);
  const isList = view.startsWith("list");
  const hasSource = Boolean(data?.status.configured);
  const available = Boolean(data?.status.available);
  const showEmpty =
    !loading && !error && available && data?.events.length === 0;
  const displayTitle = session?.settings.title || "William’s Calendar";
  return (
    <>
      <a className="skip-link" href="#calendar-main">
        Skip to calendar
      </a>
      <header className="masthead">
        <div className="masthead-inner">
          <a className="wordmark" href="/" aria-label={`${displayTitle}, home`}>
            <span className="brand-mark" aria-hidden="true">
              <CalendarDays size={21} strokeWidth={1.4} />
            </span>
            <span className="wordmark-text">{displayTitle}</span>
          </a>
          <nav className="masthead-actions" aria-label="Calendar access">
            <span className="access-label">
              {actualRole === "owner" ? (
                <ShieldCheck size={15} />
              ) : effectiveRole === "public" ? (
                <LockKeyhole size={15} />
              ) : (
                <LockKeyholeOpen size={15} />
              )}
              {actualRole === "owner"
                ? "Owner"
                : effectiveRole === "public"
                  ? "Availability only"
                  : "Details unlocked"}
            </span>
            <button
              className="icon-button help-button"
              aria-label="Keyboard shortcuts"
              onClick={() => setModal("help")}
            >
              <CircleHelp size={18} />
            </button>
            {actualRole === "owner" && (
              <button
                className="icon-button"
                aria-label="Owner calendar settings"
                onClick={() => setModal("settings")}
              >
                <Settings2 size={18} />
              </button>
            )}
            {actualRole !== "public" ? (
              <button
                className="button quiet lock-button"
                onClick={() => void lock()}
              >
                <LockKeyhole size={15} />
                {actualRole === "owner" ? "Sign out" : "Lock calendar"}
              </button>
            ) : (
              <button
                className="button primary unlock-button"
                onClick={() => setModal("viewer")}
                disabled={!session?.viewerEnabled}
                title={
                  !session?.viewerEnabled
                    ? "The owner has not enabled detailed viewing."
                    : undefined
                }
              >
                <LockKeyholeOpen size={15} />
                View details
                <ArrowUpRight size={15} />
              </button>
            )}
          </nav>
        </div>
      </header>
      <main id="calendar-main" className="app-shell">
        {initialError ? (
          <div className="fatal" role="alert">
            <AlertCircle size={28} />
            <h1>The calendar is unavailable.</h1>
            <p>{initialError}</p>
            <button
              className="button"
              onClick={() =>
                void loadSession().catch((error) =>
                  setInitialError(error.message),
                )
              }
            >
              Try again
            </button>
          </div>
        ) : !session ? (
          <div className="initial-loading" role="status">
            <div className="skeleton skeleton-title" />
            <div className="skeleton skeleton-calendar" />
            <span className="visually-hidden">Opening calendar…</span>
          </div>
        ) : (
          <>
            {preview && (
              <div className="preview-banner">
                <ShieldCheck size={16} />
                <span>You’re previewing public availability.</span>
                <button
                  className="text-button"
                  onClick={() => {
                    setPreview(false);
                    setData(null);
                  }}
                >
                  Return to owner view
                  <ArrowRight size={15} />
                </button>
              </div>
            )}
            <section className="page-heading" aria-label="Calendar overview">
              <div>
                <h1>{heading || "Calendar"}</h1>
                <p className="heading-context">
                  <span className="calendar-line" />
                  {effectiveRole === "public"
                    ? "A shared view of my time"
                    : "A closer look at the calendar"}
                </p>
              </div>
              <div className="local-time">
                <Clock3 size={15} />
                <span>
                  {new Intl.DateTimeFormat("en", {
                    timeZone,
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: preferences.hour12,
                  }).format(now)}
                </span>
                <span className="text-label">
                  {timeZone.replaceAll("_", " ")}
                </span>
              </div>
            </section>
            <div className="calendar-toolbar">
              <div className="date-navigation">
                <button
                  className="button quiet today-button"
                  onClick={() => navigate("today")}
                >
                  Today
                </button>
                <div className="navigation-arrows">
                  <button
                    className="icon-button"
                    aria-label="Previous period"
                    onClick={() => navigate("prev")}
                  >
                    <ChevronLeft size={20} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Next period"
                    onClick={() => navigate("next")}
                  >
                    <ChevronRight size={20} />
                  </button>
                </div>
                <label className="date-jump" title="Jump to date">
                  <CalendarDays size={16} />
                  <span className="visually-hidden">Jump to date</span>
                  <input
                    aria-label="Jump to date"
                    type="date"
                    value={anchorDate || today}
                    onChange={(event) => {
                      if (event.target.value) {
                        calendar.current?.getApi().gotoDate(event.target.value);
                        setSelected(null);
                      }
                    }}
                  />
                </label>
              </div>
              <div className="view-switcher" aria-label="Calendar view">
                {views.slice(0, 4).map((item) => (
                  <button
                    className={view === item.id ? "selected" : ""}
                    key={item.id}
                    onClick={() => changeView(item.id)}
                    aria-pressed={view === item.id}
                  >
                    {item.id === "listMonth" && <List size={15} />}
                    {item.label}
                  </button>
                ))}
                <label
                  className={`more-views ${["workWeek", "multiMonthYear"].includes(view) ? "selected" : ""}`}
                >
                  <span className="visually-hidden">More calendar views</span>
                  <select
                    aria-label="More calendar views"
                    value={
                      ["workWeek", "multiMonthYear"].includes(view) ? view : ""
                    }
                    onChange={(event) => {
                      if (event.target.value) changeView(event.target.value);
                    }}
                  >
                    <option value="" disabled>
                      More
                    </option>
                    <option value="workWeek">Work week</option>
                    <option value="multiMonthYear">Year</option>
                  </select>
                  <ChevronDown size={13} />
                </label>
              </div>
              <div className="toolbar-utilities">
                <div
                  className="calendar-zoom-controls"
                  role="group"
                  aria-label="Calendar zoom"
                >
                  <button
                    className="icon-button"
                    aria-label="Zoom out calendar"
                    title="Zoom out (-)"
                    disabled={zoom <= MIN_CALENDAR_ZOOM}
                    onClick={() => setZoom(zoom - CALENDAR_ZOOM_STEP)}
                  >
                    <ZoomOut size={18} />
                  </button>
                  <button
                    className="text-button zoom-reset"
                    aria-label={`Reset calendar zoom (${zoom}%)`}
                    title="Reset zoom (0)"
                    onClick={() => setZoom(100)}
                  >
                    <span aria-live="polite" aria-atomic="true">
                      {zoom}%
                    </span>
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Zoom in calendar"
                    title="Zoom in (+)"
                    disabled={zoom >= MAX_CALENDAR_ZOOM}
                    onClick={() => setZoom(zoom + CALENDAR_ZOOM_STEP)}
                  >
                    <ZoomIn size={18} />
                  </button>
                </div>
                <button
                  className="button quiet mobile-options-button"
                  aria-label="Calendar options"
                  onClick={() => setModal("options")}
                >
                  <MoreHorizontal size={20} /> Options
                </button>
                <button
                  className="icon-button desktop-utility"
                  aria-label="Display preferences"
                  title="Display preferences"
                  onClick={() => setModal("preferences")}
                >
                  <SlidersHorizontal size={18} />
                </button>
                <button
                  className="icon-button desktop-utility"
                  aria-label="Print calendar"
                  title="Print calendar"
                  onClick={() => window.print()}
                >
                  <Printer size={18} />
                </button>
              </div>
            </div>
            <div className="calendar-context">
              <div className="context-left">
                <span className="legend-mark" aria-hidden="true" />
                <span>
                  {effectiveRole === "public"
                    ? "Busy times"
                    : "Events & availability"}
                </span>
                {effectiveRole === "public" && (
                  <span className="context-hint">
                    Event details are private
                  </span>
                )}
              </div>
              <div className="context-right">
                <button
                  className="text-button zone-button"
                  onClick={() => setModal("preferences")}
                >
                  <Globe2 size={14} />
                  {timeZone.split("/").at(-1)?.replaceAll("_", " ")}
                  <ChevronDown size={12} />
                </button>
                <button
                  className="icon-button refresh-button"
                  title="Reload calendar"
                  aria-label="Reload calendar"
                  onClick={() => {
                    setRevision((value) => value + 1);
                    void loadSession();
                  }}
                  disabled={loading}
                >
                  <RefreshCw size={15} className={loading ? "spinning" : ""} />
                </button>
              </div>
            </div>
            {effectiveRole !== "public" && (
              <form
                className="search-row"
                onSubmit={(event) => event.preventDefault()}
              >
                <label className="search-field">
                  <Search size={17} />
                  <span className="visually-hidden">Search events</span>
                  <input
                    ref={searchRef}
                    aria-label="Search events"
                    type="search"
                    placeholder="Search names, places, or people"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    maxLength={256}
                  />
                  <kbd>/</kbd>
                </label>
                <label className="status-filter">
                  <Filter size={15} />
                  <span className="visually-hidden">Filter events</span>
                  <select
                    aria-label="Filter events"
                    value={filter}
                    onChange={(event) => setFilter(event.target.value)}
                  >
                    <option value="all">All events</option>
                    <option value="busy">Busy</option>
                    <option value="free">Available</option>
                    <option value="tentative">Tentative</option>
                  </select>
                </label>
              </form>
            )}
            {(error || actionError) && (
              <div className="notice error" role="alert">
                <AlertCircle size={17} />
                <span>{error || actionError}</span>
                <button
                  className="text-button"
                  onClick={() => {
                    setActionError("");
                    setRevision((value) => value + 1);
                  }}
                >
                  Try again
                </button>
              </div>
            )}
            {data?.fallback && (
              <div className="notice">
                <LockKeyhole size={16} />
                <span>
                  Detailed events are unavailable. Showing public availability.
                </span>
              </div>
            )}
            {data?.status.stale && (
              <div className="notice">
                <AlertCircle size={16} />
                <span>
                  Updates are delayed. Showing the last successful calendar
                  snapshot.
                </span>
              </div>
            )}
            {isPannableWeek && (
              <p className="calendar-pan-hint">
                Swipe sideways for more days. Pinch to stretch events.
              </p>
            )}
            <div
              className={`calendar-layout ${selected && !compactDetails ? "with-details" : ""}`}
            >
              <section
                ref={calendarSheet}
                className={`calendar-sheet ${view === "multiMonthYear" ? "year-sheet" : ""} ${!loading && !available && !isList ? "unavailable" : ""}`}
                data-zoom={zoom}
                data-expanded={zoom > 100}
                data-timeline={isTimeline}
                style={{ "--calendar-zoom": zoom / 100 } as CSSProperties}
                aria-label={`${views.find((v) => v.id === view)?.label} calendar`}
                aria-busy={loading}
              >
                {loading && (
                  <div className="loading-line" role="status">
                    <span className="visually-hidden">Loading calendar…</span>
                  </div>
                )}
                <div
                  className="calendar-pan-frame"
                  onScroll={(event) =>
                    event.currentTarget.style.setProperty(
                      "--calendar-pan-offset",
                      `${event.currentTarget.scrollLeft}px`,
                    )
                  }
                  data-pannable={isPannableWeek}
                  tabIndex={isPannableWeek ? 0 : undefined}
                  role={isPannableWeek ? "region" : undefined}
                  aria-label={
                    isPannableWeek ? "Scrollable week calendar" : undefined
                  }
                >
                  <FullCalendar
                    ref={calendar}
                    plugins={plugins}
                    initialView={view}
                    initialDate={anchorDate || today}
                    views={{
                      workWeek: { type: "timeGridWeek", hiddenDays: [0, 6] },
                    }}
                    headerToolbar={false}
                    events={calendarEvents}
                    timeZone={timeZone}
                    firstDay={weekStart}
                    weekends={preferences.weekends}
                    nowIndicator
                    displayEventTime
                    displayEventEnd
                    navLinks
                    now={now}
                    editable={false}
                    selectable={false}
                    datesSet={datesChanged}
                    height={
                      view === "multiMonthYear" || isList
                        ? "auto"
                        : isTimeline
                          ? isPhone
                            ? 560
                            : 650
                          : Math.round((650 * zoom) / 100)
                    }
                    slotMinHeight={Math.round((32 * zoom) / 100)}
                    eventMinHeight={18}
                    eventShortHeight={42}
                    scrollTimeReset={false}
                    singleMonthMinWidth={
                      isPhone ? 250 : Math.round((320 * zoom) / 100)
                    }
                    dayCellInnerClass="calendar-day-inner"
                    dayMaxEvents={zoom > 100 ? false : zoom === 100 ? 3 : true}
                    fixedWeekCount={false}
                    businessHours={{
                      daysOfWeek: [1, 2, 3, 4, 5],
                      startTime: session.settings.workStart,
                      endTime: session.settings.workEnd,
                    }}
                    scrollTime={`${session.settings.workStart}:00`}
                    eventTimeFormat={{
                      hour: "numeric",
                      minute: "2-digit",
                      hour12: preferences.hour12,
                    }}
                    slotHeaderFormat={{
                      hour: "numeric",
                      minute: "2-digit",
                      hour12: preferences.hour12,
                    }}
                    eventClick={(info) => {
                      const event = data?.events.find(
                        (event) => event.id === info.event.id,
                      );
                      if (event) setSelected(event);
                    }}
                    dateClick={(info) => {
                      calendar.current
                        ?.getApi()
                        .changeView("timeGridDay", info.dateStr);
                      setView("timeGridDay");
                    }}
                    eventClass={(info) =>
                      [
                        "calendar-event",
                        info.event.extendedProps.record?.redacted
                          ? "busy-event"
                          : "detail-event",
                        !info.event.extendedProps.record?.redacted &&
                        info.event.extendedProps.record?.availability === "free"
                          ? "free-event"
                          : "",
                        info.event.id === selected?.id ? "event-selected" : "",
                      ].join(" ")
                    }
                    dayCellClass="calendar-day"
                    dayCellTopClass="calendar-day-top"
                    dayCellTopInnerClass="calendar-day-number"
                    dayHeaderClass="calendar-day-header"
                    slotHeaderClass="calendar-slot-header"
                    allDayHeaderClass="calendar-all-day-header"
                    tableClass="calendar-table"
                    listItemEventClass="calendar-agenda-event"
                    singleMonthClass="calendar-year-month"
                    singleMonthHeaderClass="calendar-year-header"
                    eventBeforeClass="calendar-event-before"
                    eventInnerClass="calendar-event-inner"
                    eventContent={(info) => (
                      <CalendarEventContent
                        info={info}
                        timeZone={timeZone}
                        hour12={preferences.hour12}
                        expanded={zoom >= 150}
                      />
                    )}
                    noEventsContent={() => (
                      <div className="agenda-empty">
                        <CalendarDays size={28} strokeWidth={1.3} />
                        <h2>
                          {!hasSource
                            ? "The calendar is taking shape."
                            : !available
                              ? "Calendar data is unavailable."
                              : search || filter !== "all"
                                ? "No matching events."
                                : "A little room in the schedule."}
                        </h2>
                        <p>
                          {!hasSource
                            ? "The owner hasn’t connected this calendar source yet."
                            : !available
                              ? "The source has not completed a successful sync."
                              : search || filter !== "all"
                                ? "Try a different search or filter."
                                : "There are no events in this date range."}
                        </p>
                      </div>
                    )}
                  />
                </div>
                {!loading &&
                  !error &&
                  (!hasSource || !available) &&
                  !isList && (
                    <div className="calendar-empty-overlay">
                      <div>
                        <CalendarDays size={30} strokeWidth={1.2} />
                        <h2>
                          {!hasSource
                            ? "The calendar is taking shape."
                            : "Waiting for the calendar."}
                        </h2>
                        <p>
                          {!hasSource
                            ? "A source hasn’t been connected yet."
                            : "Availability will appear after a successful sync."}
                        </p>
                        {actualRole === "owner" ? (
                          <button
                            className="button quiet"
                            onClick={() => setModal("settings")}
                          >
                            Connect a calendar
                            <LinkArrow />
                          </button>
                        ) : (
                          <button
                            className="text-button"
                            onClick={() => setModal("owner")}
                          >
                            Owner sign-in
                            <ArrowUpRight size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                {showEmpty && !isList && (
                  <div className="empty-caption">
                    {search || filter !== "all"
                      ? "No events match this search or filter."
                      : "No events in this date range."}
                    {(search || filter !== "all") && (
                      <button
                        className="text-button"
                        onClick={() => {
                          setQuery("");
                          setSearch("");
                          setFilter("all");
                        }}
                      >
                        Clear filters
                      </button>
                    )}
                  </div>
                )}
              </section>
              {selected && (
                <EventDetails
                  key={selected.id}
                  event={selected}
                  timeZone={timeZone}
                  hour12={preferences.hour12}
                  onClose={() => setSelected(null)}
                  compact={compactDetails}
                  onUnlock={() => {
                    setSelected(null);
                    setModal("viewer");
                  }}
                  canUnlock={actualRole === "public" && session.viewerEnabled}
                />
              )}
            </div>
            <footer className="calendar-footer">
              <div>
                <span className="footer-mark" aria-hidden="true" />
                <span>
                  {data?.status.lastSuccess
                    ? `Updated ${new Intl.DateTimeFormat("en", { timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: preferences.hour12 }).format(new Date(data.status.lastSuccess))}`
                    : "Waiting for the first calendar sync"}
                </span>
                {data?.status.stale && <span>Updates delayed</span>}
              </div>
              <div>
                <span>Read-only calendar</span>
                <span className="footer-separator" />
                <button
                  className="text-button"
                  onClick={() =>
                    actualRole === "owner"
                      ? setModal("settings")
                      : setModal("owner")
                  }
                >
                  {actualRole === "owner" ? "Manage calendar" : "Owner sign-in"}
                  <ArrowUpRight size={13} />
                </button>
              </div>
            </footer>
          </>
        )}
      </main>
      {(modal === "owner" || modal === "viewer") && (
        <Login
          owner={modal === "owner"}
          onClose={() => setModal(null)}
          onLogin={async () => {
            setData(null);
            setSelected(null);
            await loadSession();
            setModal(modal === "owner" ? "settings" : null);
            setRevision((value) => value + 1);
          }}
        />
      )}
      {modal === "settings" && actualRole === "owner" && (
        <Settings
          onClose={() => setModal(null)}
          onChange={settingsChanged}
          onPreview={() => {
            setModal(null);
            setData(null);
            setSelected(null);
            setPreview(true);
            setQuery("");
            setSearch("");
            setFilter("all");
          }}
        />
      )}
      {modal === "options" && (
        <Dialog title="Calendar options" onClose={() => setModal(null)}>
          <div className="dialog-body mobile-options-body">
            <label className="form-stack">
              Go to date
              <input
                type="date"
                aria-label="Go to date"
                value={anchorDate || today}
                onChange={(event) => {
                  if (event.target.value) {
                    calendar.current?.getApi().gotoDate(event.target.value);
                    setSelected(null);
                    setModal(null);
                  }
                }}
              />
            </label>
            <p className="options-hint">
              Pinch the calendar to stretch events, or use the zoom buttons
              below.
            </p>
            <button
              className="button quiet full-width"
              onClick={() => setModal("preferences")}
            >
              <SlidersHorizontal size={18} /> Display preferences
            </button>
            <button
              className="button quiet full-width"
              onClick={() => setModal("help")}
            >
              <CircleHelp size={18} /> Gestures & keyboard shortcuts
            </button>
            <button
              className="button quiet full-width"
              onClick={() => {
                setModal(null);
                setRevision((value) => value + 1);
                void loadSession();
              }}
            >
              <RefreshCw size={18} /> Reload calendar
            </button>
            <button
              className="button quiet full-width"
              onClick={() =>
                setModal(actualRole === "owner" ? "settings" : "owner")
              }
            >
              <Settings2 size={18} />{" "}
              {actualRole === "owner" ? "Manage calendar" : "Owner sign-in"}
            </button>
          </div>
        </Dialog>
      )}
      {modal === "help" && (
        <Dialog title="Make yourself at home" onClose={() => setModal(null)}>
          <div className="dialog-body">
            <p className="dialog-intro">
              A few shortcuts for finding your way around.
            </p>
            <dl className="shortcut-list">
              {[
                ["T", "Go to today"],
                ["← / →", "Previous / next period"],
                ["M / W / D", "Month / week / day"],
                ["A / Y", "Agenda / year"],
                ["/", "Search detailed events"],
                ["Esc", "Close event details"],
                ["?", "Open this guide"],
                ["+ / −", "Zoom calendar in / out"],
                ["0", "Reset calendar zoom"],
              ].map(([key, label]) => (
                <div key={key}>
                  <dt>{label}</dt>
                  <dd>
                    <kbd>{key}</kbd>
                  </dd>
                </div>
              ))}
            </dl>
            <p className="fine-print">
              Pinch over the calendar, or hold Ctrl/Cmd while scrolling, to
              zoom.
            </p>
            <p className="fine-print">
              Events are managed in the original calendars. This website is a
              shared, read-only view.
            </p>
          </div>
        </Dialog>
      )}
      {modal === "preferences" && (
        <Dialog title="Your calendar view" onClose={() => setModal(null)}>
          <div className="dialog-body form-stack">
            <p className="dialog-intro">
              These display preferences stay in this browser.
            </p>
            <label htmlFor="viewer-zone">Display time zone</label>
            <select
              id="viewer-zone"
              value={timeZone}
              onChange={(event) => {
                setPreferences((old) => ({
                  ...old,
                  timeZone: event.target.value,
                }));
                setSelected(null);
              }}
            >
              <option value={session?.settings.timeZone || "Asia/Shanghai"}>
                Calendar time ({session?.settings.timeZone || "Asia/Shanghai"})
              </option>
              <option value={Intl.DateTimeFormat().resolvedOptions().timeZone}>
                Your local time (
                {Intl.DateTimeFormat().resolvedOptions().timeZone})
              </option>
              {Intl.supportedValuesOf("timeZone")
                .filter(
                  (zone) =>
                    zone !== session?.settings.timeZone &&
                    zone !== Intl.DateTimeFormat().resolvedOptions().timeZone,
                )
                .map((zone) => (
                  <option key={zone} value={zone}>
                    {zone.replaceAll("_", " ")}
                  </option>
                ))}
            </select>
            <label htmlFor="viewer-week-start">Week starts on</label>
            <select
              id="viewer-week-start"
              value={weekStart}
              onChange={(event) =>
                setPreferences((old) => ({
                  ...old,
                  weekStart: Number(event.target.value),
                }))
              }
            >
              {[
                "Sunday",
                "Monday",
                "Tuesday",
                "Wednesday",
                "Thursday",
                "Friday",
                "Saturday",
              ].map((day, index) => (
                <option key={day} value={index}>
                  {day}
                </option>
              ))}
            </select>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={preferences.hour12}
                onChange={(event) =>
                  setPreferences((old) => ({
                    ...old,
                    hour12: event.target.checked,
                  }))
                }
              />
              <span>Use 12-hour time</span>
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={preferences.weekends}
                onChange={(event) =>
                  setPreferences((old) => ({
                    ...old,
                    weekends: event.target.checked,
                  }))
                }
              />
              <span>Show weekends</span>
            </label>
            <button
              className="button quiet"
              onClick={() =>
                setPreferences({ hour12: false, weekends: true, zoom: 100 })
              }
            >
              Reset display preferences
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
function LinkArrow() {
  return <ArrowUpRight size={16} />;
}

function CalendarEventContent({
  info,
  timeZone,
  hour12,
  expanded,
}: {
  info: EventDisplayInfo;
  timeZone: string;
  hour12: boolean;
  expanded: boolean;
}) {
  const record = info.event.extendedProps.record as CalendarEvent | undefined;
  const compact =
    ["timeGridDay", "timeGridWeek", "workWeek"].includes(info.view.type) &&
    info.isShort;
  const formatter = new Intl.DateTimeFormat("en", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12,
  });
  const start =
    record && !record.allDay ? formatter.format(new Date(record.start)) : "";
  const end =
    record && !record.allDay ? formatter.format(new Date(record.end)) : "";
  const label = `${info.event.title}${start ? `, ${start} – ${end}` : ", all day"}`;
  return (
    <div
      className={`event-content ${info.view.type === "dayGridMonth" ? "month-event-content" : ""} ${compact ? "compact-event-content" : ""}`}
      title={label}
    >
      {start && !compact && (
        <span className="event-time">
          <time dateTime={record?.start}>{start}</time>
          <span className="time-separator">to</span>
          <time dateTime={record?.end}>{end}</time>
        </span>
      )}
      <span className="event-title">{info.event.title}</span>
      {expanded && !compact && record && !record.redacted && (
        <>
          {record.location && (
            <span className="event-preview event-location">
              {record.location}
            </span>
          )}
          {record.description && (
            <span className="event-preview event-description-preview">
              {record.description}
            </span>
          )}
        </>
      )}
      {record?.redacted && <LockKeyhole size={11} className="event-lock" />}
    </div>
  );
}
