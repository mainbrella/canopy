import { isRecord } from "./auth.ts";

export const voiceStates = ["not_installed", "pending", "installing", "failed", "ready", "registered", "unavailable"] as const;
export interface VoiceInstallation {
  product: "voice" | "cut";
  state: typeof voiceStates[number];
  version: string | null;
  origin: string | null;
  access?: "sign_in" | "allowed" | "denied";
  canInstall?: boolean;
  canManageAccess?: boolean;
  identity?: "canopy" | "own";
  billing?: false;
}
export function isVoiceInstallation(value: unknown): value is VoiceInstallation {
  return isRecord(value) && ["voice", "cut"].includes(value.product as string)
    && voiceStates.includes(value.state as VoiceInstallation["state"])
    && (value.access === undefined || ["sign_in", "allowed", "denied"].includes(value.access as string))
    && (value.canInstall === undefined || typeof value.canInstall === "boolean")
    && (value.canManageAccess === undefined || typeof value.canManageAccess === "boolean")
    && (value.identity === undefined || value.identity === "canopy" || value.identity === "own")
    && (value.billing === undefined || value.billing === false)
    && (value.version === null || typeof value.version === "string")
    && (value.origin === null || typeof value.origin === "string");
}
