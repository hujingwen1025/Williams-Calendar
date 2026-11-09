import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDownloader } from "../server/fetch-source";
import { busyFixture } from "./fixtures";
let server: Server;
let otherServer: Server;
let base = "";
let otherBase = "";
let crossOriginAuthorization: string | undefined;
beforeAll(async () => {
  otherServer = createServer((request, response) => {
    crossOriginAuthorization = request.headers.authorization;
    response.setHeader("content-type", "text/calendar");
    response.end(busyFixture);
  });
  await new Promise<void>((resolve) =>
    otherServer.listen(0, "127.0.0.1", resolve),
  );
  otherBase = `http://127.0.0.1:${(otherServer.address() as AddressInfo).port}`;
  server = createServer((request, response) => {
    const url = request.url;
    if (url === "/redirect") {
      response.writeHead(302, { location: "/protected" });
      response.end();
      return;
    }
    if (url === "/cross-origin") {
      response.writeHead(302, { location: `${otherBase}/calendar` });
      response.end();
      return;
    }
    if (url === "/loop") {
      response.writeHead(302, { location: "/loop" });
      response.end();
      return;
    }
    if (url === "/large") {
      response.end("x".repeat(10 * 1024 * 1024 + 1));
      return;
    }
    if (
      url === "/protected" &&
      request.headers.authorization !==
        `Basic ${Buffer.from("calendar:upstream-password").toString("base64")}`
    ) {
      response.writeHead(401);
      response.end();
      return;
    }
    if (request.headers["if-none-match"] === "version-1") {
      response.writeHead(304);
      response.end();
      return;
    }
    response.setHeader("etag", "version-1");
    response.setHeader("content-type", "text/calendar");
    response.end(busyFixture);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await Promise.all(
    [server, otherServer].map(
      (s) => new Promise<void>((resolve) => s.close(() => resolve())),
    ),
  );
});
describe("upstream HTTP fetches", () => {
  it("blocks private destinations by default", async () => {
    await expect(
      createDownloader(false)({
        url: `${base}/protected`,
        username: "",
        password: "",
      }),
    ).rejects.toThrow("Private-network");
  });
  it("supports optional Basic credentials and conditional requests", async () => {
    const download = createDownloader(true);
    const source = {
      url: `${base}/protected`,
      username: "calendar",
      password: "upstream-password",
    };
    const first = await download(source);
    expect(first.text).toBe(busyFixture);
    expect(first.etag).toBe("version-1");
    expect(
      (await download(source, { etag: first.etag, modified: null }))
        .notModified,
    ).toBe(true);
    await expect(download({ ...source, password: "wrong" })).rejects.toThrow(
      "rejected its credentials",
    );
  });
  it("follows same-origin redirects and strips credentials on cross-origin redirects", async () => {
    const download = createDownloader(true);
    const source = { username: "calendar", password: "upstream-password" };
    expect((await download({ ...source, url: `${base}/redirect` })).text).toBe(
      busyFixture,
    );
    expect(
      (await download({ ...source, url: `${base}/cross-origin` })).text,
    ).toBe(busyFixture);
    expect(crossOriginAuthorization).toBeUndefined();
  });
  it("limits redirects and rejects oversized payloads", async () => {
    const download = createDownloader(true);
    await expect(
      download({ url: `${base}/loop`, username: "", password: "" }),
    ).rejects.toThrow("too many redirects");
    await expect(
      download({ url: `${base}/large`, username: "", password: "" }),
    ).rejects.toThrow("10 MB");
  });
});
