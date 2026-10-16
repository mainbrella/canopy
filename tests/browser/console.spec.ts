import { test, expect } from "@playwright/test";

const user = {
  id: "console-user", email: `${"long-email".repeat(12)}@example.com`,
  name: "Console User", dob: null, created_at: "2026-10-16T00:00:00.000Z",
};

test("home lists uninstalled products and checks the instance Voice installation", async ({ page }) => {
  const requests: string[] = [];
  const errors: string[] = [];
  page.on("request", request => {
    if (request.resourceType() === "fetch") requests.push(new URL(request.url()).pathname);
  });
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Products", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.locator("#product-list li")).toHaveCount(3);
  await expect(page.locator("#product-list .product-availability")).toHaveText(["Not installed", "Not installed", "Not installed"]);
  for (const name of ["Compute", "Builder", "Voice"]) {
    await page.locator("#product-list").getByRole("link", { name: new RegExp(name) }).click();
    await expect(page.getByRole("heading", { name, exact: true })).toBeFocused();
    await expect(page.locator("#product-notice")).toHaveText(name === "Voice" ? "Voice isn’t installed in this deployment." : `${name} isn’t available in this deployment yet.`);
    await expect(page.getByRole("button", { name: /install|enable/i })).toBeHidden();
    await page.reload();
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Back to products" }).click();
  }
  await page.getByRole("link", { name: "Sign in", exact: true }).click();
  await expect(page.locator("#sign-in")).toBeVisible();
  await page.getByRole("link", { name: "Mainbrella home" }).click();
  await expect(page.locator("#products")).toBeVisible();
  await page.goBack();
  await expect(page.locator("#sign-in")).toBeVisible();
  expect(requests.every(path => ["/auth/me", "/products/voice"].includes(path))).toBe(true);
  expect(errors).toEqual([]);
});

test("unlisted products have no console entry or detail page, including an empty catalog", async ({ page }) => {
  await page.route("**/src/console-config.ts", route => route.fulfill({
    contentType: "text/javascript",
    body: 'export const consoleConfig = { name: "My Mainbrella", products: [{ id: "compute", name: "Compute", description: "Linux environments.", visible: false }] };',
  }));
  await page.goto("/");
  await expect(page.getByRole("link", { name: "My Mainbrella home" })).toBeVisible();
  await expect(page.locator("#product-list li")).toHaveCount(0);
  await expect(page.locator("#products-empty")).toBeVisible();
  await page.goto("/#/products/compute");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await page.getByRole("link", { name: "Back to products" }).click();
  await expect(page.getByRole("heading", { name: "Products", exact: true })).toBeFocused();
});

test("a failed session lookup leaves the product catalog usable and recovers through Account", async ({ page }) => {
  await page.route("**/auth/me", route => route.abort("failed"));
  await page.goto("/");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.locator("#product-list li")).toHaveCount(3);
  await page.getByRole("link", { name: "Account", exact: true }).click();
  await expect(page.locator("#sign-in")).toBeHidden();
  await page.unroute("**/auth/me");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.locator("#sign-in")).toBeVisible();
});

for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1280, height: 800 }, { width: 1440, height: 900 }]) {
  test(`product home and account menu fit ${viewport.width}×${viewport.height}`, async ({ page }, testInfo) => {
    await page.route("**/auth/me", route => route.fulfill({ json: { user } }));
    await page.setViewportSize(viewport);
    await page.goto("/");
    const toggle = page.getByRole("button", { name: "Account", exact: true });
    const panel = page.locator("#account-panel");
    await expect(toggle).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("products.png") });
    await toggle.focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("link", { name: "Account details" })).toBeFocused();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("#account-identity")).toHaveText(user.email);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const bounds = await panel.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({ path: testInfo.outputPath("account-menu.png") });
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(toggle).toBeFocused();
    await toggle.click();
    await page.getByRole("heading", { name: "Products", exact: true }).click({ position: { x: 1, y: 1 } });
    await expect(panel).toBeHidden();
    await toggle.click();
    await page.getByRole("link", { name: "Account details" }).focus();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Sign out" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(panel).toBeHidden();
    await toggle.click();
    await page.getByRole("link", { name: "Account details" }).click();
    await expect(page.getByRole("heading", { name: "Account", exact: true })).toBeFocused();
    await expect(panel).toBeHidden();
    await expect(page.locator("#account-email")).toHaveText(user.email);
    await expect(page.getByRole("link", { name: "Source", exact: true })).toHaveAttribute("href", "https://github.com/mainbrella/canopy");
  });
}
