import { test, expect } from "@playwright/test";

test("create account, reload, sign out, reject a wrong password, and sign back in", async ({ page, context }) => {
  const email = `canopy-${crypto.randomUUID()}@example.com`;
  const password = "local test password";
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator("#google-sign-in")).toBeHidden();
  expect(await page.locator('script[src="https://accounts.google.com/gsi/client"]').count()).toBe(0);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Continue with email" }).click();
  await expect(page.getByRole("heading", { name: "Account", exact: true })).toBeVisible();
  await expect(page.locator("#account-email")).toHaveText(email);
  expect((await context.cookies()).find(cookie => cookie.name === "canopy_session")?.httpOnly).toBe(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Account", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("incorrect password");
  await page.getByRole("button", { name: "Continue with email" }).click();
  await expect(page.getByRole("alert")).toHaveText("Email or password is incorrect.");
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Password", { exact: true }).press("Enter");
  await expect(page.getByRole("heading", { name: "Account", exact: true })).toBeVisible();
  await page.route("**/auth/logout", route => route.fulfill({ status: 503, json: { error: "auth_unavailable" } }));
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("alert")).toHaveText("Could not sign you out. Please try again.");
  await expect(page.locator("#account")).toBeVisible();
  await page.unroute("**/auth/logout");
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.reload();
  await expect(page.locator("#sign-in")).toBeVisible();
  expect(errors).toEqual([]);
});

test("session check failures can be retried without showing a false signed-out state", async ({ page }) => {
  await page.route("**/auth/me", route => route.abort("failed"));
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("Could not reach sign-in");
  await expect(page.locator("#sign-in")).toBeHidden();
  await page.unroute("**/auth/me");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.locator("#sign-in")).toBeVisible();
  await expect(page.getByRole("alert")).toBeHidden();
});

for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1280, height: 800 }, { width: 1440, height: 900 }]) {
  test(`sign-in and long account details fit ${viewport.width}×${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.locator("#sign-in")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("sign-in.png") });
    await page.getByLabel("Email", { exact: true }).focus();
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Password", { exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Continue with email" })).toBeFocused();
    await page.route("**/auth/me", route => route.fulfill({ json: { user: {
      id: "12345678-1234-1234-1234-123456789012",
      email: `${"long-address".repeat(12)}@example.com`,
      name: "A long account name that should wrap comfortably on a small screen",
      dob: null, created_at: "2026-10-16T00:00:00.000Z",
    } } }));
    await page.reload();
    await expect(page.locator("#account")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("account.png") });
  });
}
