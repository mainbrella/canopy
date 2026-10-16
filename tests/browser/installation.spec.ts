import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

async function openVoice(page:Page){
  await page.goto("/#/account");
  await page.getByLabel("Email",{exact:true}).fill(`voice-${randomUUID()}@example.com`);
  await page.getByLabel("Password",{exact:true}).fill("a private test password");
  await page.getByRole("button",{name:"Continue with email"}).click();
  await expect(page.locator("#account-email")).toContainText("@example.com");
  await page.goto("/#/products/voice");
  await expect(page.locator("#product-availability")).toHaveText("Installed");
  await page.getByRole("button",{name:"Open Voice",exact:true}).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL("http://127.0.0.1:8794/");
  await expect(page.getByRole("tab",{name:"Receptionist",exact:true})).toBeVisible();
}

test("one instance install opens isolated workspaces and platform logout revokes product access",async({page,browser})=>{
  const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  await page.goto("/#/products/voice");
  await expect(page.locator("#product-availability")).toHaveText("Installed");
  await expect(page.getByRole("link",{name:"Sign in to open Voice"})).toBeVisible();
  expect((await page.request.post("http://127.0.0.1:8793/products/voice/open",{headers:{origin:"http://127.0.0.1:5175"}})).status()).toBe(401);
  await openVoice(page);
  await page.getByLabel("Agent name",{exact:true}).fill("Maya");
  await page.getByLabel("Business name",{exact:true}).fill("First user's workshop");
  await page.getByLabel("Greeting",{exact:true}).fill("Hello, how can I help?");
  await page.getByRole("button",{name:"Save receptionist"}).click();
  await expect(page.locator("#voice-save-status")).toContainText("Saved");
  await page.getByRole("radio",{name:"Text",exact:true}).check();
  await page.getByLabel("Message to receptionist").fill("Please take a message for Alex.");
  await page.getByRole("button",{name:"Send",exact:true}).click();
  await expect(page.getByRole("log",{name:"Test transcript"})).toContainText("I can take a message: Please take a message for Alex.");
  await page.getByRole("button",{name:"End call",exact:true}).click();
  await expect(page.locator("#voice-call-status")).toHaveText("Ready to test");
  const calls=(await(await page.request.get("http://127.0.0.1:8794/voice/calls")).json()).calls;
  const other=await browser.newContext();const second=await other.newPage();
  await openVoice(second);
  expect((await(await second.request.get("http://127.0.0.1:8794/voice/agent")).json()).agent).toBeNull();
  expect((await(await second.request.get("http://127.0.0.1:8794/voice/calls")).json()).calls).toEqual([]);
  expect((await second.request.get(`http://127.0.0.1:8794/voice/calls/${calls[0].id}`)).status()).toBe(404);
  await other.close();
  await page.reload();
  await expect(page.getByLabel("Business name",{exact:true})).toHaveValue("First user's workshop");
  await page.goto("http://127.0.0.1:5175/#/account");
  await expect(page.locator("#account-email")).toContainText("@example.com");
  await page.locator("#account-toggle").click();
  await page.getByRole("button",{name:"Sign out",exact:true}).click();
  await expect(page.locator("#sign-in")).toBeVisible();
  expect((await page.request.get("http://127.0.0.1:8794/voice/agent")).status()).toBe(401);
  expect(errors).toEqual([]);
});

test("failed runtime discovery recovers without an optimistic installed flag",async({page})=>{
  await page.route("**/products/voice",route=>route.fulfill({json:{product:"voice",state:"unavailable",version:"v1",origin:null}}));
  await page.goto("/#/products/voice");
  await expect(page.locator("#product-availability")).toHaveText("Unavailable");
  await expect(page.getByRole("button",{name:"Open Voice",exact:true})).toBeHidden();
  await page.unroute("**/products/voice");
  await page.getByRole("button",{name:"Check again"}).click();
  await expect(page.locator("#product-availability")).toHaveText("Installed");
});

for(const viewport of[{width:390,height:844},{width:768,height:1024},{width:1280,height:800},{width:1440,height:900}]){
  test(`installed Voice opens by keyboard and fits ${viewport.width}×${viewport.height}`,async({page},testInfo)=>{
    await page.setViewportSize(viewport);
    await openVoice(page);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:testInfo.outputPath("voice.png"),fullPage:true});
    await page.goto("http://127.0.0.1:5175/#/products/voice");
    await expect(page.getByRole("button",{name:"Open Voice",exact:true})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:testInfo.outputPath("installed-voice.png")});
  });
}
