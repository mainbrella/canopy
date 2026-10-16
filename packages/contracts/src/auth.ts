// Public fields from backend/worker/app/auth-core.ts; never expose credential fields.
export interface User {
  id: string;
  email: string | null;
  name: string;
  dob: string | null;
  created_at: string;
}

export interface AuthSession {
  user: User;
}

export interface SignInResult extends AuthSession {
  created: boolean;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Runtime guards adapted from raindrop/src/auth.ts for the actual backend payload.
export function isUser(value: unknown): value is User {
  return isRecord(value)
    && typeof value.id === "string" && value.id.length > 0
    && (value.email === null || typeof value.email === "string")
    && typeof value.name === "string"
    && (value.dob === null || typeof value.dob === "string")
    && typeof value.created_at === "string";
}

export function isSession(value: unknown): value is AuthSession {
  return isRecord(value) && isUser(value.user);
}

export function isSignInResult(value: unknown): value is SignInResult {
  return isSession(value) && "created" in value && typeof value.created === "boolean";
}
