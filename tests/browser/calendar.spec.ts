import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const pageUrl = "/?view=dayGridMonth&date=2026-11-09";
async function login(
  page: import("@playwright/test").Page,
  owner = false,
  options: { password?: string; rememberMe?: boolean } = {},
) {
  await page
    .getByRole("button", {
      name: owner ? "Owner sign-in" : "View details",
      exact: true,
    })
    .click();
  await page
    .getByLabel(owner ? "Owner password" : "Calendar password", { exact: true })
    .fill(
      options.password ??
        (owner ? "browser-owner-password" : "browser-viewer-password"),
    );
  if (options.rememberMe)
    await page.getByRole("checkbox", { name: "Keep me signed in" }).check();
  await page
    .getByRole("dialog")
    .getByRole("button", {
      name: owner ? "Sign in" : "View details",
      exact: true,
    })
    .click();
}
test("public privacy, views, date navigation, preferences, and keyboard controls", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(pageUrl);
  await expect(
    page.getByRole("heading", { name: "November 2026", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".calendar-event")).toHaveCount(4);
  await expect(
    page.locator(".calendar-event .event-time").first(),
  ).toBeVisible();
  await expect(
    page.locator(".calendar-event .event-time").first(),
  ).toContainText("10:00");
  await expect(page.getByText("Design review", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Week", exact: true }).click();
  await expect(page).toHaveURL(/view=timeGridWeek/);
  await page.getByRole("button", { name: "Day", exact: true }).click();
  await expect(page).toHaveURL(/view=timeGridDay/);
  await page.getByRole("button", { name: "Agenda", exact: true }).click();
  await expect(page).toHaveURL(/view=listMonth/);
  await page.getByLabel("More calendar views").selectOption("workWeek");
  await expect(page).toHaveURL(/view=workWeek/);
  await page.getByLabel("More calendar views").selectOption("multiMonthYear");
  await expect(page).toHaveURL(/view=multiMonthYear/);
  await page.keyboard.press("m");
  await expect(page).toHaveURL(/view=dayGridMonth/);
  await page.getByLabel("Jump to date").fill("2026-12-09");
  await expect(
    page.getByRole("heading", { name: "December 2026", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Display preferences" }).click();
  await page.getByLabel("Display time zone").selectOption("America/New_York");
  await page.getByLabel("Use 12-hour time").check();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await expect(page.getByRole("button", { name: "New York" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "New York" })).toBeVisible();
  expect(errors).toEqual([]);
});
test("password details, redaction, search, event panel, and relocking", async ({
  page,
}) => {
  await page.goto(pageUrl);
  await login(page);
  await expect(page.getByText("Design review", { exact: true })).toBeVisible();
  expect(
    (await page.context().cookies()).find(
      (cookie) => cookie.name === "wc_session",
    )?.expires,
  ).toBe(-1);
  await expect(
    page.getByText("Secret medical appointment", { exact: true }),
  ).toHaveCount(0);
  await page.getByText("Design review", { exact: true }).click();
  await expect(
    page.getByRole("complementary", { name: "Event details" }),
  ).toBeVisible();
  await expect(page.getByText("Studio 4", { exact: true })).toBeVisible();
  await page.getByRole("searchbox", { name: "Search events" }).fill("medical");
  await expect(page.locator(".calendar-event")).toHaveCount(0);
  await expect(
    page.getByRole("complementary", { name: "Event details" }),
  ).toHaveCount(0);
  await page.getByRole("searchbox", { name: "Search events" }).fill("Studio");
  await expect(page.locator(".calendar-event")).toHaveCount(1);
  await page.getByRole("button", { name: "Lock calendar" }).click();
  await expect(page.getByText("Design review", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("searchbox", { name: "Search events" }),
  ).toHaveCount(0);
  await expect(page.locator(".calendar-event")).toHaveCount(4);
  const storage = await page.evaluate(() => JSON.stringify(localStorage));
  expect(storage).not.toMatch(/Design review|Studio 4|browser-viewer-password/);
});
test("owner source settings, test connection, preferences, and public preview", async ({
  page,
}) => {
  await page.goto(pageUrl);
  await login(page, true);
  await expect(
    page.getByRole("heading", { name: "Calendar settings" }),
  ).toBeVisible();
  await page
    .locator("section")
    .filter({
      has: page.getByRole("heading", {
        name: "Public availability",
        exact: true,
      }),
    })
    .getByRole("button", { name: "Test connection" })
    .click();
  await expect(
    page.getByText(/The source returned a valid calendar/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Preferences", exact: true }).click();
  await page.getByLabel("Calendar title").fill("William’s Shared Calendar");
  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(
    page.getByText("Calendar settings saved.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Calendar sources", exact: true })
    .click();
  await page.getByRole("button", { name: "Preview public view" }).click();
  await expect(
    page.getByText("You’re previewing public availability."),
  ).toBeVisible();
  await expect(
    page.getByText("Secret medical appointment", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Return to owner view" }).click();
  await expect(
    page.getByText("Secret medical appointment", { exact: true }),
  ).toBeVisible();
});
test("mobile layout stays within the viewport and supports agenda details", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/?date=2026-11-09");
  await expect(
    page.getByRole("button", { name: "Agenda", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await login(page);
  await page.getByText("Design review", { exact: true }).click();
  await expect(page.getByText("Studio 4", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Close event details" }).click();
  await page.getByRole("button", { name: "Month", exact: true }).click();
  await expect(
    page.locator(".calendar-event .event-time").first(),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("public calendar has no critical or serious accessibility violations", async ({
  page,
}) => {
  await page.goto(pageUrl);
  await expect(page.locator(".calendar-event")).toHaveCount(4);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    results.violations.filter((v) =>
      ["critical", "serious"].includes(v.impact || ""),
    ),
  ).toEqual([]);
});

test("short visitor passwords and remembering access across browser contexts", async ({
  page,
  browser,
}) => {
  await page.goto(pageUrl);
  await login(page, true);
  await expect(
    page.getByRole("checkbox", { name: "Keep me signed in" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Access & security", exact: true })
    .click();
  await page.getByLabel("New shared calendar password").fill("1");
  await page
    .getByRole("button", { name: "Set viewer password", exact: true })
    .click();
  await expect(
    page.getByText(
      "Viewer password changed. Previous viewer sessions have been revoked.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await login(page, false, { password: "1", rememberMe: true });
  await expect(page.getByText("Design review", { exact: true })).toBeVisible();
  const state = await page.context().storageState();
  const cookie = state.cookies.find((cookie) => cookie.name === "wc_session")!;
  expect(cookie.expires * 1000 - Date.now()).toBeGreaterThan(29 * 86400_000);
  const restored = await browser.newContext({ storageState: state });
  try {
    const nextPage = await restored.newPage();
    await nextPage.goto(pageUrl);
    await expect(
      nextPage.getByText("Design review", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Lock calendar", exact: true })
      .click();
    await nextPage.reload();
    await expect(
      nextPage.getByText("Design review", { exact: true }),
    ).toHaveCount(0);
  } finally {
    await restored.close();
  }
  await login(page, true);
  await page
    .getByRole("button", { name: "Access & security", exact: true })
    .click();
  await page
    .getByLabel("New shared calendar password")
    .fill("browser-viewer-password");
  await page
    .getByRole("button", { name: "Set viewer password", exact: true })
    .click();
  await expect(
    page.getByText(
      "Viewer password changed. Previous viewer sessions have been revoked.",
      { exact: true },
    ),
  ).toBeVisible();
});
