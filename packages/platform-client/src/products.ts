import { isVoiceInstallation, type VoiceInstallation } from "@canopy/contracts/products";

export function createProductClient({ baseUrl = "", fetcher = fetch }: { baseUrl?: string; fetcher?: typeof fetch } = {}) {
  async function request(path: string, method = "GET") {
    let response: Response;
    try { response = await fetcher(`${baseUrl.replace(/\/$/, "")}${path}`, { method, credentials: "include" }); }
    catch { throw new Error("Could not reach Voice. Check your connection and try again."); }
    return { response, body: await response.json().catch(() => null) };
  }
  return {
    async readVoiceInstallation(): Promise<VoiceInstallation> {
      const { response, body } = await request("/products/voice");
      if (!response.ok || !isVoiceInstallation(body)) throw new Error("Could not check Voice. Please try again.");
      return body;
    },
    async openVoice(origin: string): Promise<string> {
      const { response, body } = await request("/products/voice/open", "POST");
      if (response.status === 401) throw new Error("Sign in again to open Voice.");
      if (!response.ok || typeof body?.url !== "string") throw new Error("Could not open Voice. Please try again.");
      const url = new URL(body.url);
      if (url.origin !== origin || url.pathname !== "/handoff.html" || url.search || !/^#[a-f0-9]{64}$/.test(url.hash)) {
        throw new Error("Could not open Voice. Please try again.");
      }
      return url.href;
    },
  };
}
