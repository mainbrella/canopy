import { test, expect, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/login.html");
  await page.getByLabel("Password", { exact: true }).fill("voice-browser-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Receptionist", exact: true })).toBeVisible();
}

test("owner signs in, saves settings, completes a text call, reloads history, deletes a transcript and signs out", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
  expect((await page.request.get("/voice/agent")).status()).toBe(401);
  await page.getByRole("link", { name: "Sign in", exact: true }).click();
  await page.getByLabel("Password", { exact: true }).fill("incorrect");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("That password is incorrect");
  await page.getByLabel("Password", { exact: true }).fill("voice-browser-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByLabel("Agent name", { exact: true }).fill("Maya");
  await page.getByLabel("Business name", { exact: true }).fill("Northside Bicycle Repair");
  await page.getByLabel("Greeting", { exact: true }).fill("Hello, how can I help?");
  await page.getByRole("button", { name: "Save receptionist" }).click();
  await expect(page.locator("#voice-save-status")).toContainText("Saved");
  await page.reload();
  await expect(page.getByLabel("Business name", { exact: true })).toHaveValue("Northside Bicycle Repair");
  await page.getByRole("radio", { name: "Text", exact: true }).check();
  await page.getByLabel("Message to receptionist").fill("Please ask Alex to call me.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("log", { name: "Test transcript" })).toContainText("I can take a message: Please ask Alex to call me.");
  await page.getByRole("button", { name: "End call", exact: true }).click();
  await expect(page.locator("#voice-call-status")).toHaveText("Ready to test");
  await page.getByRole("tab", { name: "Call history" }).click();
  await page.reload();
  const view = page.getByRole("button", { name: /View transcript/ }).first();
  await view.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Please ask Alex to call me.");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(view).toBeFocused();
  await view.click();
  page.once("dialog", confirmation => confirmation.accept());
  await dialog.getByRole("button", { name: "Delete transcript" }).click();
  await expect(page.locator("#voice-calls-feedback")).toHaveText("Transcript deleted.");
  await expect(page.locator("#voice-calls-list").getByRole("row")).toHaveCount(0);
  const session = (await page.context().cookies()).find(cookie => cookie.name === "canopy_voice_session")!;
  expect(session.httpOnly).toBe(true);
  expect(session.sameSite).toBe("Strict");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  expect((await page.request.get("/voice/agent")).status()).toBe(401);
  expect(errors).toEqual([]);
});

test("service failures offer retry and failed saves preserve the draft", async ({ page }) => {
  await login(page);
  await page.route("**/voice/config", route => route.fulfill({ status: 503, json: { error: "voice_unavailable" } }));
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("temporarily unavailable");
  await page.unroute("**/voice/config");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await page.getByLabel("Business name", { exact: true }).fill("Unsaved workshop details");
  await page.route("**/voice/agent", route => route.request().method() === "PUT"
    ? route.fulfill({ status: 503, json: { error: "voice_unavailable" } }) : route.continue());
  await page.getByRole("button", { name: "Save receptionist" }).click();
  await expect(page.getByRole("alert")).toContainText("temporarily unavailable");
  await expect(page.getByLabel("Business name", { exact: true })).toHaveValue("Unsaved workshop details");
  await page.unroute("**/voice/agent");
  await page.getByRole("button", { name: "Save receptionist" }).click();
  await expect(page.locator("#voice-save-status")).toContainText("Saved");
});

for (const [width, height] of [[390, 844], [768, 1024], [1280, 800], [1440, 900]]) {
  test(`Voice tabs, controls and dialogs fit ${width}×${height}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    await login(page);
    const tab = page.getByRole("tab", { name: "Receptionist", exact: true });
    await tab.focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Call history" })).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Phone connection" })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#voice-twilio-status")).toHaveText("Not configured");
    await page.keyboard.press("ArrowRight");
    await page.getByRole("button", { name: "Search numbers", exact: true }).click();
    await expect(page.locator("#voice-number-error")).toBeVisible();
    for (const name of ["Receptionist", "Call history", "Phone connection", "Search numbers"]) {
      await page.getByRole("tab", { name, exact: true }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await tab.click();
    await page.screenshot({ path: testInfo.outputPath(`voice-${width}.png`), fullPage: true });
    await page.getByRole("radio", { name: "Text", exact: true }).check();
    await page.getByLabel("Message to receptionist").fill(`Please take a message for viewport ${width}.`);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByRole("log", { name: "Test transcript" })).toContainText("I can take a message:");
    await page.getByRole("button", { name: "End call", exact: true }).click();
    await expect(page.locator("#voice-call-status")).toHaveText("Ready to test");
    await page.getByRole("tab", { name: "Call history" }).click();
    await page.getByRole("button", { name: /View transcript/ }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(`viewport ${width}`);
    const box = await dialog.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    expect(box!.y + box!.height).toBeLessThanOrEqual(height);
    await page.screenshot({ path: testInfo.outputPath(`voice-dialog-${width}.png`) });
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
  });
}
