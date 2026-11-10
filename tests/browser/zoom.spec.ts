import { test, expect, type Page } from "@playwright/test";
const calendarUrl = "/?view=timeGridWeek&date=2026-11-09";
async function openCalendar(page: Page, details = false) {
  await page.goto(calendarUrl);
  await expect(page.locator(".calendar-event")).toHaveCount(4);
  if (details) {
    await page
      .getByRole("button", { name: "View details", exact: true })
      .click();
    await page
      .getByLabel("Calendar password", { exact: true })
      .fill("browser-viewer-password");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "View details", exact: true })
      .click();
    await expect(
      page.getByText("Quick project check-in", { exact: true }),
    ).toBeVisible();
  }
}
const zoomLabel = (percent: number) => `Reset calendar zoom (${percent}%)`;
test("zoom stretches short events, exposes permitted previews, preserves the date, and persists", async ({
  page,
}) => {
  await openCalendar(page, true);
  const date = new URL(page.url()).searchParams.get("date");
  const short = page
    .locator(".calendar-event")
    .filter({ has: page.getByText("Quick project check-in", { exact: true }) });
  const before = await short.evaluate(
    (element) => element.getBoundingClientRect().height,
  );
  const hourEvent = page
    .locator(".calendar-event")
    .filter({ has: page.getByText("Design review", { exact: true }) });
  const hourBefore = await hourEvent.evaluate(
    (element) => element.getBoundingClientRect().height,
  );
  for (let i = 0; i < 4; i++)
    await page
      .getByRole("button", { name: "Zoom in calendar", exact: true })
      .click();
  await expect(
    page.getByRole("button", { name: zoomLabel(200), exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      short.evaluate((element) => element.getBoundingClientRect().height),
    )
    .toBeGreaterThan(before);
  // Very short events have a minimum hit height; a full-hour event measures
  // the actual time-axis scale without that minimum clamping the comparison.
  await expect
    .poll(() =>
      hourEvent.evaluate((element) => element.getBoundingClientRect().height),
    )
    .toBeGreaterThan(hourBefore * 1.8);
  await expect
    .poll(() =>
      short.evaluate((element) => {
        const block = element.getBoundingClientRect();
        const content = element
          .querySelector(".event-content")!
          .getBoundingClientRect();
        return content.top >= block.top && content.bottom <= block.bottom;
      }),
    )
    .toBe(true);
  await expect(page.getByText("Hidden clinic", { exact: true })).toHaveCount(0);
  await hourEvent.scrollIntoViewIfNeeded();
  await expect(hourEvent.getByText("Studio 4", { exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("date")).toBe(date);
  expect(new URL(page.url()).searchParams.get("view")).toBe("timeGridWeek");
  await page.reload();
  await expect(
    page.getByRole("button", { name: zoomLabel(200), exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Month", exact: true }).click();
  const tall = await page
    .locator(".calendar-sheet")
    .evaluate((element) => element.getBoundingClientRect().height);
  await page.getByRole("button", { name: zoomLabel(200), exact: true }).click();
  await expect
    .poll(() =>
      page
        .locator(".calendar-sheet")
        .evaluate((element) => element.getBoundingClientRect().height),
    )
    .toBeLessThan(tall * 0.7);
});
test("zoom shortcuts, limits, wheel gestures, and normal scrolling", async ({
  page,
}) => {
  await openCalendar(page);
  await page.keyboard.press("+");
  await expect(
    page.getByRole("button", { name: zoomLabel(125), exact: true }),
  ).toBeVisible();
  await page.keyboard.press("-");
  await page.keyboard.press("0");
  await expect(
    page.getByRole("button", { name: zoomLabel(100), exact: true }),
  ).toBeVisible();
  const consumed = await page.locator(".calendar-sheet").evaluate((element) => {
    const wheel = new WheelEvent("wheel", {
      deltaY: -30,
      ctrlKey: true,
      cancelable: true,
      bubbles: true,
      clientY: element.getBoundingClientRect().top + 200,
    });
    element.dispatchEvent(wheel);
    return wheel.defaultPrevented;
  });
  expect(consumed).toBe(true);
  await expect(
    page.getByRole("button", { name: zoomLabel(125), exact: true }),
  ).toBeVisible();
  const normalScrollConsumed = await page
    .locator(".calendar-sheet")
    .evaluate((element) => {
      const wheel = new WheelEvent("wheel", {
        deltaY: 100,
        cancelable: true,
        bubbles: true,
      });
      element.dispatchEvent(wheel);
      return wheel.defaultPrevented;
    });
  expect(normalScrollConsumed).toBe(false);
  for (let i = 0; i < 14; i++) await page.keyboard.press("+");
  await expect(
    page.getByRole("button", { name: "Zoom in calendar", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: zoomLabel(400), exact: true }),
  ).toBeVisible();
  for (let i = 0; i < 16; i++) await page.keyboard.press("-");
  await expect(
    page.getByRole("button", { name: "Zoom out calendar", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: zoomLabel(50), exact: true }),
  ).toBeVisible();
  await page.keyboard.press("0");
  await expect(
    page.getByRole("button", { name: zoomLabel(100), exact: true }),
  ).toBeVisible();
});
test("touch pinch zooms the calendar without changing browser scale or overflowing mobile width", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  try {
    const page = await context.newPage();
    await page.goto("/?view=dayGridMonth&date=2026-11-09");
    await expect(page.locator(".calendar-event")).toHaveCount(4);
    const browserScale = await page.evaluate(
      () => window.visualViewport?.scale,
    );
    const box = await page.locator(".calendar-sheet").boundingBox();
    const cdp = await context.newCDPSession(page);
    const y = box!.y + 100;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { x: box!.x + 100, y, id: 1 },
        { x: box!.x + 200, y, id: 2 },
      ],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { x: box!.x + 75, y, id: 1 },
        { x: box!.x + 225, y, id: 2 },
      ],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect(
      page.getByRole("button", { name: zoomLabel(150), exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => window.visualViewport?.scale)).toBe(
      browserScale,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } finally {
    await context.close();
  }
});
