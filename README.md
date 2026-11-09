# William’s Calendar

A self-hosted, read-only calendar with a public availability view and password-protected event details. Built with React, FullCalendar Standard, Fastify, SQLite, and the [Hallmark Studio theme](https://github.com/Nutlope/hallmark/blob/main/skills/hallmark/references/themes/studio.md).

The app **reads two existing ICS subscription feeds**. It does not publish subscription feeds, create events, or write back to your calendars.

- The **busy-only source** supplies public availability. Its events are reduced to anonymous “Busy” intervals on the server, even if the source accidentally includes titles or other details.
- The **detailed source** supplies events after a visitor enters your shared website password. `CLASS:PRIVATE` and `CLASS:CONFIDENTIAL` events remain busy-only for visitors; only the owner can inspect their details.
- Your **owner password**, shared **website viewer password**, and optional **upstream HTTP Basic credentials** are separate credentials.

## Run with Docker

Requires Docker Engine with Compose. The app runs as one non-root container; no external database is needed.

```sh
# Create private .env with a random owner password and encryption key.
node scripts/setup.mjs
# Open .env locally to retrieve your owner password and set APP_ORIGIN.
docker compose up -d --build
```

Open [http://localhost:3000](http://localhost:3000). Choose **Owner sign-in**, then:

1. Set the busy-only and detailed ICS URLs in **Calendar sources**. Test each connection, then save it.
2. If a source requires HTTP Basic authentication, expand its upstream authentication fields. These credentials are used server-side for that source's requests.
3. Set a shared viewer password in **Access & security** to enable detailed viewing. Share that password separately with your intended visitors.
4. Configure the title, time zone, working hours, week start, and refresh interval in **Preferences**.

On first run, no events are fabricated. Until a source is connected, the app reports that availability is unavailable; it does not imply that your calendar is free.

Compose binds to `127.0.0.1` by default. Set `BIND_ADDRESS=0.0.0.0` only if you intend to expose the port directly. `PORT` controls the host port; the container always listens on port 3000.

### Public HTTPS hosting

Set `APP_ORIGIN=https://calendar.example.com` in `.env` and put an HTTPS reverse proxy in front of the app. For example, a host-installed Caddy instance can use:

```caddyfile
calendar.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

The configured origin must match the address visitors use, including scheme and non-default port. HTTPS enables Secure cookies. If your reverse proxy runs in another container, connect it to the Compose network and proxy to `calendar:3000` instead. Keep the upstream app port private.

`ENCRYPTION_KEY` is 32 random bytes encoded as 64 hexadecimal characters. **Preserve it for the lifetime of the database** and back it up separately. The app refuses to open an existing database with a different key. `OWNER_PASSWORD` bootstraps a new database only; changing that environment variable does not reset an existing owner password.

For Docker secret files, the server also supports `ENCRYPTION_KEY_FILE` and `OWNER_PASSWORD_FILE`. Adapt the Compose environment and mount those files read-only instead of supplying the corresponding plaintext environment variables.

### Persistent storage and backups

The named volume `calendar-data` holds `/data/calendar.sqlite` and its SQLite WAL files. Container rebuilds and recreation preserve it. **`docker compose down -v` deletes the volume.** Run a single app replica against a local volume; sharing this SQLite file over network storage or across replicas is unsupported.

Create a consistent online backup:

```sh
docker compose exec calendar node dist/server/cli.js backup /data/calendar-backup.sqlite
docker compose cp calendar:/data/calendar-backup.sqlite ./calendar-backup.sqlite
```

Treat backups as sensitive: event details are stored in SQLite. Source URLs and upstream credentials are encrypted, but the database is not a full-disk encrypted database. Do not publish the database or backups.

Restore with the app stopped and the **original encryption key**. This example uses a temporary helper container with the same volume and user:

```sh
docker compose stop calendar
docker compose run --rm --no-deps --entrypoint sh \
  -v "$PWD/calendar-backup.sqlite:/restore/calendar.sqlite:ro" calendar \
  -c 'cp /restore/calendar.sqlite /data/calendar.sqlite && rm -f /data/calendar.sqlite-wal /data/calendar.sqlite-shm'
docker compose start calendar
```

Back up the existing database before replacing it. The backup/restore path is covered by automated SQLite tests.

### Owner password recovery

Store your new password in a private temporary file (12–256 characters), then pass it through standard input:

```sh
docker compose exec -T calendar node dist/server/cli.js reset-owner < /path/to/private-password-file
```

Remove the temporary password file afterward. All owner sessions are revoked. No plaintext password is printed or placed in a command argument. You can also change the owner password in settings while signed in.

## Calendar behavior

- Day, week, work week, month, year, and agenda views; date navigation and jump-to-date.
- Click an event for permitted details, meeting links, organizer, attendees, recurrence information, and a copyable summary.
- Authorized search and availability/status filters. Search runs **after privacy redaction**.
- Named time zones, local-time display, 12/24-hour time, configurable week start, weekend visibility, working-hour shading, and a current-time indicator.
- Mobile agenda default, keyboard shortcuts (`?` opens the guide), and print styles.
- Display preferences stay in browser storage; passwords, source credentials, and detailed event data do not.
- Owner preview shows exactly the public availability representation.

Sources refresh on startup and every five minutes by default. Conditional HTTP requests use ETag and Last-Modified when available. Manual upstream refresh is owner-only; a visitor's reload reads the latest stored snapshot. Failures retain the last successful snapshot and mark updates as delayed. An authorized visitor falls back to public availability when no detailed snapshot exists.

A valid replacement source is downloaded and parsed before its configuration and snapshot are switched together. Removing a source clears its cached data. A valid empty source removes old events. Source calendars remain separate to prevent duplicate events from the busy and detailed representations.

Recurring events support RRULE, EXDATE, recurrence overrides, cancellations, date-only events, floating times, and daylight-saving transitions through `node-ical`. Floating times use `X-WR-TIMEZONE`, or the configured calendar zone. `VFREEBUSY` periods are supported. Query windows are limited to 400 days; recurrence expansion is bounded. Requests exceeding those limits show an error instead of silently reporting a free calendar.

Viewer sessions last 12 hours and owner sessions 8 hours. Changing a password revokes sessions for that role; disabling detailed viewing revokes all viewer sessions. The frontend checks sessions every 30 seconds, on returning to the tab, and at local expiry; every API request enforces current authorization. Locking removes detailed event data from the interface immediately.

Source downloads time out after 20 seconds, allow at most five redirects, and are limited to 10 MB. Private, loopback, link-local, and reserved network targets are blocked, including after redirects; validated DNS addresses are pinned for the connection. Enable `ALLOW_PRIVATE_SOURCES=true` only when you intentionally need private-network calendars. Cross-origin redirects do not receive the original source credentials. HTTP Basic credentials require HTTPS unless private-source access is explicitly enabled.

## Local development

Requires Node.js 26 LTS and npm.

```sh
npm ci
npm run setup  # Skip if .env already exists.
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). Vite proxies API calls to port 3000. The development script sets the allowed origin to this exact preview address. To run a production build locally:

```sh
npm run build
npm start
```

Open the address configured by `APP_ORIGIN` (default `http://localhost:3000`). Local development uses `data/calendar.sqlite`; it is separate from the Docker volume.

```sh
npm test              # Calendar, privacy, API, sync, encryption, and persistence tests
npm run typecheck
npm run build
npm run test:browser  # Installed Google Chrome by default on local macOS
```

For browser tests without installed Chrome, run `npx playwright install chromium` and `PLAYWRIGHT_CHANNEL=chromium npm run test:browser`. The browser suite starts an isolated fixture server and never reads `.env` or opens your real calendar database. Tests include mobile layout, password flows, and automated accessibility checks. Fixture events are never loaded into a production database.

Local maintenance: `npm run admin -- backup /absolute/path/backup.sqlite` and `npm run admin -- reset-owner < /path/to/private-password-file`.

## Implementation

`client/` contains the Studio-themed React app, `server/` the Fastify API and source synchronizer, `shared/` the public TypeScript interfaces, and `tests/` the isolated fixtures and tests. Versioned migrations run at startup. `/healthz` checks application/database readiness without depending on upstream feed availability.

The app uses FullCalendar Standard's MIT-licensed features; it needs no Premium license. Fonts are bundled locally. Hallmark scaffold attribution and verification notes are in `.hallmark/`. The repository's existing license is preserved.
