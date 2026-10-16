// Google script loading/button behavior adapted from raindrop/src/login.ts.
interface GoogleSignIn {
  initialize(options: {
    client_id: string;
    callback: (response: { credential?: string }) => void;
    auto_select: boolean;
    ux_mode: "popup";
  }): void;
  renderButton(host: HTMLElement, options: { type: "standard"; theme: "filled_black"; size: "large"; text: "continue_with"; shape: "rectangular" }): void;
  disableAutoSelect(): void;
}
declare global { interface Window { google?: { accounts?: { id?: GoogleSignIn } } } }

function loadScript(): Promise<GoogleSignIn> {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id);
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    const finish = (failed = false) => {
      clearTimeout(timeout);
      script.onload = script.onerror = null;
      const sdk = window.google?.accounts?.id;
      if (failed || !sdk) {
        script.remove();
        reject(new Error("Google sign-in could not load."));
      } else resolve(sdk);
    };
    const timeout = setTimeout(() => finish(true), 12_000);
    script.onload = () => finish();
    script.onerror = () => finish(true);
    document.head.appendChild(script);
  });
}

export function createGoogleSignIn(root: HTMLElement, clientID: string, onCredential: (credential?: string) => void) {
  const host = root.querySelector<HTMLElement>("#google-button")!;
  const status = root.querySelector<HTMLElement>("#google-status")!;
  const retry = root.querySelector<HTMLButtonElement>("#google-retry")!;
  let sdk: GoogleSignIn | undefined;
  let initialized = false;
  let loading = false;
  let ready = false;
  let busy = false;
  root.hidden = false;

  async function load() {
    if (loading || ready) return;
    loading = true;
    host.hidden = true;
    status.hidden = false;
    status.textContent = "Loading Google sign-in…";
    retry.hidden = true;
    root.setAttribute("aria-busy", "true");
    try {
      sdk = await loadScript();
      if (!initialized) {
        sdk.initialize({ client_id: clientID, callback: response => onCredential(response?.credential), auto_select: false, ux_mode: "popup" });
        initialized = true;
      }
      host.replaceChildren();
      host.hidden = false;
      sdk.renderButton(host, { type: "standard", theme: "filled_black", size: "large", text: "continue_with", shape: "rectangular" });
      status.hidden = true;
      ready = true;
    } catch {
      host.hidden = true;
      status.textContent = "Google sign-in could not load. Use email or retry Google.";
      retry.hidden = false;
    } finally {
      loading = false;
      retry.disabled = busy;
      root.setAttribute("aria-busy", "false");
    }
  }
  retry.addEventListener("click", () => { void load(); });
  return {
    load,
    setBusy(value: boolean) {
      busy = value;
      // GIS owns its button/iframe, so a disabled fieldset is insufficient.
      host.inert = value;
      host.setAttribute("aria-disabled", String(value));
      retry.disabled = value || loading;
    },
    disableAutoSelect() {
      // A provider failure must not turn successful session revocation into an error.
      try { sdk?.disableAutoSelect(); } catch { /* The local session is already revoked. */ }
    },
  };
}
