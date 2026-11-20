import { expect, test, type Page } from "@playwright/test";

// Readiness sweep: every main page at phone + tablet width, for both demo salons.
// Fails on sideways overflow or server errors; saves screenshots to test-results/readiness for a human to eyeball.
const PW = "Demo-Pass-123";
const PAGES = [
  "dashboard", "appointments", "calendar", "customers", "services", "staff", "pos", "invoices", "payments",
  "inventory", "suppliers", "purchases", "expenses", "reports", "coupons", "day-close", "notifications",
  "ai", "settings", "help", "account",
];
const SIZES = [
  { name: "phone", width: 390, height: 800 },
  { name: "tablet", width: 820, height: 1100 },
];

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PW);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/dashboard|admin|onboarding|account/, { timeout: 30_000 });
}

for (const [tenant, email] of [["royal", "owner@royal.demo"], ["glow", "owner@glow.demo"]] as const) {
  test(`readiness sweep: ${tenant}`, async ({ page }) => {
    test.setTimeout(600_000);
    await login(page, email);
    const problems: string[] = [];
    for (const size of SIZES) {
      await page.setViewportSize({ width: size.width, height: size.height });
      for (const p of PAGES) {
        const res = await page.goto("/" + p, { waitUntil: "networkidle" });
        const url = page.url();
        if (/forbidden|not-found/.test(url) || res?.status() === 404) continue; // module not enabled for this business type
        if ((res?.status() ?? 200) >= 500) problems.push(`${tenant} ${size.name} /${p}: HTTP ${res?.status()}`);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        if (overflow > 1) problems.push(`${tenant} ${size.name} /${p}: scrolls sideways by ${overflow}px`);
        await page.screenshot({ path: `test-results/readiness/${tenant}-${size.name}-${p}.png`, fullPage: true });
      }
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });
}
