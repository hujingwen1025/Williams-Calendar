import Database from "better-sqlite3";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { CalendarSettings, SourceKind } from "../shared/types.js";
import {
  decrypt,
  encrypt,
  hashPassword,
  digest,
  randomToken,
} from "./security.js";
import type { Config } from "./config.js";
export const DEFAULT_SETTINGS: CalendarSettings = {
  title: "William’s Calendar",
  timeZone: "Asia/Shanghai",
  weekStart: 1,
  workStart: "09:00",
  workEnd: "18:00",
  refreshMinutes: 5,
};
export interface SourceRow {
  kind: SourceKind;
  config: string | null;
  snapshot: string | null;
  etag: string | null;
  modified: string | null;
  last_success: string | null;
  last_attempt: string | null;
  error: string | null;
  event_count: number;
  revision: number;
}
export interface SourceCredentials {
  url: string;
  username: string;
  password: string;
}
export class Store {
  db: Database.Database;
  constructor(readonly config: Config) {
    if (config.dbPath !== ":memory:")
      mkdirSync(dirname(config.dbPath), { recursive: true, mode: 0o700 });
    this.db = new Database(config.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
    if (config.dbPath !== ":memory:") chmodSync(config.dbPath, 0o600);
    this.migrate();
  }
  private migrate() {
    const version = this.db.pragma("user_version", { simple: true }) as number;
    if (version > 1)
      throw new Error("This database requires a newer application version.");
    if (version < 1)
      this.db.transaction(() => {
        this.db.exec(`
        CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE passwords (role TEXT PRIMARY KEY CHECK(role IN ('viewer','owner')), hash TEXT NOT NULL);
        CREATE TABLE sources (
          kind TEXT PRIMARY KEY CHECK(kind IN ('busy','detailed')),
          config TEXT, snapshot TEXT, etag TEXT, modified TEXT,
          last_success TEXT, last_attempt TEXT, error TEXT,
          event_count INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE sessions (
          hash TEXT PRIMARY KEY, role TEXT NOT NULL CHECK(role IN ('viewer','owner')),
          csrf TEXT NOT NULL, expires INTEGER NOT NULL
        );
        CREATE INDEX session_expiry ON sessions(expires);
        CREATE TABLE calendar_records (
          source TEXT NOT NULL REFERENCES sources(kind) ON DELETE CASCADE,
          uid TEXT NOT NULL, type TEXT NOT NULL, start TEXT, end TEXT,
          PRIMARY KEY(source, uid)
        );
        INSERT INTO sources(kind) VALUES ('busy'),('detailed');
        PRAGMA user_version = 1;
      `);
        this.db
          .prepare("INSERT INTO settings(key,value) VALUES (?,?)")
          .run("calendar", JSON.stringify(DEFAULT_SETTINGS));
        // An encrypted marker detects a wrong deployment key before credentials are used.
        this.db
          .prepare("INSERT INTO settings(key,value) VALUES (?,?)")
          .run(
            "key_check",
            encrypt(this.config.encryptionKey, "williams-calendar"),
          );
      })();
    const marker = this.db
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get("key_check") as { value: string };
    try {
      if (
        decrypt(this.config.encryptionKey, marker.value) !== "williams-calendar"
      )
        throw new Error();
    } catch {
      throw new Error(
        "ENCRYPTION_KEY does not match this database. Restore the original key.",
      );
    }
  }
  async initialize() {
    if (!this.password("owner")) {
      if (!this.config.ownerPassword || this.config.ownerPassword.length < 12) {
        throw new Error(
          "Set OWNER_PASSWORD to at least 12 characters for the first startup.",
        );
      }
      await this.setPassword("owner", this.config.ownerPassword);
    }
  }
  settings(): CalendarSettings {
    const row = this.db
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get("calendar") as { value: string };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(row.value) };
  }
  saveSettings(value: CalendarSettings) {
    this.db
      .prepare("UPDATE settings SET value = ? WHERE key = ?")
      .run(JSON.stringify(value), "calendar");
  }
  password(role: "viewer" | "owner") {
    return (
      this.db.prepare("SELECT hash FROM passwords WHERE role = ?").get(role) as
        { hash: string } | undefined
    )?.hash;
  }
  async setPassword(role: "viewer" | "owner", value: string) {
    const hash = await hashPassword(value);
    this.db.transaction(() => {
      this.db
        .prepare(
          "INSERT INTO passwords(role,hash) VALUES (?,?) ON CONFLICT(role) DO UPDATE SET hash=excluded.hash",
        )
        .run(role, hash);
      this.db.prepare("DELETE FROM sessions WHERE role = ?").run(role);
    })();
  }
  removeViewerPassword() {
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM passwords WHERE role='viewer'").run();
      this.db.prepare("DELETE FROM sessions WHERE role='viewer'").run();
    })();
  }
  session(token: string) {
    return this.db
      .prepare(
        "SELECT role, csrf, expires FROM sessions WHERE hash = ? AND expires > ?",
      )
      .get(digest(token), Date.now()) as
      { role: "viewer" | "owner"; csrf: string; expires: number } | undefined;
  }
  createSession(role: "viewer" | "owner") {
    const token = randomToken();
    const csrf = randomToken();
    const expires = Date.now() + (role === "owner" ? 8 : 12) * 60 * 60 * 1000;
    this.db.prepare("DELETE FROM sessions WHERE expires <= ?").run(Date.now());
    this.db
      .prepare("INSERT INTO sessions(hash,role,csrf,expires) VALUES (?,?,?,?)")
      .run(digest(token), role, csrf, expires);
    return { token, csrf, expires };
  }
  deleteSession(token: string) {
    this.db.prepare("DELETE FROM sessions WHERE hash = ?").run(digest(token));
  }
  source(kind: SourceKind) {
    return this.db
      .prepare("SELECT * FROM sources WHERE kind = ?")
      .get(kind) as SourceRow;
  }
  credentials(kind: SourceKind): SourceCredentials | null {
    const row = this.source(kind);
    return row.config
      ? JSON.parse(decrypt(this.config.encryptionKey, row.config))
      : null;
  }
  close() {
    this.db.close();
  }
}
