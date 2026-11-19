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
  await page.getByLabel("Business type").selectOption("hair_salon");
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

test("each business sees only its own data, and there is no business switcher", async ({ page }) => {
  await login(page, "owner@royal.demo");
  await expect(page.getByRole("button", { name: /Royal Hair Studio|Glow Beauty Lounge/ })).toHaveCount(0); // switcher removed
  await page.goto("/customers");
  let text = await page.locator("main").innerText();
  expect(text).toContain("Fatima Noor");
  expect(text).not.toContain("Sophia Turner");
  await page.context().clearCookies();
  await login(page, "owner@glow.demo");
  await page.goto("/customers");
  text = await page.locator("main").innerText();
  expect(text).toContain("Sophia Turner");
  expect(text).not.toContain("Fatima Noor");
});

test("business type is locked after sign-up (cannot be changed in Settings)", async ({ page }) => {
  await login(page, "owner@royal.demo");
  await page.goto("/settings");
  await expect(page.getByLabel("Business type")).toBeDisabled();
  await expect(page.getByText(/cannot be changed/)).toBeVisible();
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
  await page.getByRole("link", { name: "View receipt" }).click();
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
  await page.getByLabel("Business type").selectOption("hair_salon");
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
  await page.getByLabel("Business type").selectOption("hair_salon");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/onboarding/);
  const outbox = fs.readFileSync(".data/e2e-outbox.log", "utf8");
  const link = linkFor(outbox, email, "verify-email");
  await page.goto(link);
  await page.getByRole("button", { name: "Confirm my email" }).click();
  await expect(page.getByText("Email confirmed")).toBeVisible();
});

test("pharmacy business: no appointment features, pharmacy wording, modules are switchable", async ({ page }) => {
  const email = `pharma${Date.now()}@example.test`;
  await page.goto("/register");
  await page.getByLabel("Your name").fill("Pharma Owner");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("Pharma-Pass-123");
  await page.getByLabel("Business name").fill("Green Cross Pharmacy");
  await page.getByLabel("Business type").selectOption("hair_salon");
  await page.getByLabel("Business type").selectOption("pharmacy");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/onboarding/);
  for (let i = 0; i < 3; i++) { await page.getByRole("button", { name: "Continue" }).click(); await page.waitForTimeout(400); }
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(page).toHaveURL(/dashboard/, { timeout: 30_000 });

  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: "Inventory" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Point of Sale" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Patients / customers" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Calendar" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Appointments" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Services" })).toHaveCount(0);

  await page.goto("/calendar"); // blocked on the server, not just hidden
  await expect(page).toHaveURL(/dashboard/);

  await page.goto("/pos");
  await expect(page.getByRole("button", { name: "Services", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Medicines & items" })).toBeVisible();

  await page.goto("/settings");
  await page.getByRole("tab", { name: "Modules" }).click();
  await expect(page.getByLabel(/Batches & expiry/)).toBeChecked();
  await expect(page.getByLabel(/Appointments & calendar/)).not.toBeChecked();
});

test.describe("pharmacy pack", () => {
  test("pharmacist sees stock + dispensing screens but no Settings", async ({ page }) => {
    await login(page, "pharmacist@pharmacy.demo");
    const nav = page.getByRole("navigation", { name: "Main" });
    for (const name of ["Point of Sale", "Inventory", "Expiry alerts", "Purchases"]) await expect(nav.getByRole("link", { name })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Settings" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Calendar" })).toHaveCount(0);
    await page.goto("/settings");
    await expect(page.getByText("Access denied")).toBeVisible();
  });

  test("dashboard warns about expired batches still in stock", async ({ page }) => {
    await login(page, "owner@pharmacy.demo");
    await expect(page.getByText(/expired batch.* still in stock/)).toBeVisible();
  });

  test("POS shows strength + strips, blocks expired stock, and sells a strip", async ({ page }) => {
    await login(page, "owner@pharmacy.demo");
    await page.goto("/pos");
    await expect(page.getByText("Paracetamol · 500 mg")).toBeVisible();
    await expect(page.getByText(/expired — not sellable/).first()).toBeVisible();
    await page.getByRole("button", { name: "Add one strip of Panadol 500mg" }).click();
    await expect(page.getByText("Panadol 500mg (strip of 10)")).toBeVisible();
    await page.getByRole("button", { name: "Pay full amount" }).click();
    await page.getByRole("button", { name: /^Charge/ }).click();
    await expect(page.getByText("Sale complete")).toBeVisible({ timeout: 30_000 });
    await page.getByRole("link", { name: "View receipt" }).click();
    await expect(page.getByLabel("Invoice document").getByText("Panadol 500mg (strip of 10)")).toBeVisible();
  });

  test("expiry page lists the expired batch and the owner can write it off", async ({ page }) => {
    await login(page, "owner@pharmacy.demo");
    await page.goto("/expiry");
    const row = page.getByRole("row", { name: /Augmentin 625mg/ }).filter({ hasText: "AUG-2305" });
    await expect(row).toContainText(/Expired \d+ days? ago/);
    page.once("dialog", (d) => d.accept());
    await row.getByRole("button", { name: "Write off" }).click();
    await expect(page.getByText(/unit\(s\) written off/)).toBeVisible();
    await expect(page.getByRole("row", { name: /AUG-2305/ })).toHaveCount(0);
  });

  test("inventory shows generic names, nearest expiry and per-batch details", async ({ page }) => {
    await login(page, "owner@pharmacy.demo");
    await page.goto("/inventory");
    await expect(page.getByText("Nearest expiry")).toBeVisible();
    await expect(page.getByText(/Paracetamol/).first()).toBeVisible();
    await page.getByRole("row", { name: /Panadol 500mg/ }).getByRole("link", { name: "Batches" }).click();
    await expect(page.getByRole("cell", { name: "PAN-2409" })).toBeVisible();
  });

  test("a salon never sees pharmacy screens", async ({ page }) => {
    await login(page, "owner@royal.demo");
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Expiry alerts" })).toHaveCount(0);
    await page.goto("/expiry");
    await expect(page).toHaveURL(/dashboard/);
  });
});

test.describe("POS extras: returns, coupons, credit, receipts, day close", () => {
  test("owner returns an item and a credit note appears on the sale", async ({ page }) => {
    await login(page, "owner@glow.demo");
    await page.goto("/invoices?status=paid");
    await page.locator("table a[href^='/invoices/']").first().click();
    await expect(page.getByRole("heading", { name: /^Invoice / })).toBeVisible();
    await page.getByRole("button", { name: "Return items" }).click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel(/Return quantity for/).first().fill("1");
    await dlg.getByLabel(/Reason/).fill("customer unhappy");
    await dlg.getByRole("button", { name: "Issue credit note" }).click();
    await expect(page.getByText(/Credit note CN-\d+/).first()).toBeVisible();
    await page.reload();
    await expect(page.getByText("Credit notes (returns)")).toBeVisible();
    await page.getByRole("link", { name: /^CN-/ }).first().click();
    await expect(page.getByRole("heading", { name: /^Credit note CN-/ })).toBeVisible();
  });

  test("create a coupon and use it at the POS", async ({ page }) => {
    await login(page, "owner@royal.demo");
    await page.goto("/coupons");
    await page.getByRole("button", { name: "New coupon" }).click();
    const dlg = page.getByRole("dialog");
    await dlg.locator("input[name=code]").fill("E2E10");
    await dlg.locator("input[name=value]").fill("10");
    await dlg.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("cell", { name: /E2E10/ })).toBeVisible();

    await page.goto("/pos");
    await page.locator("section button").filter({ hasText: /PKR/ }).first().click();
    await page.getByLabel("Coupon code").fill("e2e10");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByText("E2E10", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Pay full amount" }).click();
    await page.getByRole("button", { name: /^Charge/ }).click();
    await expect(page.getByText("Sale complete")).toBeVisible({ timeout: 30_000 });

    await page.goto("/coupons");
    await expect(page.getByRole("row", { name: /E2E10/ })).toContainText("1"); // use counted
  });

  test("a bad coupon is refused with a clear message", async ({ page }) => {
    await login(page, "owner@royal.demo");
    await page.goto("/pos");
    await page.locator("section button").filter({ hasText: /PKR/ }).first().click();
    await page.getByLabel("Coupon code").fill("NOPE123");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByText(/not valid/i).first()).toBeVisible();
  });

  test("credit sale needs a customer, then the balance is collected from the customer page", async ({ page }) => {
    await login(page, "owner@royal.demo");
    await page.goto("/pos");
    const credit = page.getByLabel(/Leave balance on the customer account/);
    await expect(credit).toBeDisabled(); // walk-in cannot take credit
    await page.getByLabel("Customer", { exact: true }).selectOption({ label: "Zainab Ali" });
    await expect(credit).toBeEnabled();
    await credit.check();
    await page.locator("section button").filter({ hasText: /PKR/ }).first().click();
    await page.getByRole("button", { name: /^Charge/ }).click();
    await expect(page.getByText("Sale complete")).toBeVisible({ timeout: 30_000 });

    await page.goto("/customers?q=Zainab");
    await page.getByRole("link", { name: "Zainab Ali" }).first().click();
    await expect(page.getByText("Owes (account balance)")).toBeVisible();
    await expect(page.getByText("Unpaid invoices", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Receive payment" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(/Payment of .* received/)).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "Receive payment" })).toHaveCount(0);
  });

  test("thermal receipt is a plain printable page without the app menu", async ({ page }) => {
    await login(page, "owner@royal.demo");
    await page.goto("/pos");
    await page.locator("section button").filter({ hasText: /PKR/ }).first().click();
    await page.getByRole("button", { name: "Pay full amount" }).click();
    await page.getByRole("button", { name: /^Charge/ }).click();
    await expect(page.getByText("Sale complete")).toBeVisible({ timeout: 30_000 });
    const href = await page.getByRole("link", { name: "Print thermal receipt" }).getAttribute("href");
    expect(href).toMatch(/^\/receipt\/[0-9a-f-]{36}\?auto=1$/);
    await page.goto(href!.replace("?auto=1", ""));
    await expect(page.getByLabel("Receipt")).toContainText("RECEIPT");
    await expect(page.getByLabel("Receipt")).toContainText("Royal Hair Studio");
    await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0);
  });

  test("closing the till records expected vs counted cash", async ({ page }) => {
    await login(page, "owner@royal.demo");
    await page.goto("/day-close");
    await expect(page.getByRole("heading", { name: "Day close" })).toBeVisible();
    await page.getByRole("button", { name: "Close the till" }).click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Cash counted now").fill("0");
    await expect(dlg.getByText("Expected cash")).toBeVisible();
    await dlg.getByRole("button", { name: "Save close" }).click();
    await expect(page.getByText(/Shift closed/)).toBeVisible();
    await page.reload();
    await expect(page.getByRole("cell", { name: /Balanced|PKR/ }).first()).toBeVisible();
  });
});
