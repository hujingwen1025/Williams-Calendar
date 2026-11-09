import "dotenv/config";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomBytes } from "node:crypto";
export interface Config {
  dbPath: string;
  encryptionKey: Buffer;
  ownerPassword?: string;
  secureCookies: boolean;
  origin?: string;
  allowPrivateSources: boolean;
  log: boolean;
}
function secret(name: string) {
  const file = process.env[`${name}_FILE`];
  return file ? readFileSync(file, "utf8").trim() : process.env[name];
}
export function loadConfig(): Config {
  const production = process.env.NODE_ENV === "production";
  const dbPath = resolve(process.env.DATABASE_PATH || "data/calendar.sqlite");
  mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
  let key = secret("ENCRYPTION_KEY");
  if (!key && !production) {
    const path = resolve(dirname(dbPath), ".development-key");
    if (!existsSync(path))
      writeFileSync(path, randomBytes(32).toString("hex"), { mode: 0o600 });
    key = readFileSync(path, "utf8").trim();
  }
  if (!key || !/^[a-f0-9]{64}$/i.test(key))
    throw new Error(
      "ENCRYPTION_KEY must be 64 hexadecimal characters (32 random bytes).",
    );
  const origin = process.env.APP_ORIGIN;
  if (production && !origin)
    throw new Error(
      "Set APP_ORIGIN to the public HTTPS origin (or HTTP for local-only Docker use).",
    );
  if (origin && !/^https?:\/\//.test(origin))
    throw new Error("APP_ORIGIN must be an HTTP(S) origin.");
  return {
    dbPath,
    encryptionKey: Buffer.from(key, "hex"),
    ownerPassword: secret("OWNER_PASSWORD"),
    secureCookies: origin ? new URL(origin).protocol === "https:" : production,
    origin: origin ? new URL(origin).origin : undefined,
    allowPrivateSources: process.env.ALLOW_PRIVATE_SOURCES === "true",
    log: process.env.NODE_ENV !== "test",
  };
}
