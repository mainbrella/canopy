import { createAuthClient } from "@canopy/platform-client/auth";
import type { SignInResult, User } from "@canopy/contracts/auth";
import { createGoogleSignIn } from "./google-sign-in.ts";
import { createAccountMenu } from "./account-menu.ts";
import { consoleConfig } from "./console-config.ts";
import { createVoiceProduct } from "./voice-product.ts";
import "./style.css";

const auth = createAuthClient({ baseUrl: import.meta.env.VITE_AUTH_BASE_URL });
function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing element: ${id}`);
  return value as T;
}

element("environment").textContent = import.meta.env.MODE === "staging" ? "Staging" : import.meta.env.MODE === "operator" ? "" : "Local development";
const heading = element("heading");
const status = element("status");
const error = element("error");
const retry = element<HTMLButtonElement>("retry");
const form = element<HTMLFormElement>("sign-in");
const fields = form.querySelector("fieldset")!;
const email = element<HTMLInputElement>("email");
const password = element<HTMLInputElement>("password");
const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
const account = element("account");
const signOut = element<HTMLButtonElement>("sign-out");
const accountMenuRoot = element("account-menu");
const accountMenu = createAccountMenu(accountMenuRoot);
const signInLink = element("sign-in-link");
const products = consoleConfig.products.filter(product => product.visible);
let currentUser: User | null | undefined;
let busy = false;
const googleClientID = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim();
const google = googleClientID ? createGoogleSignIn(element("google-sign-in"), googleClientID, credential => {
  void signIn(() => auth.signInWithGoogle(credential));
}) : null;
if (google) element("sign-in-prompt").textContent = "Continue with Google or email to sign in or create an account.";

element("instance-name").textContent = consoleConfig.name;
element("instance-name").parentElement!.setAttribute("aria-label", `${consoleConfig.name} home`);
for (const product of products) {
  const row = document.createElement("li");
  row.dataset.product = product.id;
  const link = document.createElement("a");
  link.href = `#/products/${product.id}`;
  link.innerHTML = '<div><h2></h2><p class="muted"></p></div><span class="product-availability">Not installed</span><span class="product-arrow" aria-hidden="true">→</span>';
  link.querySelector("h2")!.textContent = product.name;
  link.querySelector("p")!.textContent = product.description;
  row.append(link);
  element("product-list").append(row);
}
element("products-empty").hidden = products.length > 0;
const voiceProduct = products.some(product => ["voice", "cut"].includes(product.id)) ? createVoiceProduct(() => currentUser) : null;

function renderView(focus = false) {
  const route = location.hash || "#/";
  const isAccount = route === "#/account";
  const isHome = route === "#/";
  const product = products.find(item => route === `#/products/${item.id}`);
  heading.textContent = isAccount ? (currentUser === null ? "Sign in" : "Account") : isHome ? "Products" : product?.name ?? "Page not found";
  document.title = `${heading.textContent} · ${consoleConfig.name}`;
  form.hidden = !isAccount || currentUser !== null;
  account.hidden = !isAccount || !currentUser;
  element("products").hidden = !isHome;
  element("product-detail").hidden = !product;
  element("not-found").hidden = isHome || isAccount || Boolean(product);
  element("products-link").toggleAttribute("aria-current", false);
  element("account-link").toggleAttribute("aria-current", false);
  if (isHome || product) element("products-link").setAttribute("aria-current", "page");
  if (isAccount) element("account-link").setAttribute("aria-current", "page");
  if (product) {
    element("product-availability").textContent = "Not installed";
    element("product-notice").hidden = false;
    element("product-description").textContent = product.description;
    element("product-notice").textContent = `${product.name} isn’t available in this deployment yet.`;
  }
  voiceProduct?.render();
  if (focus) heading.focus();
  if (!form.hidden) void google?.load();
}

window.addEventListener("hashchange", () => {
  accountMenu.close();
  renderView(true);
  void voiceProduct?.refresh();
});
document.querySelector<HTMLAnchorElement>(".skip-link")!.addEventListener("click", event => {
  event.preventDefault();
  element("main").focus();
});

function clearError() { error.hidden = true; error.textContent = ""; }
function showError(cause: unknown) {
  error.textContent = cause instanceof Error ? cause.message : "Something went wrong. Please try again.";
  error.hidden = false;
}

function setBusy(value: boolean, message = "") {
  busy = value;
  fields.disabled = value;
  signOut.disabled = value;
  retry.disabled = value;
  google?.setBusy(value);
  status.textContent = message;
  form.setAttribute("aria-busy", String(value));
  account.setAttribute("aria-busy", String(value));
}

function showUser(user: User | null, focus = false) {
  currentUser = user;
  accountMenuRoot.hidden = !user;
  signInLink.hidden = Boolean(user);
  signInLink.textContent = "Sign in";
  element("account-identity").textContent = user?.email || "";
  if (!user) accountMenu.close();
  retry.hidden = true;
  element("name").textContent = user?.name || "—";
  element("account-email").textContent = user?.email || "—";
  element("account-id").textContent = user?.id || "";
  const date = user ? new Date(user.created_at) : null;
  element("created").textContent = date && Number.isFinite(date.getTime()) ? date.toLocaleDateString(undefined, { dateStyle: "medium" }) : "—";
  renderView(focus);
  void voiceProduct?.refresh();
}

async function checkSession() {
  if (busy) return;
  clearError();
  setBusy(true, "Checking your sign-in…");
  try { showUser((await auth.readSession())?.user ?? null); }
  catch (cause) {
    showError(cause);
    retry.hidden = false;
    signInLink.textContent = "Account";
    signInLink.hidden = false;
  }
  finally { setBusy(false); }
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  if (busy || !form.reportValidity()) return;
  await signIn(() => auth.signInWithEmail(email.value, password.value), true);
});

async function signIn(authenticate: () => Promise<SignInResult>, withEmail = false) {
  if (busy || form.hidden) return;
  clearError();
  setBusy(true, "Signing in…");
  if (withEmail) submit.textContent = "Continuing…";
  let message = "";
  try {
    const result = await authenticate();
    password.value = "";
    showUser(result.user, true);
    message = result.created ? "Account created." : "Signed in.";
  } catch (cause) { showError(cause); }
  finally { setBusy(false, message); submit.textContent = "Continue with email"; }
}

signOut.addEventListener("click", async () => {
  if (busy) return;
  accountMenu.close(true);
  clearError();
  setBusy(true, "Signing out…");
  let message = "";
  try {
    await auth.signOut();
    google?.disableAutoSelect();
    password.value = "";
    showUser(null, true);
    message = "Signed out.";
  } catch (cause) { showError(cause); }
  finally { setBusy(false, message); }
});

retry.addEventListener("click", () => { void checkSession(); });
renderView();
void checkSession();
