import { describe, expect, it } from "vitest";
import {
  decrypt,
  encrypt,
  hashPassword,
  verifyPassword,
  safeUrl,
} from "../server/security";
import { isPublicAddress, normalizeSourceUrl } from "../server/fetch-source";
describe("credential and network safety", () => {
  it("hashes and verifies passwords without retaining plaintext", async () => {
    const hash = await hashPassword("a long test password");
    expect(hash).not.toContain("a long test password");
    expect(await verifyPassword("a long test password", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
    expect(await verifyPassword("wrong")).toBe(false);
  });
  it("authenticates encrypted credentials and rejects tampering or a different key", () => {
    const key = Buffer.alloc(32, 2);
    const value = encrypt(key, "credential");
    expect(decrypt(key, value)).toBe("credential");
    expect(() => decrypt(Buffer.alloc(32, 3), value)).toThrow();
    const tampered = Buffer.from(value, "base64");
    tampered[15] ^= 1;
    expect(() => decrypt(key, tampered.toString("base64"))).toThrow();
  });
  it("blocks loopback, private, mapped private, link-local, multicast, and reserved addresses", () => {
    for (const address of [
      "127.0.0.1",
      "10.1.1.1",
      "192.168.1.1",
      "172.16.0.1",
      "169.254.169.254",
      "0.0.0.0",
      "224.1.1.1",
      "::1",
      "::",
      "fc00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
      "::ffff:192.168.0.1",
    ])
      expect(isPublicAddress(address), address).toBe(false);
    expect(isPublicAddress("8.8.8.8")).toBe(true);
    expect(isPublicAddress("2606:4700:4700::1111")).toBe(true);
  });
  it("normalizes webcal and rejects unsafe schemes or embedded credentials", () => {
    expect(normalizeSourceUrl("webcal://example.com/calendar.ics")).toBe(
      "https://example.com/calendar.ics",
    );
    expect(() => normalizeSourceUrl("file:///etc/passwd")).toThrow();
    expect(() => normalizeSourceUrl("https://user:pass@example.com")).toThrow();
    expect(safeUrl("javascript:alert(1)")).toBe(null);
    expect(safeUrl("data:text/html,a")).toBe(null);
  });
});
