import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance, InjectOptions } from "fastify";
import { createApp } from "../server/app";
import { Store } from "../server/db";
import type { Config } from "../server/config";
import type { Downloader } from "../server/fetch-source";
import { busyFixture, detailedFixture, calendar } from "./fixtures";
const config: Config = {
  dbPath: ":memory:",
  encryptionKey: Buffer.alloc(32, 7),
  ownerPassword: "owner-test-password-only",
  secureCookies: false,
  origin: "http://calendar.test",
  allowPrivateSources: false,
  log: false,
};
const range = "start=2026-11-01T00%3A00%3A00Z&end=2026-12-01T00%3A00%3A00Z";
const eventsUrl = `/api/calendar/events?${range}`;
function client(app: FastifyInstance) {
  const cookies = new Map<string, string>();
  let csrf = "";
  return {
    async request(
      method: InjectOptions["method"],
      url: string,
      payload?: unknown,
      headers: Record<string, string> = {},
    ) {
      const response = await app.inject({
        method,
        url,
        payload: payload as InjectOptions["payload"],
        headers: {
          cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
          "x-csrf-token": csrf,
          origin: config.origin!,
          ...headers,
        },
      });
      for (const cookie of response.cookies) {
        if (cookie.value) cookies.set(cookie.name, cookie.value);
        else cookies.delete(cookie.name);
      }
      if (response.headers["content-type"]?.includes("json")) {
        const body = response.json();
        if (body.csrfToken) csrf = body.csrfToken;
      }
      return response;
    },
    async login(
      role: "owner" | "viewer",
      password = role === "owner"
        ? config.ownerPassword!
        : "viewer-test-password",
      rememberMe = false,
    ) {
      await this.request("GET", "/api/session");
      return this.request("POST", "/api/auth/login", {
        role,
        password,
        rememberMe,
      });
    },
  };
}
describe("API access boundaries and synchronization", () => {
  let app: FastifyInstance;
  let store: Store;
  let sync: Awaited<ReturnType<typeof createApp>>["sync"];
  let failure = false;
  let invalid = false;
  let notModified = false;
  const downloader: Downloader = async (source) => {
    if (failure)
      throw new Error(
        "fetch failed https://DO-NOT-EXPOSE.example/private-token",
      );
    if (invalid)
      return {
        text: "<html>no calendar</html>",
        notModified: false,
        etag: null,
        modified: null,
      };
    if (notModified) return { notModified: true, etag: "v1", modified: null };
    return {
      text: source.url.includes("detailed") ? detailedFixture : busyFixture,
      notModified: false,
      etag: "v1",
      modified: null,
    };
  };
  beforeEach(async () => {
    failure = false;
    invalid = false;
    notModified = false;
    ({ app, store, sync } = await createApp(config, {
      downloader,
      sync: false,
    }));
    await store.setPassword("viewer", "viewer-test-password");
    await sync.replace("busy", { url: "https://source.example/busy.ics" });
    await sync.replace("detailed", {
      url: "https://source.example/detailed.ics",
      username: "upstream-user",
      password: "upstream-secret",
    });
  });
  afterEach(async () => {
    await app.close();
  });
  it("does not allow request parameters or unauthorized detail IDs to elevate access", async () => {
    const response = await app.inject({
      url: `${eventsUrl}&role=owner&details=true`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().role).toBe("public");
    expect(response.json().events).toHaveLength(1);
    expect(response.body).not.toMatch(
      /Design|medical|SHOULD|source.example|upstream/,
    );
    expect(response.headers["cache-control"]).toBe("no-store");
    const owner = client(app);
    await owner.login("owner");
    const detailId = (await owner.request("GET", eventsUrl)).json().events[0]
      .id;
    expect(
      (await app.inject({ url: `/api/calendar/events/${detailId}?${range}` }))
        .statusCode,
    ).toBe(404);
  });
  it("unlocks permitted details and searches only fields visible to that role", async () => {
    const viewer = client(app);
    expect((await viewer.login("viewer")).statusCode).toBe(200);
    const response = await viewer.request("GET", eventsUrl);
    expect(
      response
        .json()
        .events.some((e: { title: string }) => e.title === "Design review"),
    ).toBe(true);
    expect(response.body).not.toMatch(/medical|clinic|acquisition/);
    const secretSearch = await viewer.request("GET", `${eventsUrl}&q=medical`);
    expect(secretSearch.json().events).toHaveLength(0);
    expect(
      (await viewer.request("GET", `${eventsUrl}&q=Studio`)).json().events,
    ).toHaveLength(1);
    expect(
      (await viewer.request("GET", "/api/owner/settings")).statusCode,
    ).toBe(403);
  });
  it("allows the owner to inspect private events and preview only public intervals", async () => {
    const owner = client(app);
    await owner.login("owner");
    expect(
      (await owner.request("GET", `${eventsUrl}&q=medical`)).json().events,
    ).toHaveLength(1);
    const preview = await owner.request("GET", `${eventsUrl}&preview=true`);
    expect(preview.json().source).toBe("busy");
    expect(preview.body).not.toMatch(/Design|medical|SHOULD/);
  });
  it("requires CSRF and same-origin mutation requests, including login", async () => {
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/login",
          payload: { role: "owner", password: config.ownerPassword },
        })
      ).statusCode,
    ).toBe(403);
    const owner = client(app);
    await owner.login("owner");
    expect(
      (
        await owner.request(
          "POST",
          "/api/owner/sources/busy/refresh",
          undefined,
          { origin: "https://evil.example" },
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await owner.request(
          "POST",
          "/api/owner/sources/busy/refresh",
          undefined,
          { "x-csrf-token": "wrong" },
        )
      ).statusCode,
    ).toBe(403);
  });
  it("revokes viewer sessions on password rotation, disabling details, logout, and expiry", async () => {
    const viewer = client(app);
    await viewer.login("viewer", undefined, true);
    const owner = client(app);
    await owner.login("owner");
    expect(
      (
        await owner.request("PUT", "/api/owner/passwords/viewer", {
          password: "a-new-viewer-password",
        })
      ).statusCode,
    ).toBe(200);
    expect((await viewer.request("GET", eventsUrl)).json().role).toBe("public");
    await viewer.login("viewer", "a-new-viewer-password");
    expect((await viewer.request("GET", eventsUrl)).json().role).toBe("viewer");
    await owner.request("DELETE", "/api/owner/passwords/viewer");
    expect((await viewer.request("GET", eventsUrl)).json().role).toBe("public");
    await store.setPassword("viewer", "viewer-test-password");
    await viewer.login("viewer");
    store.db.prepare("UPDATE sessions SET expires=0 WHERE role='viewer'").run();
    expect((await viewer.request("GET", eventsUrl)).json().role).toBe("public");
    await viewer.login("viewer");
    await viewer.request("POST", "/api/auth/logout");
    expect((await viewer.request("GET", eventsUrl)).json().role).toBe("public");
  });
  it("allows one-character visitor passwords but still rejects empty passwords and short owner passwords", async () => {
    const owner = client(app);
    await owner.login("owner");
    expect(
      (
        await owner.request("PUT", "/api/owner/passwords/viewer", {
          password: "1",
        })
      ).statusCode,
    ).toBe(200);
    const viewer = client(app);
    expect((await viewer.login("viewer", "1")).statusCode).toBe(200);
    expect((await viewer.request("GET", eventsUrl)).json().role).toBe("viewer");
    expect(
      (
        await owner.request("PUT", "/api/owner/passwords/viewer", {
          password: "",
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await owner.request("PUT", "/api/owner/passwords/owner", {
          password: "1",
          currentPassword: config.ownerPassword,
        })
      ).statusCode,
    ).toBe(400);
  });
  it.each([false, true])(
    "uses the appropriate viewer cookie and lifetime when rememberMe=%s",
    async (rememberMe) => {
      const viewer = client(app);
      const before = Date.now();
      const response = await viewer.login("viewer", undefined, rememberMe);
      expect(response.statusCode).toBe(200);
      const lifetime = (rememberMe ? 30 * 24 : 12) * 60 * 60 * 1000;
      const expires = Date.parse(response.json().expiresAt);
      expect(expires).toBeGreaterThanOrEqual(before + lifetime);
      expect(expires).toBeLessThanOrEqual(Date.now() + lifetime);
      const headers = response.headers["set-cookie"];
      const sessionCookie = (Array.isArray(headers) ? headers : [headers]).find(
        (value) => value?.startsWith("wc_session="),
      )!;
      expect(sessionCookie).toContain("HttpOnly");
      expect(sessionCookie).toContain("SameSite=Strict");
      if (rememberMe) expect(sessionCookie).toContain("Expires=");
      else expect(sessionCookie).not.toMatch(/Expires=|Max-Age=/i);
    },
  );
  it("does not extend owner sessions when a client submits rememberMe", async () => {
    const owner = client(app);
    const before = Date.now();
    const response = await owner.login("owner", undefined, true);
    expect(response.statusCode).toBe(200);
    const expires = Date.parse(response.json().expiresAt);
    expect(expires).toBeGreaterThanOrEqual(before + 8 * 60 * 60 * 1000);
    expect(expires).toBeLessThanOrEqual(Date.now() + 8 * 60 * 60 * 1000);
  });
  it("rate-limits password attempts and rejects incorrect passwords", async () => {
    const viewer = client(app);
    await viewer.request("GET", "/api/session");
    for (let i = 0; i < 8; i++)
      expect(
        (
          await viewer.request("POST", "/api/auth/login", {
            role: "viewer",
            password: "wrong",
          })
        ).statusCode,
      ).toBe(401);
    expect(
      (
        await viewer.request("POST", "/api/auth/login", {
          role: "viewer",
          password: "wrong",
        })
      ).statusCode,
    ).toBe(429);
  });
  it("keeps stale snapshots on failure and sanitizes transport errors", async () => {
    failure = true;
    await sync.refresh("busy");
    expect(sync.status("busy")).toMatchObject({ stale: true, available: true });
    expect(sync.info("busy").error).not.toContain("DO-NOT-EXPOSE");
    expect((await app.inject({ url: eventsUrl })).json().events).toHaveLength(
      1,
    );
    expect((await app.inject({ url: eventsUrl })).body).not.toContain(
      "fetch failed",
    );
  });
  it("validates replacements before switching and clears snapshots on removal", async () => {
    invalid = true;
    await expect(
      sync.replace("busy", { url: "https://replacement.example/calendar.ics" }),
    ).rejects.toThrow("valid ICS");
    expect(store.credentials("busy")?.url).toBe(
      "https://source.example/busy.ics",
    );
    expect(sync.status("busy").available).toBe(true);
    await sync.remove("busy");
    expect(sync.status("busy")).toMatchObject({
      configured: false,
      available: false,
    });
    expect((await app.inject({ url: eventsUrl })).json().events).toHaveLength(
      0,
    );
  });
  it("handles conditional refresh without losing data, and an empty valid calendar removes old events", async () => {
    notModified = true;
    await sync.refresh("busy");
    expect(store.source("busy").snapshot).toBe(busyFixture);
    notModified = false;
    const other = new (
      sync.constructor as typeof import("../server/sync").SyncService
    )(store, async () => ({
      text: calendar(""),
      notModified: false,
      etag: "v2",
      modified: null,
    }));
    await other.refresh("busy");
    expect(store.source("busy").event_count).toBe(0);
    expect((await app.inject({ url: eventsUrl })).json().events).toHaveLength(
      0,
    );
  });
  it("encrypts source URLs and credentials at rest and never returns stored passwords", async () => {
    expect(store.source("detailed").config).not.toMatch(
      /source.example|upstream-user|upstream-secret/,
    );
    expect(store.credentials("detailed")?.password).toBe("upstream-secret");
    const owner = client(app);
    await owner.login("owner");
    const response = await owner.request("GET", "/api/owner/settings");
    expect(response.body).toContain("hasPassword");
    expect(response.body).not.toContain("upstream-secret");
  });
  it("rejects oversized date ranges and invalid settings", async () => {
    expect(
      (
        await app.inject({
          url: "/api/calendar/events?start=2025-01-01T00:00:00Z&end=2027-01-01T00:00:00Z",
        })
      ).statusCode,
    ).toBe(400);
    const owner = client(app);
    await owner.login("owner");
    expect(
      (
        await owner.request("PUT", "/api/owner/settings", {
          ...store.settings(),
          timeZone: "invalid-zone",
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await owner.request("PUT", "/api/owner/settings", {
          ...store.settings(),
          workStart: "18:00",
          workEnd: "09:00",
        })
      ).statusCode,
    ).toBe(400);
  });
  it("falls back to busy availability if the detailed source has no snapshot", async () => {
    await sync.remove("detailed");
    const viewer = client(app);
    await viewer.login("viewer");
    const response = await viewer.request("GET", eventsUrl);
    expect(response.json()).toMatchObject({ fallback: true, source: "busy" });
    expect(response.body).not.toMatch(/Design|medical/);
  });
});
describe("persistent SQLite and recovery", () => {
  it("survives restart, detects a wrong key, and produces a restorable online backup", async () => {
    const dir = mkdtempSync(join(tmpdir(), "williams-calendar-"));
    try {
      const cfg = { ...config, dbPath: join(dir, "calendar.sqlite") };
      const first = await createApp(cfg, {
        sync: false,
        downloader: async () => ({
          text: busyFixture,
          notModified: false,
          etag: null,
          modified: null,
        }),
      });
      await first.store.setPassword("viewer", "persistent-viewer-password");
      first.store.saveSettings({
        ...first.store.settings(),
        title: "Persistent title",
      });
      await first.sync
        .replace("busy", { url: "https://source.example/busy.ics" })
        .catch(() => undefined);
      await first.store.db.backup(join(dir, "backup.sqlite"));
      await first.app.close();
      const second = await createApp(cfg, {
        sync: false,
        downloader: async () => ({
          text: busyFixture,
          notModified: false,
          etag: null,
          modified: null,
        }),
      });
      expect(second.store.settings().title).toBe("Persistent title");
      expect(second.store.password("viewer")).toBeTruthy();
      await second.app.close();
      const restored = new Store({
        ...cfg,
        dbPath: join(dir, "backup.sqlite"),
      });
      expect(restored.settings().title).toBe("Persistent title");
      restored.close();
      expect(
        () => new Store({ ...cfg, encryptionKey: Buffer.alloc(32, 9) }),
      ).toThrow("does not match");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
