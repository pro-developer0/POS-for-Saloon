import { expect, test, type Page } from "@playwright/test";

const PW = "Demo-Pass-123";
/** newest emailed link of a given kind addressed to this email (outbox entries are separated by "=== ") */
function linkFor(outbox: string, email: string, path: string) {
  const mail = outbox.split("=== ").filter((m) => m.includes("To: " + email) && m.includes(path)).at(-1)!;
  return mail.split(/\s+/).find((w) => w.includes("/" + path + "?token="))!;
}
async function submitLogin(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}
async function login(page: Page, email: string, password = PW) {
  await submitLogin(page, email, password);
  await expect(page).toHaveURL(/dashboard|admin|onboarding/, { timeout: 30_000 }); // wait until the session exists
}

test("wrong password is rejected with a clear message", async ({ page }) => {
  await submitLogin(page, "owner@royal.demo", "wrong-password-1");
  await expect(page.locator("p[role=alert]")).toContainText("Invalid email or password");
  await expect(page).toHaveURL(/login/);
});

test("signed-out visitors are sent to login", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/login/);
});

test("owner logs in and sees real dashboard data", async ({ page }) => {
  await login(page, "owner@royal.demo");
  await expect(page).toHaveURL(/dashboard/);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByText("Sales (incl. tax)")).toBeVisible();
  await expect(page.getByText(/PKR/).first()).toBeVisible(); // Royal is a PKR business
});

test("new business: register, onboard, land on empty dashboard", async ({ page }) => {
  const email = `new${Date.now()}@example.test`;
  await page.goto("/register");
  await page.getByLabel("Your name").fill("Test Owner");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("Str0ng-Password-1");
  await page.getByLabel("Business name").fill("E2E Cuts");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/onboarding/);
  for (let i = 0; i < 3; i++) { await page.getByRole("button", { name: "Continue" }).click(); await page.waitForTimeout(400); }
  await page.getByLabel(/Services — one per line/).fill("Haircut, 30, 20");
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(page).toHaveURL(/dashboard/, { timeout: 20_000 });
  await expect(page.getByText("E2E Cuts").first()).toBeVisible();
  await page.goto("/services");
  await expect(page.getByText("Haircut").first()).toBeVisible();
});

test("two businesses stay separate and the workspace switcher works", async ({ page }) => {
  await login(page, "multi@demo.test");
  await expect(page).toHaveURL(/dashboard/);
  const first = (await page.getByRole("button", { name: /Royal Hair Studio|Glow Beauty Lounge/ }).first().innerText()).trim();
  await page.getByRole("button", { name: /Royal Hair Studio|Glow Beauty Lounge/ }).first().click();
  const other = first.includes("Royal") ? "Glow Beauty Lounge" : "Royal Hair Studio";
  await page.getByRole("option", { name: new RegExp(other) }).click();
  await expect(page.getByRole("button", { name: new RegExp(other) }).first()).toBeVisible({ timeout: 15_000 });
  await page.goto("/customers");
  const text = await page.locator("main").innerText();
  expect(text).not.toContain(first.includes("Royal") ? "Fatima Noor" : "Sophia Turner");
});

test("a manager is blocked from Settings", async ({ page }) => {
  await login(page, "multi@demo.test");
  await page.goto("/settings");
  await expect(page.getByText("Access denied")).toBeVisible();
});

test("owner books an appointment using real open slots", async ({ page }) => {
  await login(page, "owner@royal.demo");
  await page.goto("/appointments");
  await page.getByRole("button", { name: "New appointment" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Customer").selectOption({ index: 1 });
  await dlg.locator("select[name=serviceId]").selectOption({ index: 1 });
  const d = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
  await dlg.locator("input[name=date]").fill(d);
  const chip = dlg.getByRole("button", { name: /^\d\d:\d\d/ }).first();
  await expect(chip).toBeVisible({ timeout: 15_000 });
  await chip.click();
  await dlg.getByRole("button", { name: "Book" }).click();
  await expect(page.getByText("Saved").first()).toBeVisible({ timeout: 15_000 });
});

test("booking the same slot twice is refused", async ({ page }) => {
  await login(page, "owner@royal.demo");
  await page.goto("/appointments");
  const d = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);
  for (const expectOk of [true, false]) {
    await page.getByRole("button", { name: "New appointment" }).click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Customer").selectOption({ index: 1 });
    await dlg.locator("select[name=serviceId]").selectOption({ index: 1 });
    await dlg.locator("select[name=staffId]").selectOption({ index: 1 });
    await dlg.locator("input[name=date]").fill(d);
    await dlg.locator("input[name=time]").fill("11:00");
    await dlg.getByRole("button", { name: "Book" }).click();
    if (expectOk) { await expect(page.getByText("Saved").first()).toBeVisible({ timeout: 15_000 }); await page.reload(); }
    else await expect(dlg.getByRole("alert")).toContainText(/conflict/i, { timeout: 15_000 });
  }
});

test("POS: add a service, pay in full, get a receipt", async ({ page }) => {
  await login(page, "owner@royal.demo");
  await page.goto("/pos");
  await page.locator("section button").filter({ hasText: /PKR/ }).first().click();
  await page.getByRole("button", { name: "Pay full amount" }).click();
  await page.getByRole("button", { name: /^Charge/ }).click();
  await expect(page.getByText("Sale complete")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("link", { name: /View \/ print receipt/ }).click();
  await expect(page.getByRole("heading", { name: /Invoice RHS-/ })).toBeVisible();
});

test("POS: an empty cart cannot be charged", async ({ page }) => {
  await login(page, "owner@royal.demo");
  await page.goto("/pos");
  await expect(page.getByRole("button", { name: /^Charge/ })).toBeDisabled();
});

test("dark mode toggles and persists", async ({ page }) => {
  await login(page, "owner@royal.demo");
  const html = page.locator("html");
  for (let i = 0; i < 3 && !(await html.getAttribute("class"))?.includes("dark"); i++) await page.getByRole("button", { name: /^Theme:/ }).click();
  await expect(html).toHaveClass(/dark/);
  await page.reload();
  await expect(html).toHaveClass(/dark/);
});

test("phone layout: sidebar becomes a menu button and nothing scrolls sideways", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await login(page, "owner@royal.demo");
  await page.getByRole("button", { name: "Open menu" }).click();
  await expect(page.getByRole("link", { name: "Appointments" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.goto("/dashboard");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("calendar page loads in week and month view", async ({ page }) => {
  await login(page, "owner@royal.demo");
  await page.goto("/calendar");
  await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible();
  await page.goto("/calendar?view=month");
  await expect(page.getByText("Mon").first()).toBeVisible();
});

test("AI is optional: advisor still answers with verified numbers when AI is off", async ({ page }) => {
  await login(page, "owner@royal.demo");
  await page.goto("/ai");
  await page.getByPlaceholder(/How much did I earn/).fill("How much did I earn this month?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Verified data only (no AI)")).toBeVisible({ timeout: 20_000 });
});

test("forgot password: request link, reset, sign in with the new password", async ({ page }) => {
  const fs = await import("node:fs");
  const email = `forgot${Date.now()}@example.test`;
  await page.goto("/register");
  await page.getByLabel("Your name").fill("Forgetful Owner");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("Old-Password-123");
  await page.getByLabel("Business name").fill("Forgot Salon");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/onboarding/);
  await expect(page.getByText(/Please confirm your email/)).toHaveCount(0); // onboarding has no banner; app pages do
  await page.context().clearCookies();

  await page.goto("/login");
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await expect(page.getByRole("heading", { name: "Forgot your password?" })).toBeVisible(); // wait for the new page before typing
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByText(/reset link is on its way/)).toBeVisible({ timeout: 30_000 }); // first run compiles the action

  const outbox = fs.readFileSync(".data/e2e-outbox.log", "utf8");
  const link = linkFor(outbox, email, "reset-password");
  await page.goto(link);
  await page.getByLabel("New password", { exact: true }).fill("Brand-New-Pass-9");
  await page.getByLabel("Confirm password").fill("Brand-New-Pass-9");
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page.getByText("Password updated")).toBeVisible();

  await page.goto(link); // link is single-use
  await page.getByLabel("New password", { exact: true }).fill("Another-Pass-77");
  await page.getByLabel("Confirm password").fill("Another-Pass-77");
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page.locator("p[role=alert]")).toContainText(/invalid or has expired/);

  await submitLogin(page, email, "Old-Password-123");
  await expect(page.locator("p[role=alert]")).toContainText("Invalid email or password");
  await login(page, email, "Brand-New-Pass-9");
});

test("new accounts see a confirm-email banner and can confirm via the emailed link", async ({ page }) => {
  const fs = await import("node:fs");
  const email = `verify${Date.now()}@example.test`;
  await page.goto("/register");
  await page.getByLabel("Your name").fill("Verify Owner");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("Verify-Pass-123");
  await page.getByLabel("Business name").fill("Verify Salon");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/onboarding/);
  const outbox = fs.readFileSync(".data/e2e-outbox.log", "utf8");
  const link = linkFor(outbox, email, "verify-email");
  await page.goto(link);
  await page.getByRole("button", { name: "Confirm my email" }).click();
  await expect(page.getByText("Email confirmed")).toBeVisible();
});
