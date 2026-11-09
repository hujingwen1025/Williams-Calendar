import type { CalendarResponse as ParsedCalendar } from "node-ical";
import type {
  CalendarResponse,
  Role,
  SourceInfo,
  SourceInput,
  SourceKind,
  SyncStatus,
} from "../shared/types.js";
import { Store, type SourceCredentials } from "./db.js";
import { digest, encrypt } from "./security.js";
import {
  createDownloader,
  normalizeSourceUrl,
  type Download,
  type Downloader,
} from "./fetch-source.js";
import { expandCalendar, parseCalendar } from "./calendar.js";
export class SyncService {
  private locks = new Map<SourceKind, Promise<unknown>>();
  private parsed = new Map<
    SourceKind,
    { hash: string; calendar: ParsedCalendar }
  >();
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  constructor(
    readonly store: Store,
    private download: Downloader = createDownloader(
      store.config.allowPrivateSources,
    ),
  ) {}
  status(kind: SourceKind): SyncStatus {
    const row = this.store.source(kind);
    const threshold = this.store.settings().refreshMinutes * 60_000 * 2;
    return {
      configured: Boolean(row.config),
      lastSuccess: row.last_success,
      syncing: this.locks.has(kind),
      available: row.snapshot !== null,
      stale: Boolean(
        row.snapshot !== null &&
        (row.error ||
          !row.last_success ||
          Date.now() - Date.parse(row.last_success) > threshold),
      ),
    };
  }
  info(kind: SourceKind): SourceInfo {
    const row = this.store.source(kind);
    const creds = this.store.credentials(kind);
    return {
      ...this.status(kind),
      kind,
      url: creds?.url || "",
      username: creds?.username || "",
      hasPassword: Boolean(creds?.password),
      error: row.error,
      lastAttempt: row.last_attempt,
      eventCount: row.event_count,
    };
  }
  private async locked<T>(
    kind: SourceKind,
    task: () => Promise<T>,
  ): Promise<T> {
    const previous = this.locks.get(kind);
    const next = (async () => {
      if (previous) await previous.catch(() => undefined);
      return task();
    })();
    this.locks.set(kind, next);
    try {
      return await next;
    } finally {
      if (this.locks.get(kind) === next) this.locks.delete(kind);
    }
  }
  private credentials(kind: SourceKind, input: SourceInput): SourceCredentials {
    const old = this.store.credentials(kind);
    const url = normalizeSourceUrl(input.url.trim());
    const username = input.username || "";
    const password =
      input.keepPassword && old?.url === url && old.username === username
        ? old.password
        : input.password || "";
    if (username && !password)
      throw new Error("Enter the upstream password for this username.");
    return { url, username, password };
  }
  async test(kind: SourceKind, input: SourceInput) {
    const result = await this.download(this.credentials(kind, input));
    const parsed = await parseCalendar(
      result.text || "",
      this.store.settings().timeZone,
    );
    return {
      eventCount: Object.values(parsed).filter(
        (x) => x?.type === "VEVENT" || x?.type === "VFREEBUSY",
      ).length,
      message: "The source returned a valid calendar.",
    };
  }
  async replace(kind: SourceKind, input: SourceInput) {
    return this.locked(kind, async () => {
      const credentials = this.credentials(kind, input);
      const downloaded = await this.download(credentials);
      const parsed = await parseCalendar(
        downloaded.text || "",
        this.store.settings().timeZone,
      );
      this.commit(kind, credentials, downloaded, parsed);
      return this.info(kind);
    });
  }
  private commit(
    kind: SourceKind,
    credentials: SourceCredentials,
    downloaded: Download,
    parsed: ParsedCalendar,
  ) {
    const now = new Date().toISOString();
    const records = Object.entries(parsed).filter(
      ([, c]) => c?.type === "VEVENT" || c?.type === "VFREEBUSY",
    );
    this.store.db.transaction(() => {
      this.store.db
        .prepare(
          `UPDATE sources SET config=?, snapshot=?, etag=?, modified=?, last_success=?, last_attempt=?, error=NULL, event_count=?, revision=revision+1 WHERE kind=?`,
        )
        .run(
          encrypt(this.store.config.encryptionKey, JSON.stringify(credentials)),
          downloaded.text,
          downloaded.etag,
          downloaded.modified,
          now,
          now,
          records.length,
          kind,
        );
      this.store.db
        .prepare("DELETE FROM calendar_records WHERE source=?")
        .run(kind);
      const insert = this.store.db.prepare(
        "INSERT INTO calendar_records(source,uid,type,start,end) VALUES (?,?,?,?,?)",
      );
      for (const [uid, record] of records) {
        if (
          !record ||
          (record.type !== "VEVENT" && record.type !== "VFREEBUSY")
        )
          continue;
        insert.run(
          kind,
          uid,
          record.type,
          record.start?.toISOString() || null,
          record.end?.toISOString() || null,
        );
      }
    })();
    this.parsed.delete(kind);
  }
  async refresh(kind: SourceKind) {
    if (this.locks.has(kind)) return this.locks.get(kind);
    return this.locked(kind, async () => {
      const credentials = this.store.credentials(kind);
      if (!credentials) return;
      const row = this.store.source(kind);
      this.store.db
        .prepare("UPDATE sources SET last_attempt=? WHERE kind=?")
        .run(new Date().toISOString(), kind);
      try {
        const result = await this.download(credentials, {
          etag: row.etag,
          modified: row.modified,
        });
        if (result.notModified && row.snapshot !== null) {
          this.store.db
            .prepare(
              "UPDATE sources SET last_success=?, error=NULL WHERE kind=?",
            )
            .run(new Date().toISOString(), kind);
          return;
        }
        const parsed = await parseCalendar(
          result.text || "",
          this.store.settings().timeZone,
        );
        this.commit(kind, credentials, result, parsed);
      } catch (error) {
        // Only our own safe, actionable errors are persisted; never persist transport errors containing a URL.
        const message =
          error instanceof Error &&
          /^(The |Private-network |HTTP Basic |An HTTPS )/.test(error.message)
            ? error.message
            : "The source could not be reached. Check the URL, credentials, and network, then refresh.";
        this.store.db
          .prepare("UPDATE sources SET error=? WHERE kind=?")
          .run(message, kind);
      }
    });
  }
  async remove(kind: SourceKind) {
    return this.locked(kind, async () => {
      this.store.db.transaction(() => {
        this.store.db
          .prepare("DELETE FROM calendar_records WHERE source=?")
          .run(kind);
        this.store.db
          .prepare(
            "UPDATE sources SET config=NULL,snapshot=NULL,etag=NULL,modified=NULL,last_success=NULL,last_attempt=NULL,error=NULL,event_count=0,revision=revision+1 WHERE kind=?",
          )
          .run(kind);
      })();
      this.parsed.delete(kind);
    });
  }
  async events(
    from: Date,
    to: Date,
    role: Role,
    preview: boolean,
    query = "",
    filter = "all",
    displayZone = this.store.settings().timeZone,
  ): Promise<CalendarResponse> {
    let kind: SourceKind = role === "public" || preview ? "busy" : "detailed";
    let fallback = false;
    if (kind === "detailed" && !this.status(kind).available) {
      kind = "busy";
      fallback = true;
    }
    const row = this.store.source(kind);
    const effectiveRole = kind === "busy" ? "public" : role;
    let events: CalendarResponse["events"] = [];
    if (row.snapshot !== null) {
      const timeZone = this.store.settings().timeZone;
      const hash = digest(`${timeZone}:${row.snapshot}`);
      let cache = this.parsed.get(kind);
      if (!cache || cache.hash !== hash) {
        cache = { hash, calendar: await parseCalendar(row.snapshot, timeZone) };
        this.parsed.set(kind, cache);
      }
      events = expandCalendar(
        cache.calendar,
        from,
        to,
        effectiveRole,
        this.store.config.encryptionKey,
        timeZone,
        displayZone,
      );
      // Filter only after privacy projection, so hidden fields cannot be discovered with search.
      if (query) {
        const q = query.toLocaleLowerCase();
        events = events.filter((e) =>
          [
            e.title,
            ...(!e.redacted
              ? [e.description, e.location, e.organizer, ...e.attendees]
              : []),
          ].some((v) => v.toLocaleLowerCase().includes(q)),
        );
      }
      if (filter === "busy")
        events = events.filter((e) => e.redacted || e.availability === "busy");
      if (filter === "free")
        events = events.filter((e) => !e.redacted && e.availability === "free");
      if (filter === "tentative")
        events = events.filter((e) => !e.redacted && e.status === "TENTATIVE");
    }
    return {
      events,
      source: kind,
      status: this.status(kind),
      role: effectiveRole,
      fallback,
    };
  }
  start() {
    this.stopped = false;
    const tick = async () => {
      if (this.stopped) return;
      await Promise.allSettled([
        this.refresh("busy"),
        this.refresh("detailed"),
      ]);
      if (!this.stopped) {
        this.timer = setTimeout(
          tick,
          this.store.settings().refreshMinutes * 60_000,
        );
        this.timer.unref();
      }
    };
    void tick();
  }
  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    await Promise.allSettled([...this.locks.values()]);
  }
}
