// Isolated fixture server: never opens the real calendar database or reads .env.
import { createApp } from "../server/app";
import { calendar, event, detailedFixture } from "./fixtures";
const busy = calendar(
  [
    event(
      "UID:a\r\nDTSTART:20261109T020000Z\r\nDTEND:20261109T030000Z\r\nSUMMARY:Busy",
    ),
    event(
      "UID:b\r\nDTSTART:20261110T020000Z\r\nDTEND:20261110T030000Z\r\nSUMMARY:Busy",
    ),
    event(
      "UID:c\r\nDTSTART:20261111T020000Z\r\nDTEND:20261111T030000Z\r\nSUMMARY:Busy",
    ),
    event(
      "UID:d\r\nDTSTART:20261112T040000Z\r\nDTEND:20261112T060000Z\r\nSUMMARY:Busy",
    ),
  ].join("\r\n"),
);
const { app, store, sync } = await createApp(
  {
    dbPath: ":memory:",
    encryptionKey: Buffer.alloc(32, 4),
    ownerPassword: "browser-owner-password",
    secureCookies: false,
    origin: "http://127.0.0.1:3041",
    allowPrivateSources: false,
    log: false,
  },
  {
    sync: false,
    downloader: async (source) => {
      if (
        ![
          "https://fixture.example/busy.ics",
          "https://fixture.example/detailed.ics",
        ].includes(source.url)
      )
        throw new Error("The source could not be reached.");
      return {
        text: source.url.includes("detailed") ? detailedFixture : busy,
        notModified: false,
        etag: "fixture",
        modified: null,
      };
    },
  },
);
await store.setPassword("viewer", "browser-viewer-password");
await sync.replace("busy", { url: "https://fixture.example/busy.ics" });
await sync.replace("detailed", { url: "https://fixture.example/detailed.ics" });
await app.listen({ host: "127.0.0.1", port: 3041 });
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
