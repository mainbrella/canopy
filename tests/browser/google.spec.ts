import { test, expect, type Page } from "@playwright/test";

const scriptURL = "https://accounts.google.com/gsi/client";
const user = { id: "google-browser-user", email: "google@example.com", name: "Google Test User", dob: null, created_at: "2026-10-16T00:00:00.000Z" };
// This suite exercises the callback boundary, not a real Google account/popup.
// Signing-key verification is covered separately by the Worker tests.
const sdkScript = `
  let callback;
  window.google = { accounts: { id: {
    initialize(options) {
      callback = options.callback;
      window.googleTestOptions = options;
      window.googleTestInitializations = (window.googleTestInitializations || 0) + 1;
      window.googleTestCredential = credential => callback({ credential });
    },
    renderButton(host) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary';
      button.textContent = 'Continue with Google';
      button.onclick = () => callback({ credential: 'browser.google.credential' });
      host.appendChild(button);
    },
    disableAutoSelect() { window.googleTestSignedOut = true; }
  } } };
`;
async function stubGoogle(page: Page) {
  await page.route(scriptURL, route => route.fulfill({ contentType: "text/javascript", body: sdkScript }));
}
async function deliverCredential(page: Page, credential?: string) {
  await page.evaluate(value => {
    (window as unknown as { googleTestCredential: (credential?: string) => void }).googleTestCredential(value);
  }, credential);
}

test("configured Google callback signs in, restores the session and signs out", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  let signedIn = false;
  let attempts = 0;
  await stubGoogle(page);
  await page.route("**/auth/me", route => route.fulfill({ json: { user: signedIn ? user : null } }));
  await page.route("**/auth/google", async route => {
    expect(route.request().postDataJSON()).toEqual({ credential: "browser.google.credential" });
    attempts++;
    signedIn = true;
    await route.fulfill({ json: { user, created: attempts === 1 } });
  });
  await page.route("**/auth/logout", async route => { signedIn = false; await route.fulfill({ json: { ok: true } }); });
  await page.goto("/");
  await page.getByLabel("Password", { exact: true }).fill("unsent password");
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.locator("#account")).toBeVisible();
  await expect(page.locator("#account-email")).toHaveText(user.email);
  await expect(page.locator("#status")).toHaveText("Account created.");
  await expect(page.locator("#heading")).toBeFocused();
  await expect(page.locator("#password")).toHaveValue("");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.locator("#status")).toHaveText("Signed out.");
  expect(await page.evaluate(() => (window as unknown as { googleTestSignedOut: boolean }).googleTestSignedOut)).toBe(true);
  const options = await page.evaluate(() => (window as unknown as { googleTestOptions: Record<string, unknown> }).googleTestOptions);
  expect(options).toMatchObject({ client_id: "canopy-browser-test.apps.googleusercontent.com", auto_select: false, ux_mode: "popup" });
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.locator("#status")).toHaveText("Signed in.");
  await page.reload();
  await expect(page.locator("#account")).toBeVisible();
  expect(await page.locator(`script[src="${scriptURL}"]`).count()).toBe(0);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("Google loading does not block email and a failed script can be retried", async ({ page }, testInfo) => {
  let releaseScript!: () => void;
  const wait = new Promise<void>(resolve => { releaseScript = resolve; });
  await page.route(scriptURL, async route => { await wait; await route.abort("failed"); });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#google-status")).toHaveText("Loading Google sign-in…");
  await expect(page.getByRole("button", { name: "Continue with email" })).toBeEnabled();
  await page.getByLabel("Email", { exact: true }).fill("retained@example.com");
  await page.getByLabel("Password", { exact: true }).fill("retained password");
  releaseScript();
  await expect(page.locator("#google-status")).toContainText("Use email or retry Google");
  await page.screenshot({ path: testInfo.outputPath("google-unavailable.png") });
  await page.unroute(scriptURL);
  await stubGoogle(page);
  await page.getByRole("button", { name: "Retry Google" }).click();
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue("retained@example.com");
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue("retained password");
  expect(await page.locator(`script[src="${scriptURL}"]`).count()).toBe(1);
});

test("a stalled Google script times out while email sign-in remains usable", async ({ page }) => {
  await page.clock.install();
  let releaseScript!: () => void;
  const wait = new Promise<void>(resolve => { releaseScript = resolve; });
  await page.route(scriptURL, async route => { await wait; await route.abort("failed"); });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#google-status")).toHaveText("Loading Google sign-in…");
  await page.clock.fastForward(12_001);
  await expect(page.getByRole("button", { name: "Retry Google" })).toBeVisible();
  await page.getByLabel("Email", { exact: true }).fill(`canopy-google-fallback-${crypto.randomUUID()}@example.com`);
  await page.getByLabel("Password", { exact: true }).fill("fallback password");
  await page.getByRole("button", { name: "Continue with email" }).click();
  await expect(page.locator("#account")).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  releaseScript();
});

test("Google errors preserve email input and reject duplicate or late callbacks", async ({ page }) => {
  await stubGoogle(page);
  let attempts = 0;
  let releaseSignIn!: () => void;
  const wait = new Promise<void>(resolve => { releaseSignIn = resolve; });
  await page.route("**/auth/google", async route => {
    attempts++;
    if (attempts === 1) {
      await wait;
      await route.fulfill({ status: 409, json: { error: "identity_conflict" } });
    } else if (attempts === 2) {
      await route.fulfill({ status: 503, json: { error: "google_unavailable" } });
    } else {
      await route.fulfill({ json: { user, created: false } });
    }
  });
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("retained@example.com");
  await page.getByLabel("Password", { exact: true }).fill("retained password");
  const button = page.getByRole("button", { name: "Continue with Google" });
  await button.click();
  await expect(page.getByLabel("Email", { exact: true })).toBeDisabled();
  await expect(page.locator("#google-button")).toHaveAttribute("inert", "");
  await deliverCredential(page, "duplicate");
  releaseSignIn();
  await expect(page.getByRole("alert")).toContainText("another sign-in method");
  expect(attempts).toBe(1);
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue("retained password");
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue("retained@example.com");
  await deliverCredential(page);
  await expect(page.getByRole("alert")).toContainText("could not be completed");
  expect(attempts).toBe(1);
  await button.click();
  await expect(page.getByRole("alert")).toContainText("Google sign-in is unavailable");
  await expect(page.getByRole("button", { name: "Continue with email" })).toBeEnabled();
  await button.click();
  await expect(page.locator("#account")).toBeVisible();
  await deliverCredential(page, "late");
  expect(attempts).toBe(3);
});

for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1280, height: 800 }, { width: 1440, height: 900 }]) {
  test(`optional Google control fits and is keyboard reachable at ${viewport.width}×${viewport.height}`, async ({ page }, testInfo) => {
    await stubGoogle(page);
    await page.setViewportSize(viewport);
    await page.goto("/");
    const button = page.getByRole("button", { name: "Continue with Google" });
    await expect(button).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator("#heading").focus();
    await page.keyboard.press("Tab");
    await expect(button).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Email", { exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Password", { exact: true })).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath("google-sign-in.png") });
  });
}
