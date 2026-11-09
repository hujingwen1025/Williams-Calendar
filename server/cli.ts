import { loadConfig } from "./config.js";
import { Store } from "./db.js";
import { readFileSync, chmodSync } from "node:fs";
import { resolve } from "node:path";
const [command, argument] = process.argv.slice(2);
const store = new Store(loadConfig());
try {
  if (command === "backup" && argument) {
    const path = resolve(argument);
    await store.db.backup(path);
    chmodSync(path, 0o600);
    console.log(`Backup saved to ${path}. Preserve ENCRYPTION_KEY separately.`);
  } else if (command === "reset-owner") {
    if (process.stdin.isTTY)
      throw new Error(
        "Pass the new password through standard input (not a command argument).",
      );
    const password = readFileSync(0, "utf8").trim();
    if (password.length < 12 || password.length > 256)
      throw new Error("Use a password between 12 and 256 characters.");
    await store.setPassword("owner", password);
    console.log("Owner password reset. Existing owner sessions revoked.");
  } else {
    console.error(
      "Usage: npm run admin -- backup <destination> | reset-owner < <password-file>",
    );
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Operation failed.");
  process.exitCode = 1;
} finally {
  store.close();
}
