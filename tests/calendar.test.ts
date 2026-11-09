import { describe, expect, it } from "vitest";
import { parseCalendar, expandCalendar } from "../server/calendar";
import { calendar, event, detailedFixture, busyFixture } from "./fixtures";
const key = Buffer.alloc(32, 1);
const from = new Date("2026-11-01T00:00:00Z");
const to = new Date("2026-12-01T00:00:00Z");
async function expand(
  raw: string,
  role: "public" | "viewer" | "owner" = "viewer",
  start = from,
  end = to,
) {
  return expandCalendar(
    await parseCalendar(raw, "Asia/Shanghai"),
    start,
    end,
    role,
    key,
    "Asia/Shanghai",
  );
}
describe("calendar privacy and normalization", () => {
  it("public intervals have only allowlisted fields, merge overlaps, and omit free events", async () => {
    const result = await expand(busyFixture, "public");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      title: "Busy",
      start: "2026-11-09T02:00:00.000Z",
      end: "2026-11-09T04:00:00.000Z",
      redacted: true,
    });
    expect(Object.keys(result[0]).sort()).toEqual(
      ["id", "title", "start", "end", "allDay", "redacted"].sort(),
    );
    expect(JSON.stringify(result)).not.toMatch(/SHOULD|secret|upstream/);
  });
  it("redacts private and confidential events for viewers but allows owners", async () => {
    const viewer = await expand(detailedFixture);
    expect(viewer).toHaveLength(4);
    expect(viewer.filter((e) => e.redacted)).toHaveLength(2);
    expect(JSON.stringify(viewer)).not.toMatch(
      /medical|treatment|clinic|acquisition/,
    );
    const owner = await expand(detailedFixture, "owner");
    expect(owner.some((e) => e.title === "Secret medical appointment")).toBe(
      true,
    );
    expect(
      owner.some(
        (e) =>
          !e.redacted &&
          e.organizer === "William" &&
          e.attendees.includes("Alex"),
      ),
    ).toBe(true);
  });
  it("preserves all-day and multi-day dates without shifting them", async () => {
    const raw = calendar(
      event(
        "UID:holiday\r\nDTSTART;VALUE=DATE:20261110\r\nDTEND;VALUE=DATE:20261113\r\nSUMMARY:Away",
      ),
    );
    expect(await expand(raw)).toMatchObject([
      { start: "2026-11-10", end: "2026-11-13", allDay: true },
    ]);
  });
  it("interprets floating dates using the calendar zone", async () => {
    const raw = calendar(
      event(
        "UID:floating\r\nDTSTART:20261110T100000\r\nDTEND:20261110T110000\r\nSUMMARY:Floating",
      ),
    );
    expect(await expand(raw)).toMatchObject([
      { start: "2026-11-10T02:00:00.000Z", end: "2026-11-10T03:00:00.000Z" },
    ]);
  });
  it("honors X-WR-TIMEZONE for floating event times", async () => {
    const raw = calendar(
      event(
        "UID:floating\r\nDTSTART:20261110T100000\r\nDTEND:20261110T110000\r\nSUMMARY:Floating",
      ),
      "X-WR-TIMEZONE:America/New_York\r\n",
    );
    expect(await expand(raw)).toMatchObject([
      { start: "2026-11-10T15:00:00.000Z" },
    ]);
  });
  it("handles recurrence exceptions, moved occurrences, and inherited private flags", async () => {
    const raw = calendar(
      [
        event(
          "UID:recurring\r\nDTSTART;TZID=Asia/Shanghai:20261102T100000\r\nDTEND;TZID=Asia/Shanghai:20261102T110000\r\nRRULE:FREQ=WEEKLY;COUNT=4\r\nEXDATE;TZID=Asia/Shanghai:20261109T100000\r\nCLASS:PRIVATE\r\nSUMMARY:Secret series",
        ),
        event(
          "UID:recurring\r\nRECURRENCE-ID;TZID=Asia/Shanghai:20261116T100000\r\nDTSTART;TZID=Asia/Shanghai:20261117T120000\r\nDTEND;TZID=Asia/Shanghai:20261117T130000\r\nSUMMARY:Moved secret",
        ),
      ].join("\r\n"),
    );
    const result = await expand(raw);
    expect(result).toHaveLength(3);
    expect(result.every((e) => e.redacted)).toBe(true);
    expect(result.some((e) => e.start === "2026-11-17T04:00:00.000Z")).toBe(
      true,
    );
    expect(result.some((e) => e.start.startsWith("2026-11-09"))).toBe(false);
  });
  it("keeps the local hour across daylight-saving transitions", async () => {
    const raw = calendar(
      event(
        "UID:dst\r\nDTSTART;TZID=America/New_York:20261026T100000\r\nDTEND;TZID=America/New_York:20261026T110000\r\nRRULE:FREQ=WEEKLY;COUNT=3\r\nSUMMARY:DST series",
      ),
    );
    const result = await expand(raw, "viewer", new Date("2026-10-01Z"), to);
    expect(result.map((e) => e.start)).toEqual([
      "2026-10-26T14:00:00.000Z",
      "2026-11-02T15:00:00.000Z",
      "2026-11-09T15:00:00.000Z",
    ]);
  });
  it("parses VFREEBUSY periods, including duration-form endings and FREE exclusions", async () => {
    const raw = calendar(
      "BEGIN:VFREEBUSY\r\nUID:fb\r\nDTSTAMP:20261101T000000Z\r\nFREEBUSY;FBTYPE=BUSY:20261109T020000Z/PT1H\r\nFREEBUSY;FBTYPE=FREE:20261109T050000Z/20261109T060000Z\r\nEND:VFREEBUSY",
    );
    const result = await expand(raw, "public");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      start: "2026-11-09T02:00:00.000Z",
      end: "2026-11-09T03:00:00.000Z",
    });
  });
  it("rejects malformed calendars and unsafe event URLs", async () => {
    await expect(parseCalendar("<html>sign in</html>", "UTC")).rejects.toThrow(
      "valid ICS",
    );
    const raw = calendar(
      event(
        "UID:unsafe\r\nDTSTART:20261110T100000Z\r\nDTEND:20261110T110000Z\r\nSUMMARY:Unsafe\r\nURL:javascript:alert(1)",
      ),
    );
    expect(await expand(raw)).toMatchObject([{ url: null }]);
  });
  it("filters all-day events by the viewer's calendar dates across time zones", async () => {
    const raw = calendar(
      [
        event(
          "UID:day-10\r\nDTSTART;VALUE=DATE:20261110\r\nDTEND;VALUE=DATE:20261111\r\nSUMMARY:Day 10",
        ),
        event(
          "UID:day-11\r\nDTSTART;VALUE=DATE:20261111\r\nDTEND;VALUE=DATE:20261112\r\nSUMMARY:Day 11",
        ),
      ].join("\r\n"),
    );
    const parsed = await parseCalendar(raw, "Asia/Shanghai");
    const results = expandCalendar(
      parsed,
      new Date("2026-11-10T05:00:00Z"),
      new Date("2026-11-11T05:00:00Z"),
      "viewer",
      key,
      "Asia/Shanghai",
      "America/New_York",
    );
    expect(results).toMatchObject([{ title: "Day 10", start: "2026-11-10" }]);
  });
});
