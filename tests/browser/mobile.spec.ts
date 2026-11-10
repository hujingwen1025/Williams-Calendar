import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("phone layouts expose events, dock controls, and readable sheets at narrow widths", async ({
  browser,
  browserName,
}, testInfo) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto("/?date=2026-11-09");
    await expect(page.locator(".calendar-event")).toHaveCount(4);
    for (const width of [320, 375, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(
        page.getByRole("button", { name: "Agenda", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(
        page.getByRole("button", { name: "Zoom in calendar", exact: true }),
      ).toBeInViewport();
      await expect(
        page.getByRole("button", { name: "Calendar options", exact: true }),
      ).toBeInViewport();
      const bounds = await page
        .locator(".calendar-event")
        .first()
        .boundingBox();
      expect(bounds!.y).toBeLessThan(370);
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page
        .getByRole("button", { name: "Calendar options", exact: true })
        .click();
      const options = page.getByRole("dialog", {
        name: "Calendar options",
        exact: true,
      });
      await expect(
        options.getByRole("button", { name: "Close dialog" }),
      ).toBeInViewport();
      await options
        .getByRole("button", { name: "Display preferences", exact: true })
        .click();
      await expect(page.getByLabel("Display time zone")).toHaveCSS(
        "font-size",
        "16px",
      );
      expect(
        await page
          .getByRole("dialog")
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
      await page
        .getByRole("button", { name: "Close dialog", exact: true })
        .click();
    }
    await page.setViewportSize({ width: 390, height: 844 });
    const lastEvent = page.locator(".calendar-event").last();
    await lastEvent.scrollIntoViewIfNeeded();
    const scrollBeforeDetails = await page.evaluate(() => scrollY);
    await lastEvent.click();
    await expect(
      page.getByRole("dialog", { name: "Event details", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Close event details", exact: true })
      .click();
    await expect
      .poll(() => page.evaluate(() => scrollY))
      .toBe(scrollBeforeDetails);
    await page.locator(".wordmark").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath("mobile-agenda.png"),
    });
    const a11y = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(
      a11y.violations.filter((v) =>
        ["critical", "serious"].includes(v.impact || ""),
      ),
    ).toEqual([]);
    await page
      .getByRole("button", { name: "Calendar options", exact: true })
      .click();
    await page.getByLabel("Go to date", { exact: true }).fill("2026-11-09");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: "Week", exact: true }).click();
    await expect(page).toHaveURL(/view=timeGridWeek/);
    // Wider day columns allow readable events and pan inside the calendar, not the page.
    await expect
      .poll(() =>
        page
          .locator(".calendar-event")
          .first()
          .evaluate((el) => el.getBoundingClientRect().width),
      )
      .toBeGreaterThan(100);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const pan = page.getByRole("region", {
      name: "Scrollable week calendar",
      exact: true,
    });
    await pan.focus();
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(() => pan.evaluate((el) => el.scrollLeft))
      .toBeGreaterThan(0);
    await expect(page).toHaveURL(/view=timeGridWeek/);
    const panBounds = await pan.boundingBox();
    const dayHeaderBefore = await page
      .locator(".calendar-day-header")
      .first()
      .boundingBox();
    if (browserName === "chromium") {
      const cdp = await context.newCDPSession(page);
      const y = panBounds!.y + 180;
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: 310, y, id: 1 }],
      });
      for (const x of [270, 220, 170, 110]) {
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x, y, id: 1 }],
        });
      }
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await expect
        .poll(() => pan.evaluate((el) => el.scrollLeft))
        .toBeGreaterThan(100);
    }
    await pan.evaluate(
      (el) =>
        new Promise<void>((resolve) => {
          let last = el.scrollLeft,
            stable = 0;
          function check() {
            const next = el.scrollLeft;
            stable = Math.abs(next - last) < 0.1 ? stable + 1 : 0;
            last = next;
            if (stable >= 5) resolve();
            else requestAnimationFrame(check);
          }
          requestAnimationFrame(check);
        }),
    );
    if (browserName === "chromium") {
      const dayHeaderAfter = await page
        .locator(".calendar-day-header")
        .first()
        .boundingBox();
      expect(dayHeaderAfter!.x).toBeLessThan(dayHeaderBefore!.x - 80);
    }
    const ruler = await page
      .locator(".calendar-slot-header")
      .first()
      .boundingBox();
    expect(Math.abs(ruler!.x - panBounds!.x)).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: testInfo.outputPath("mobile-week.png"),
    });
    await page.getByRole("button", { name: "Day", exact: true }).click();
    await page
      .getByRole("button", { name: "Zoom in calendar", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Reset calendar zoom (125%)",
        exact: true,
      }),
    ).toBeInViewport();
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(
      page.getByRole("button", { name: "Calendar options", exact: true }),
    ).toBeInViewport();
    await page
      .getByRole("button", { name: "Calendar options", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Close dialog", exact: true }),
    ).toBeInViewport();
    expect(
      await page
        .getByRole("dialog")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.setViewportSize({ width: 320, height: 740 });
    await page
      .getByLabel("More calendar views", { exact: true })
      .selectOption("multiMonthYear");
    await expect(page).toHaveURL(/view=multiMonthYear/);
    expect(
      await page
        .locator(".calendar-pan-frame")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await page
      .getByLabel("More calendar views", { exact: true })
      .selectOption("workWeek");
    await expect(
      page.getByRole("region", {
        name: "Scrollable week calendar",
        exact: true,
      }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
