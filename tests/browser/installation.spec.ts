import { test, expect, request as apiRequest, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

async function operator(){
  const api=await apiRequest.newContext({baseURL:'http://127.0.0.1:8793',extraHTTPHeaders:{origin:'http://127.0.0.1:5175'}});
  const response=await api.post('/auth/email',{data:{email:'operator@installation.test',password:'private fixture operator password'}});
  expect(response.ok()).toBe(true);return api;
}
async function openVoice(page:Page){
  await page.goto("/#/account");
  await page.getByLabel("Email",{exact:true}).fill(`voice-${randomUUID()}@example.com`);
  await page.getByLabel("Password",{exact:true}).fill("a private test password");
  await page.getByRole("button",{name:"Continue with email"}).click();
  await expect(page.locator("#account-email")).toContainText("@example.com");
  const user=(await(await page.request.get('http://127.0.0.1:8793/auth/me')).json()).user;
  const api=await operator();expect((await api.post('/products/voice/access',{data:{userId:user.id,allowed:true}})).ok()).toBe(true);await api.dispose();
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

test('operator requests persist from zero products and connected Voice coexists with registered Cut',async({page},testInfo)=>{
  const api=await operator();
  try{
    expect((await api.post('/__test/reset')).ok()).toBe(true);
    await page.goto('/#/account');
    await page.getByLabel('Email',{exact:true}).fill('operator@installation.test');
    await page.getByLabel('Password',{exact:true}).fill('private fixture operator password');
    await page.getByRole('button',{name:'Continue with email'}).click();
    await expect(page.locator('#account-email')).toHaveText('operator@installation.test');
    await page.goto('/#/products/voice');
    await expect(page.locator('#product-availability')).toHaveText('Not installed');
    for(const viewport of [{width:390,height:844},{width:768,height:1024},{width:1280,height:800},{width:1440,height:900}]){
      await page.setViewportSize(viewport);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await page.screenshot({path:testInfo.outputPath(`operator-${viewport.width}.png`)});
    }
    await page.getByRole('button',{name:'Install Voice',exact:true}).focus();await page.keyboard.press('Enter');
    await expect(page.locator('#product-availability')).toHaveText('Installation requested');
    await page.reload();await expect(page.locator('#product-availability')).toHaveText('Installation requested');
    // The credentialed runner is simulated here; unit tests exercise its SQL and evidence validation.
    expect((await api.post('/__test/voice')).ok()).toBe(true);
    await page.getByRole('button',{name:'Check again'}).click();
    await expect(page.getByRole('button',{name:'Open Voice',exact:true})).toBeVisible();
    await page.goto('/#/products/cut');
    await expect(page.getByRole('button',{name:'Continue in Appflare'})).toBeVisible();
    await page.route('https://appflare.example/install/cut',route=>route.fulfill({body:'Appflare admin review fixture'}));
    await page.getByRole('button',{name:'Continue in Appflare'}).click();
    await expect(page).toHaveURL('https://appflare.example/install/cut');
    expect((await api.post('/__test/cut')).ok()).toBe(true);
    await page.goto('http://127.0.0.1:5175/#/');await page.reload();
    await expect(page.locator('[data-product="voice"]')).toContainText('Installed');
    await expect(page.locator('[data-product="cut"]')).toContainText('Registered');
    await page.getByRole('link',{name:/Cut A link shortener/}).click();
    await expect(page.locator('#product-notice')).toContainText('does not share Canopy sign-in or billing');
    await page.getByRole('button',{name:'Open Cut',exact:true}).click();
    await expect(page).toHaveURL('http://127.0.0.1:8795/admin');
    await expect(page.getByLabel('Admin password')).toBeVisible();
  }finally{await api.post('/__test/voice');await api.dispose();}
});
