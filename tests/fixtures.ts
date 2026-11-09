export const calendar = (events: string, extra = "") =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//William Calendar Tests//EN\r\n${extra}${events}\r\nEND:VCALENDAR\r\n`;
export const event = (properties: string) =>
  `BEGIN:VEVENT\r\nDTSTAMP:20261101T000000Z\r\n${properties}\r\nEND:VEVENT`;
export const detailedFixture = calendar(
  [
    event(
      "UID:public-event\r\nDTSTART:20261109T020000Z\r\nDTEND:20261109T030000Z\r\nSUMMARY:Design review\r\nDESCRIPTION:Roadmap planning\r\nLOCATION:Studio 4\r\nORGANIZER;CN=William:mailto:william@example.com\r\nATTENDEE;CN=Alex:mailto:alex@example.com\r\nURL:https://meet.example.com/review",
    ),
    event(
      "UID:private-event\r\nDTSTART:20261110T020000Z\r\nDTEND:20261110T030000Z\r\nSUMMARY:Secret medical appointment\r\nDESCRIPTION:Private treatment notes\r\nLOCATION:Hidden clinic\r\nCLASS:PRIVATE",
    ),
    event(
      "UID:confidential-event\r\nDTSTART:20261111T020000Z\r\nDTEND:20261111T030000Z\r\nSUMMARY:Confidential acquisition\r\nCLASS:CONFIDENTIAL",
    ),
    event(
      "UID:free-event\r\nDTSTART:20261112T020000Z\r\nDTEND:20261112T030000Z\r\nSUMMARY:Optional reading\r\nTRANSP:TRANSPARENT",
    ),
    event(
      "UID:cancelled-event\r\nDTSTART:20261113T020000Z\r\nDTEND:20261113T030000Z\r\nSUMMARY:Cancelled meeting\r\nSTATUS:CANCELLED",
    ),
  ].join("\r\n"),
);
export const busyFixture = calendar(
  [
    event(
      "UID:upstream-secret-uid\r\nDTSTART:20261109T020000Z\r\nDTEND:20261109T030000Z\r\nSUMMARY:SHOULD NEVER LEAK\r\nDESCRIPTION:secret description\r\nLOCATION:secret location",
    ),
    event(
      "UID:overlap\r\nDTSTART:20261109T023000Z\r\nDTEND:20261109T040000Z\r\nSUMMARY:Another event",
    ),
    event(
      "UID:free\r\nDTSTART:20261110T020000Z\r\nDTEND:20261110T030000Z\r\nSUMMARY:Free event\r\nTRANSP:TRANSPARENT",
    ),
  ].join("\r\n"),
);
