import { useEffect, useState, type FormEvent } from "react";
import {
  RefreshCw,
  Link2,
  ArrowUpRight,
  Trash2,
  Shield,
  Check,
  AlertCircle,
  Settings2,
  LockKeyhole,
} from "lucide-react";
import type {
  CalendarSettings,
  SourceInfo,
  SourceInput,
} from "../../shared/types";
import { api, post, put } from "../api";
import { Dialog } from "./Dialog";
interface OwnerData {
  settings: CalendarSettings;
  sources: SourceInfo[];
  viewerEnabled: boolean;
}
function SourceEditor({
  source,
  onChange,
}: {
  source: SourceInfo;
  onChange: () => Promise<void>;
}) {
  const [url, setUrl] = useState(source.url);
  const [username, setUsername] = useState(source.username);
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const kind = source.kind;
  const input: SourceInput = {
    url,
    username,
    password,
    keepPassword: !password,
  };
  async function act(action: "test" | "save" | "refresh" | "remove") {
    if (
      action === "remove" &&
      !window.confirm(
        `Remove the ${kind === "busy" ? "busy-only" : "detailed"} source and its cached events?`,
      )
    )
      return;
    setPending(action);
    setError("");
    setMessage("");
    try {
      if (action === "remove") {
        await api(`/api/owner/sources/${kind}`, { method: "DELETE" });
        setUrl("");
        setUsername("");
        setPassword("");
        setMessage("Source removed.");
      } else if (action === "refresh") {
        const result = await post<SourceInfo>(
          `/api/owner/sources/${kind}/refresh`,
        );
        if (result.error) throw new Error(result.error);
        setMessage("Source refreshed.");
      } else {
        const result = await post<{ message?: string; eventCount: number }>(
          `/api/owner/sources/${kind}/${action}`,
          input,
        );
        setMessage(
          action === "test"
            ? `${result.message} ${result.eventCount} calendar records.`
            : "Source saved and synchronized.",
        );
        if (action === "save") setPassword("");
      }
      await onChange();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setPending("");
    }
  }
  return (
    <section className="settings-section">
      <div className="section-heading">
        <h3>{kind === "busy" ? "Public availability" : "Detailed calendar"}</h3>
        <span className="status-tag">
          {source.configured ? "Connected" : "Not configured"}
        </span>
      </div>
      <p className="settings-description">
        {kind === "busy"
          ? "Your busy-only ICS subscription. Visitors receive anonymous busy intervals, even if this source includes extra information."
          : "Your full ICS subscription. Details are available after the website password; upstream private events remain hidden from visitors."}
      </p>
      <form
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          void act("save");
        }}
      >
        <label htmlFor={`${kind}-url`}>ICS subscription URL</label>
        <input
          id={`${kind}-url`}
          type="text"
          inputMode="url"
          placeholder="https://calendar.example.com/calendar.ics"
          autoComplete="off"
          spellCheck={false}
          value={url}
          onChange={(event) => {
            setUrl(event.target.value);
            setMessage("");
          }}
          required
          maxLength={4096}
          aria-describedby={`${kind}-help`}
        />
        <p id={`${kind}-help`} className="text-label">
          HTTPS, HTTP, and webcal links are supported. URLs are stored
          encrypted.
        </p>
        <details className="credential-disclosure">
          <summary>
            Upstream HTTP Basic authentication{" "}
            <span className="text-label">Optional</span>
          </summary>
          <div className="field-grid">
            <div className="field">
              <label htmlFor={`${kind}-username`}>Upstream username</label>
              <input
                id={`${kind}-username`}
                value={username}
                autoComplete="off"
                onChange={(event) => setUsername(event.target.value)}
                maxLength={256}
              />
            </div>
            <div className="field">
              <label htmlFor={`${kind}-password`}>Upstream password</label>
              <input
                id={`${kind}-password`}
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={
                  source.hasPassword
                    ? "Saved; leave blank to keep"
                    : "Optional password"
                }
                maxLength={1024}
              />
            </div>
          </div>
        </details>
        <div className="button-row">
          <button
            className="button"
            disabled={Boolean(pending)}
            aria-busy={pending === "save"}
          >
            {pending === "save" ? "Saving…" : "Save source"}
            <ArrowUpRight size={15} />
          </button>
          <button
            type="button"
            className="button quiet"
            disabled={Boolean(pending)}
            onClick={() => void act("test")}
          >
            {pending === "test" ? "Testing…" : "Test connection"}
          </button>
          {source.configured && (
            <>
              <button
                type="button"
                className="icon-button"
                title="Refresh source"
                aria-label={`Refresh ${kind} source`}
                disabled={Boolean(pending)}
                onClick={() => void act("refresh")}
              >
                <RefreshCw
                  size={17}
                  className={pending === "refresh" ? "spinning" : ""}
                />
              </button>
              <button
                type="button"
                className="icon-button"
                title="Remove source"
                aria-label={`Remove ${kind} source`}
                disabled={Boolean(pending)}
                onClick={() => void act("remove")}
              >
                <Trash2 size={17} />
              </button>
            </>
          )}
        </div>
      </form>
      <div className="source-meta">
        <span>
          {source.lastSuccess
            ? `Last synced ${new Date(source.lastSuccess).toLocaleString()}`
            : "No successful sync yet"}
        </span>
        {source.configured && <span>{source.eventCount} calendar records</span>}
      </div>
      {source.error && !error && (
        <p className="inline-feedback error">
          <AlertCircle size={16} />
          {source.error}
        </p>
      )}
      {(error || message) && (
        <p
          className={`inline-feedback ${error ? "error" : "success"}`}
          role={error ? "alert" : "status"}
        >
          {error ? <AlertCircle size={16} /> : <Check size={16} />}
          {error || message}
        </p>
      )}
    </section>
  );
}
export function Settings({
  onClose,
  onChange,
  onPreview,
}: {
  onClose: () => void;
  onChange: () => Promise<void>;
  onPreview: () => void;
}) {
  const [data, setData] = useState<OwnerData | null>(null);
  const [tab, setTab] = useState("sources");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [ownerPassword, setOwnerPassword] = useState("");
  async function reload() {
    const next = await api<OwnerData>("/api/owner/settings");
    setData(next);
  }
  useEffect(() => {
    void reload().catch((error) => setError(error.message));
  }, []);
  async function changed() {
    await reload();
    await onChange();
  }
  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      await put("/api/owner/settings", {
        title: form.get("title"),
        timeZone: form.get("timeZone"),
        weekStart: Number(form.get("weekStart")),
        workStart: form.get("workStart"),
        workEnd: form.get("workEnd"),
        refreshMinutes: Number(form.get("refreshMinutes")),
      });
      await changed();
      setMessage("Calendar settings saved.");
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setPending(false);
    }
  }
  async function changePassword(event: FormEvent, target: "owner" | "viewer") {
    event.preventDefault();
    setPending(true);
    setError("");
    setMessage("");
    try {
      const result = await put<{ message: string }>(
        `/api/owner/passwords/${target}`,
        {
          password: target === "owner" ? ownerPassword : newPassword,
          currentPassword,
        },
      );
      setMessage(result.message);
      setNewPassword("");
      setOwnerPassword("");
      setCurrentPassword("");
      if (target === "owner") {
        await onChange();
        onClose();
      } else await changed();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setPending(false);
    }
  }
  async function disableDetails() {
    if (
      !window.confirm(
        "Disable detailed viewing and revoke all visitor sessions?",
      )
    )
      return;
    setPending(true);
    setError("");
    setMessage("");
    try {
      await api("/api/owner/passwords/viewer", { method: "DELETE" });
      await changed();
      setMessage("Detailed viewing disabled.");
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setPending(false);
    }
  }
  return (
    <Dialog title="Calendar settings" onClose={onClose} wide>
      <nav className="settings-tabs" aria-label="Settings sections">
        {[
          { id: "sources", label: "Calendar sources", icon: Link2 },
          { id: "display", label: "Preferences", icon: Settings2 },
          { id: "access", label: "Access & security", icon: Shield },
        ].map((item) => (
          <button
            key={item.id}
            className={tab === item.id ? "active" : ""}
            aria-current={tab === item.id ? "page" : undefined}
            onClick={() => {
              setTab(item.id);
              setError("");
              setMessage("");
            }}
          >
            <item.icon size={16} />
            {item.label}
          </button>
        ))}
      </nav>
      <div className="settings-body">
        {!data ? (
          <div className="loading-block" role="status">
            {error || "Loading settings…"}
            {error && (
              <button
                className="button quiet"
                onClick={() => {
                  setError("");
                  void reload().catch((error) => setError(error.message));
                }}
              >
                Try again
              </button>
            )}
          </div>
        ) : (
          <>
            {tab === "sources" && (
              <>
                <div className="settings-intro">
                  <p>Two sources. One shared calendar.</p>
                  <span className="text-label">
                    The website switches sources when a visitor opens details.
                  </span>
                </div>
                {data.sources.map((source) => (
                  <SourceEditor
                    key={source.kind}
                    source={source}
                    onChange={changed}
                  />
                ))}
                <button className="button quiet" onClick={onPreview}>
                  Preview public view
                  <ArrowUpRight size={16} />
                </button>
              </>
            )}
            {tab === "display" && (
              <form
                onSubmit={saveSettings}
                className="form-stack"
                key={JSON.stringify(data.settings)}
              >
                <label htmlFor="calendar-title">Calendar title</label>
                <input
                  id="calendar-title"
                  name="title"
                  defaultValue={data.settings.title}
                  maxLength={80}
                  required
                />
                <label htmlFor="owner-zone">Calendar time zone</label>
                <input
                  id="owner-zone"
                  name="timeZone"
                  list="owner-time-zones"
                  defaultValue={data.settings.timeZone}
                  required
                />
                <datalist id="owner-time-zones">
                  {Intl.supportedValuesOf("timeZone").map((zone) => (
                    <option key={zone} value={zone} />
                  ))}
                </datalist>
                <p className="text-label">
                  Used for floating event times and default display. Visitors
                  can choose their own zone.
                </p>
                <div className="field-grid">
                  <div className="field">
                    <label htmlFor="week-start">Week starts on</label>
                    <select
                      id="week-start"
                      name="weekStart"
                      defaultValue={data.settings.weekStart}
                    >
                      {[
                        "Sunday",
                        "Monday",
                        "Tuesday",
                        "Wednesday",
                        "Thursday",
                        "Friday",
                        "Saturday",
                      ].map((day, i) => (
                        <option key={day} value={i}>
                          {day}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="refresh-minutes">
                      Refresh interval (minutes)
                    </label>
                    <input
                      id="refresh-minutes"
                      name="refreshMinutes"
                      type="number"
                      min={1}
                      max={1440}
                      defaultValue={data.settings.refreshMinutes}
                      required
                    />
                  </div>
                </div>
                <div className="field-grid">
                  <div className="field">
                    <label htmlFor="work-start">Working hours start</label>
                    <input
                      id="work-start"
                      name="workStart"
                      type="time"
                      defaultValue={data.settings.workStart}
                      required
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="work-end">Working hours end</label>
                    <input
                      id="work-end"
                      name="workEnd"
                      type="time"
                      defaultValue={data.settings.workEnd}
                      required
                    />
                  </div>
                </div>
                <div>
                  <button
                    className="button primary"
                    disabled={pending}
                    aria-busy={pending}
                  >
                    {pending ? "Saving…" : "Save preferences"}
                  </button>
                </div>
              </form>
            )}
            {tab === "access" && (
              <>
                <section className="settings-section">
                  <div className="section-heading">
                    <h3>Visitor access</h3>
                    <span className="status-tag">
                      {data.viewerEnabled ? "Enabled" : "Disabled"}
                    </span>
                  </div>
                  <p className="settings-description">
                    Anyone can see busy times. Share this password with people
                    who may see details. Changing it ends existing viewer
                    sessions.
                  </p>
                  <form
                    className="form-stack"
                    onSubmit={(event) => void changePassword(event, "viewer")}
                  >
                    <label htmlFor="viewer-password">
                      New shared calendar password
                    </label>
                    <input
                      id="viewer-password"
                      type="password"
                      autoComplete="new-password"
                      minLength={12}
                      maxLength={256}
                      required
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                    />
                    <p className="text-label">
                      At least 12 characters. Separate from upstream feed
                      credentials.
                    </p>
                    <div className="button-row">
                      <button className="button" disabled={pending}>
                        Set viewer password
                        <LockKeyhole size={16} />
                      </button>
                      {data.viewerEnabled && (
                        <button
                          type="button"
                          className="button quiet"
                          onClick={() => void disableDetails()}
                          disabled={pending}
                        >
                          Disable detailed viewing
                        </button>
                      )}
                    </div>
                  </form>
                </section>
                <section className="settings-section">
                  <h3>Owner password</h3>
                  <p className="settings-description">
                    Changing your password signs out all owner sessions,
                    including this one.
                  </p>
                  <form
                    className="form-stack"
                    onSubmit={(event) => void changePassword(event, "owner")}
                  >
                    <label htmlFor="current-password">
                      Current owner password
                    </label>
                    <input
                      id="current-password"
                      type="password"
                      autoComplete="current-password"
                      required
                      value={currentPassword}
                      maxLength={256}
                      onChange={(event) =>
                        setCurrentPassword(event.target.value)
                      }
                    />
                    <label htmlFor="new-owner-password">
                      New owner password
                    </label>
                    <input
                      id="new-owner-password"
                      type="password"
                      autoComplete="new-password"
                      minLength={12}
                      maxLength={256}
                      required
                      value={ownerPassword}
                      onChange={(event) => setOwnerPassword(event.target.value)}
                    />
                    <div>
                      <button className="button quiet" disabled={pending}>
                        Change owner password
                      </button>
                    </div>
                  </form>
                </section>
              </>
            )}
            {(error || message) && (
              <p
                className={`inline-feedback ${error ? "error" : "success"}`}
                role={error ? "alert" : "status"}
              >
                {error ? <AlertCircle size={16} /> : <Check size={16} />}
                {error || message}
              </p>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
