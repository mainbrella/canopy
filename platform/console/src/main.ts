import { createAuthClient } from "@canopy/platform-client/auth";
import type { SignInResult, User } from "@canopy/contracts/auth";
import { createGoogleSignIn } from "./google-sign-in.ts";
import "./style.css";

const auth = createAuthClient();
function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing element: ${id}`);
  return value as T;
}

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
let busy = false;
const googleClientID = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim();
const google = googleClientID ? createGoogleSignIn(element("google-sign-in"), googleClientID, credential => {
  void signIn(() => auth.signInWithGoogle(credential));
}) : null;
if (google) element("sign-in-prompt").textContent = "Continue with Google or email to sign in or create an account.";

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
  heading.textContent = user ? "Account" : "Sign in";
  form.hidden = Boolean(user);
  account.hidden = !user;
  retry.hidden = true;
  element("name").textContent = user?.name || "—";
  element("account-email").textContent = user?.email || "—";
  element("account-id").textContent = user?.id || "";
  const date = user ? new Date(user.created_at) : null;
  element("created").textContent = date && Number.isFinite(date.getTime()) ? date.toLocaleDateString(undefined, { dateStyle: "medium" }) : "—";
  if (focus) heading.focus();
  if (!user) void google?.load();
}

async function checkSession() {
  if (busy) return;
  clearError();
  setBusy(true, "Checking your sign-in…");
  try { showUser((await auth.readSession())?.user ?? null); }
  catch (cause) { showError(cause); retry.hidden = false; }
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
void checkSession();
