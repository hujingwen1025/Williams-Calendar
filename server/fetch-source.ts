import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
import { Agent, fetch } from "undici";
import type { SourceCredentials } from "./db.js";
export interface Download {
  text?: string;
  notModified: boolean;
  etag: string | null;
  modified: string | null;
}
export type Downloader = (
  source: SourceCredentials,
  validators?: { etag: string | null; modified: string | null },
) => Promise<Download>;
export function normalizeSourceUrl(input: string) {
  let url: URL;
  try {
    url = new URL(input.replace(/^webcal:/i, "https:"));
  } catch {
    throw new Error("Use an HTTPS, HTTP, or webcal calendar URL.");
  }
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("Use an HTTPS, HTTP, or webcal calendar URL.");
  if (url.username || url.password)
    throw new Error(
      "Enter upstream credentials in the separate username and password fields.",
    );
  url.hash = "";
  return url.href;
}
export function isPublicAddress(address: string) {
  try {
    return ipaddr.process(address).range() === "unicast";
  } catch {
    return false;
  }
}
export function createDownloader(allowPrivate: boolean): Downloader {
  return async (source, validators) => {
    let url = new URL(normalizeSourceUrl(source.url));
    const sourceOrigin = url.origin;
    const signal = AbortSignal.timeout(20_000);
    for (let redirects = 0; redirects <= 5; redirects++) {
      const hostname = url.hostname.replace(/^\[|\]$/g, "");
      if (
        !allowPrivate &&
        (hostname === "localhost" ||
          hostname.endsWith(".localhost") ||
          hostname.endsWith(".local"))
      ) {
        throw new Error(
          "Private-network sources are disabled on this deployment.",
        );
      }
      const addresses = isIP(hostname)
        ? [{ address: hostname, family: isIP(hostname) }]
        : await lookup(hostname, { all: true });
      if (
        !addresses.length ||
        (!allowPrivate && addresses.some((x) => !isPublicAddress(x.address)))
      ) {
        throw new Error(
          "Private-network sources are disabled on this deployment.",
        );
      }
      if (source.username && url.protocol !== "https:" && !allowPrivate)
        throw new Error("HTTP Basic credentials require an HTTPS source.");
      // Pin the validated DNS result at connection time to prevent DNS rebinding.
      const agent = new Agent({
        connect: {
          autoSelectFamily: true,
          lookup: (_name, options, callback) => {
            if (options.all) callback(null, addresses);
            else callback(null, addresses[0].address, addresses[0].family);
          },
        },
      });
      try {
        const headers: Record<string, string> = {
          accept: "text/calendar, text/plain;q=0.9",
          "user-agent": "Williams-Calendar/1.0",
        };
        if (url.origin === sourceOrigin) {
          if (source.username)
            headers.authorization = `Basic ${Buffer.from(`${source.username}:${source.password}`).toString("base64")}`;
          if (validators?.etag) headers["if-none-match"] = validators.etag;
          if (validators?.modified)
            headers["if-modified-since"] = validators.modified;
        }
        const response = await fetch(url, {
          dispatcher: agent,
          redirect: "manual",
          headers,
          signal,
        });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get("location");
          await response.body?.cancel();
          if (!location || redirects === 5)
            throw new Error(
              "The source has too many redirects or an invalid redirect.",
            );
          const next = new URL(location, url);
          if (url.protocol === "https:" && next.protocol !== "https:")
            throw new Error("An HTTPS source cannot redirect to HTTP.");
          url = new URL(normalizeSourceUrl(next.href));
          continue;
        }
        if (response.status === 304) {
          await response.body?.cancel();
          return {
            notModified: true,
            etag: validators?.etag ?? null,
            modified: validators?.modified ?? null,
          };
        }
        if (!response.ok) {
          await response.body?.cancel();
          if ([401, 403].includes(response.status))
            throw new Error(
              "The source rejected its credentials. Check the URL and upstream username/password.",
            );
          throw new Error(
            `The source returned HTTP ${response.status}. Try refreshing later.`,
          );
        }
        const chunks: Uint8Array[] = [];
        let size = 0;
        const reader = response.body?.getReader();
        if (!reader) throw new Error("The source returned an empty response.");
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          size += next.value.byteLength;
          if (size > 10 * 1024 * 1024) {
            await reader.cancel();
            throw new Error("The source exceeds the 10 MB calendar limit.");
          }
          chunks.push(next.value);
        }
        return {
          text: Buffer.concat(chunks).toString("utf8"),
          notModified: false,
          etag: response.headers.get("etag"),
          modified: response.headers.get("last-modified"),
        };
      } finally {
        await agent.close();
      }
    }
    throw new Error("The source could not be fetched.");
  };
}
