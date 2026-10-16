import { createProductClient } from "@canopy/platform-client/products";
import type { User } from "@canopy/contracts/auth";
import type { VoiceInstallation } from "@canopy/contracts/products";

export function createVoiceProduct(getUser: () => User | null | undefined) {
  const api = createProductClient({ baseUrl: import.meta.env.VITE_AUTH_BASE_URL });
  const availability = document.querySelector<HTMLElement>('[data-product="voice"] .product-availability')!;
  const detail = document.getElementById("product-availability")!;
  const notice = document.getElementById("product-notice")!;
  const actions = document.getElementById("voice-actions")!;
  const open = document.getElementById("voice-open") as HTMLButtonElement;
  const signIn = document.getElementById("voice-sign-in")!;
  const retry = document.getElementById("voice-retry") as HTMLButtonElement;
  const error = document.getElementById("voice-error")!;
  let installation: VoiceInstallation | null = null;
  let loading = false;
  let failed = false;
  let opening = false;
  const labels = { not_installed: "Not installed", installing: "Installing…", failed: "Installation failed", ready: "Installed", unavailable: "Unavailable" };

  function render() {
    const label = installation ? labels[installation.state] : failed ? "Unavailable" : "Checking…";
    availability.textContent = label;
    const isVoice = location.hash === "#/products/voice";
    actions.hidden = !isVoice;
    if (!isVoice) return;
    detail.textContent = label;
    const ready = installation?.state === "ready";
    notice.hidden = ready;
    notice.textContent = installation?.state === "not_installed" ? "Voice isn’t available in this deployment yet."
      : installation?.state === "installing" ? "The Cloudflare operator is installing Voice. Check again shortly."
      : installation?.state === "failed" ? "Installation did not finish. The Cloudflare operator can retry it."
      : "Could not verify the Voice installation. Please try again.";
    if (!installation && !failed) notice.textContent = "Checking the Voice installation…";
    open.hidden = !ready || !getUser();
    open.disabled = opening;
    open.textContent = opening ? "Opening…" : "Open Voice";
    signIn.hidden = !ready || getUser() !== null;
    retry.hidden = ready || installation?.state === "not_installed" || !installation && !failed;
    retry.disabled = loading;
  }

  async function refresh() {
    if (loading) return;
    loading = true;
    error.hidden = true;
    render();
    try { installation = await api.readVoiceInstallation(); failed = false; }
    catch { installation = null; failed = true; }
    finally { loading = false; render(); }
  }
  retry.addEventListener("click", () => { void refresh(); });
  open.addEventListener("click", async () => {
    if (opening || !getUser() || installation?.state !== "ready" || !installation.origin) return;
    opening = true;
    error.hidden = true;
    render();
    try { location.assign(await api.openVoice(installation.origin)); }
    catch (cause) {
      error.textContent = cause instanceof Error ? cause.message : "Could not open Voice. Please try again.";
      error.hidden = false;
    } finally { opening = false; render(); }
  });
  return { render, refresh };
}
