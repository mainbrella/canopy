import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium, expect } from "@playwright/test";

// Explicitly remote: creates one disposable account in staging on each run.
const consoleOrigin = "https://stg.mainbrella.com";
const apiOrigin = "https://api-stg.mainbrella.com";
const output = new URL("../test-results/staging/", import.meta.url);
mkdirSync(output, { recursive: true });
const browser = await chromium.launch(process.env.CANOPY_CHROMIUM_PATH ? { executablePath: process.env.CANOPY_CHROMIUM_PATH } : {});
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  const authHosts = new Set();
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/auth/")) authHosts.add(url.origin);
  });
  const email = `canopy-staging-${randomUUID()}@example.com`;
  const password = randomBytes(24).toString("hex");
  const response = await page.goto(consoleOrigin);
  assert.equal(response.status(), 200);
  await expect(page.locator("#environment")).toHaveText("Staging");
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.locator("#google-sign-in")).toBeHidden();
  assert.equal(await page.locator('script[src="https://accounts.google.com/gsi/client"]').count(), 0);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  const loginResponse = page.waitForResponse(`${apiOrigin}/auth/email`);
  await page.getByRole("button", { name: "Continue with email" }).click();
  const login = await loginResponse;
  assert.equal(login.status(), 200);
  assert.equal((await login.json()).created, true);
  const setCookie = await login.headerValue("set-cookie");
  assert.match(setCookie, /^__Host-canopy_stg_session=/);
  assert.doesNotMatch(setCookie, /domain=/i);
  await expect(page.locator("#account-email")).toHaveText(email);
  const cookie = (await context.cookies()).find(cookie => cookie.name === "__Host-canopy_stg_session");
  assert.ok(cookie);
  assert.equal(cookie.domain, "api-stg.mainbrella.com");
  assert.equal(cookie.secure, true);
  assert.equal(cookie.httpOnly, true);
  assert.equal(cookie.sameSite, "None");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Account", exact: true })).toBeVisible();
  const viewports = [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1280, height: 800 }, { width: 1440, height: 900 }];
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: new URL(`account-${viewport.width}.png`, output).pathname });
  }
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  const revoked = await context.request.get(`${apiOrigin}/auth/me`, {
    headers: { Cookie: `${cookie.name}=${cookie.value}`, Origin: consoleOrigin },
  });
  assert.deepEqual(await revoked.json(), { user: null });
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("incorrect password");
  await page.getByRole("button", { name: "Continue with email" }).click();
  await expect(page.getByRole("alert")).toHaveText("Email or password is incorrect.");
  await page.getByLabel("Password", { exact: true }).fill(password);
  const repeatResponse = page.waitForResponse(`${apiOrigin}/auth/email`);
  await page.getByLabel("Password", { exact: true }).press("Enter");
  const repeat = await repeatResponse;
  assert.equal(repeat.status(), 200);
  assert.equal((await repeat.json()).created, false);
  await expect(page.getByRole("heading", { name: "Account", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.locator("#sign-in")).toBeVisible();
  await expect(page.getByRole("alert")).toBeHidden();
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: new URL(`sign-in-${viewport.width}.png`, output).pathname });
  }
  for (const origin of [consoleOrigin, "https://mainbrella.com", "http://localhost:5175"]) {
    const preflight = await context.request.fetch(`${apiOrigin}/auth/email`, {
      method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" },
    });
    assert.equal(preflight.status(), origin === consoleOrigin ? 204 : 403);
    assert.equal(preflight.headers()["access-control-allow-origin"], origin === consoleOrigin ? origin : undefined);
  }
  const google = await context.request.post(`${apiOrigin}/auth/google`, { headers: { Origin: consoleOrigin }, data: { credential: "disabled" } });
  assert.equal(google.status(), 503);
  assert.deepEqual(await google.json(), { error: "google_unavailable" });
  assert.deepEqual([...authHosts], [apiOrigin]);
  assert.deepEqual(errors, []);
  const result = { time: new Date().toISOString(), consoleOrigin, apiOrigin, email, passed: true,
    checks: ["HTTPS", "signup", "reload", "logout and session revocation", "wrong password", "repeat login", "staging-only API calls", "secure host-only cookie", "CORS", "Google disabled", "four viewport sizes", "no browser errors"] };
  writeFileSync(new URL("result.json", output), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
