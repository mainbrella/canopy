import { isRecord, isSession, isSignInResult, type AuthSession, type SignInResult } from "@canopy/contracts/auth";

// Adapted from web/src/auth.ts and raindrop/src/auth.ts. Browser UI effects stay
// with the caller; this client also runs in tests without window or Vite globals.
export function createAuthClient({ baseUrl = "", fetcher = fetch }: { baseUrl?: string; fetcher?: typeof fetch } = {}) {
  async function request(path: string, options: RequestInit = {}) {
    let response: Response;
    try {
      response = await fetcher(`${baseUrl.replace(/\/$/, "")}${path}`, {
        ...options,
        credentials: "include",
        headers: { accept: "application/json", ...(options.body ? { "content-type": "application/json" } : {}) },
      });
    } catch {
      throw new Error("Could not reach sign-in. Check your connection and try again.");
    }
    const result: unknown = await response.json().catch(() => null);
    return { response, result };
  }

  return {
    async readSession(): Promise<AuthSession | null> {
      const { response, result } = await request("/auth/me");
      if (response.status === 401) return null;
      if (!response.ok || !isRecord(result) || !("user" in result)) {
        throw new Error("Could not check your sign-in. Please try again.");
      }
      if (result.user === null) return null;
      if (!isSession(result)) throw new Error("Could not check your sign-in. Please try again.");
      return { user: result.user };
    },
    async signInWithEmail(email: string, password: string): Promise<SignInResult> {
      const { response, result } = await request("/auth/email", {
        method: "POST", body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });
      if (!response.ok || !isSignInResult(result)) {
        const messages: Record<string, string> = {
          invalid_request: "Enter a valid email and a password of no more than 128 characters.",
          weak_password: "Use at least 8 characters for a new password.",
          invalid_credentials: "Email or password is incorrect.",
          rate_limited: "Too many attempts. Please wait a minute and try again.",
        };
        const code = isRecord(result) && typeof result.error === "string" ? result.error : "";
        throw new Error(messages[code] || "Could not finish signing you in. Please try again.");
      }
      return { user: result.user, created: result.created };
    },
    async signOut(): Promise<void> {
      const { response, result } = await request("/auth/logout", { method: "POST" });
      if (!response.ok || !isRecord(result) || result.ok !== true) {
        throw new Error("Could not sign you out. Please try again.");
      }
    },
  };
}
