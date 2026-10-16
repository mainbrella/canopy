import { isRecord } from "./auth.ts";

export const voiceStates = ["not_installed", "installing", "failed", "ready", "unavailable"] as const;
export interface VoiceInstallation {
  product: "voice";
  state: typeof voiceStates[number];
  version: string | null;
  origin: string | null;
}
export function isVoiceInstallation(value: unknown): value is VoiceInstallation {
  return isRecord(value) && value.product === "voice"
    && voiceStates.includes(value.state as VoiceInstallation["state"])
    && (value.version === null || typeof value.version === "string")
    && (value.origin === null || typeof value.origin === "string");
}
