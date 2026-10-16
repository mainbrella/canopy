import { createProductClient } from "@canopy/platform-client/products";
import type { User } from "@canopy/contracts/auth";
import type { VoiceInstallation } from "@canopy/contracts/products";

export function createVoiceProduct(getUser: () => User | null | undefined) {
  const api = createProductClient({ baseUrl: import.meta.env.VITE_AUTH_BASE_URL });
  const detail = document.getElementById("product-availability")!;
  const notice = document.getElementById("product-notice")!;
  const actions = document.getElementById("voice-actions")!;
  const open = document.getElementById("voice-open") as HTMLButtonElement;
  const install = document.getElementById("product-install") as HTMLButtonElement;
  const accessForm = document.getElementById("product-access") as HTMLFormElement;
  const accessUser = document.getElementById("product-access-user") as HTMLInputElement;
  const accessStatus = document.getElementById("product-access-status")!;
  const signIn = document.getElementById("voice-sign-in")!;
  const retry = document.getElementById("voice-retry") as HTMLButtonElement;
  const error = document.getElementById("voice-error")!;
  const installations = new Map<string, VoiceInstallation>();
  let loading = false;
  let refreshAgain = false;
  let failed = false;
  let busy = false;
  const labels = { not_installed: "Not installed", pending: "Installation requested", installing: "Installing…", failed: "Installation failed", ready: "Installed", registered: "Registered", unavailable: "Unavailable" };
  const selected = () => location.hash === "#/products/voice" ? "voice" : location.hash === "#/products/cut" ? "cut" : null;

  function render() {
    for (const id of ["voice", "cut"]) {
      const availability = document.querySelector<HTMLElement>(`[data-product="${id}"] .product-availability`);
      const installation = installations.get(id);
      if (availability) availability.textContent = installation ? labels[installation.state] : failed ? "Unavailable" : "Checking…";
    }
    const product = selected();
    actions.hidden = !product;
    if (!product) return;
    const installation = installations.get(product);
    detail.textContent = installation ? labels[installation.state] : failed ? "Unavailable" : "Checking…";
    const ready = installation?.state === "ready" || installation?.state === "registered";
    notice.hidden = ready && installation?.access !== "denied" && product === "voice";
    notice.textContent = ready ? product === "cut" ? "Cut uses its own admin password. Its registration was verified with Appflare; it does not share Canopy sign-in or billing."
      : "Ask the operator for access to Voice."
      : installation?.state === "not_installed" ? `${product === "voice" ? "Voice" : "Cut"} isn’t installed in this deployment.`
      : installation?.state === "pending" ? product === "cut" ? "Finish installation in Appflare, then have the operator reconcile the result."
        : "Waiting for the operator’s installation runner. You can reload or check again."
      : installation?.state === "installing" ? "Installation is running. Check again shortly."
      : installation?.state === "failed" ? "Installation did not finish. The operator can retry the request and runner."
      : "Could not verify the installation. Please try again.";
    if (!installation && !failed) notice.textContent = "Checking the installation…";
    open.hidden = !ready || !getUser() || installation?.access !== "allowed";
    open.disabled = busy;
    open.textContent = busy ? "Opening…" : `Open ${product === "voice" ? "Voice" : "Cut"}`;
    install.hidden = !installation?.canInstall || ready || installation?.state === "installing" || installation?.state === "pending" && product === "voice";
    install.disabled = busy;
    install.textContent = product === "cut" ? "Continue in Appflare" : installation?.state === "failed" ? "Retry installation" : "Install Voice";
    accessForm.hidden = !installation?.canManageAccess;
    signIn.hidden = !ready || getUser() !== null;
    signIn.textContent = `Sign in to open ${product === "voice" ? "Voice" : "Cut"}`;
    retry.hidden = !installation && !failed;
    retry.disabled = loading;
  }

  async function refresh() {
    if (loading) { refreshAgain = true; return; }
    loading = true; failed = false; error.hidden = true; render();
    try {
      for (const product of ["voice", "cut"] as const) {
        if (document.querySelector(`[data-product="${product}"]`)) installations.set(product, await api.readProduct(product));
      }
    } catch { failed = true; }
    finally { loading = false; render(); if (refreshAgain) { refreshAgain = false; void refresh(); } }
  }
  const showError = (cause: unknown) => {
    error.textContent = cause instanceof Error ? cause.message : "Please try again.";
    error.hidden = false;
  };
  retry.addEventListener("click", () => { void refresh(); });
  open.addEventListener("click", async () => {
    const product = selected(); const installation = product && installations.get(product);
    if (busy || !product || !getUser() || !installation || !installation.origin) return;
    busy = true; error.hidden = true; render();
    try { location.assign(await (product === "voice" ? api.openVoice(installation.origin, installation.basePath) : api.openCut(installation.origin))); }
    catch (cause) { showError(cause); }
    finally { busy = false; render(); }
  });
  install.addEventListener("click", async () => {
    const product = selected(); if (busy || !product) return;
    busy = true; error.hidden = true; render();
    try {
      const url = await api.install(product);
      if (url) location.assign(url);
      else await refresh();
    } catch (cause) { showError(cause); }
    finally { busy = false; render(); }
  });
  accessForm.addEventListener("submit", async event => {
    event.preventDefault(); const product = selected();
    if (busy || !product || !accessForm.reportValidity()) return;
    busy = true;
    const buttons = accessForm.querySelectorAll<HTMLButtonElement>("button"); buttons.forEach(button => { button.disabled = true; });
    try {
      const allowed = (event.submitter as HTMLButtonElement)?.value !== "revoke";
      await api.grantAccess(product, accessUser.value.trim(), allowed);
      accessStatus.textContent = allowed ? "Access granted." : "Access revoked.";
    } catch (cause) { showError(cause); }
    finally { busy = false; buttons.forEach(button => { button.disabled = false; }); render(); }
  });
  return { render, refresh };
}
