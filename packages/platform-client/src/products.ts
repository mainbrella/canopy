import { isVoiceInstallation, type VoiceInstallation } from "@canopy/contracts/products";

export function createProductClient({ baseUrl = "", fetcher = fetch }: { baseUrl?: string; fetcher?: typeof fetch } = {}) {
  async function request(path: string, method = "GET", body?: unknown) {
    let response: Response;
    try { response = await fetcher(`${baseUrl.replace(/\/$/, "")}${path}`, { method, credentials: "include",
      ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}) }); }
    catch { throw new Error("Could not reach the product service. Check your connection and try again."); }
    return { response, body: await response.json().catch(() => null) };
  }
  return {
    async readProduct(product: "voice" | "cut"): Promise<VoiceInstallation> {
      const { response, body } = await request(`/products/${product}`);
      if (!response.ok || !isVoiceInstallation(body) || body.product !== product) throw new Error("Could not check this product. Please try again.");
      return body;
    },
    async install(product: "voice" | "cut"): Promise<string | null> {
      const { response, body } = await request(`/products/${product}/install`, "POST");
      if (response.status === 403) throw new Error("Only the operator can install products.");
      if (!response.ok) throw new Error("Could not request installation. Please try again.");
      if (product === "cut") {
        const url = new URL(body.url);
        if (url.protocol !== "https:" || url.pathname !== "/install/cut" || url.search || url.hash) throw new Error("Appflare is unavailable.");
        return url.href;
      }
      return null;
    },
    async grantAccess(product: "voice" | "cut", userId: string, allowed: boolean) {
      const { response } = await request(`/products/${product}/access`, "POST", { userId, allowed });
      if (!response.ok) throw new Error(response.status === 404 ? "Account not found. Use the ID shown on their Account page." : "Could not update product access.");
    },
    async openCut(origin: string): Promise<string> {
      const { response, body } = await request("/products/cut/open", "POST");
      if (!response.ok || body?.url !== `${origin}/admin`) throw new Error("Could not open Cut. Please try again.");
      return body.url;
    },
    async readVoiceInstallation(): Promise<VoiceInstallation> {
      const { response, body } = await request("/products/voice");
      if (!response.ok || !isVoiceInstallation(body) || body.product !== "voice") throw new Error("Could not check Voice. Please try again.");
      return body;
    },
    async openVoice(origin: string, basePath = ""): Promise<string> {
      if (basePath !== "" && basePath !== "/installed/voice") throw new Error("Could not open Voice. Please try again.");
      const { response, body } = await request("/products/voice/open", "POST");
      if (response.status === 401) throw new Error("Sign in again to open Voice.");
      if (response.status === 403) throw new Error("The operator must grant you access to Voice.");
      if (!response.ok || typeof body?.url !== "string") throw new Error("Could not open Voice. Please try again.");
      const url = new URL(body.url);
      if (url.origin !== origin || url.pathname !== `${basePath}/handoff.html` || url.search || !/^#[a-f0-9]{64}$/.test(url.hash)) {
        throw new Error("Could not open Voice. Please try again.");
      }
      return url.href;
    },
  };
}
