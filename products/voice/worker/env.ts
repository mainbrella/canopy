import type { Ai, D1Database, DurableObjectNamespace, Fetcher } from "@cloudflare/workers-types/index.ts";

export interface Env {
  DB: D1Database;
  AI: Ai;
  ASSETS: Fetcher;
  RECEPTIONIST_CALL: DurableObjectNamespace<import("./durable-objects/receptionist-call").ReceptionistCall>;
  ADMIN_PASSWORD: string;
  VOICE_AUTH_MODE?: string;
  CANOPY_AUTH_SECRET?: string;
  CANOPY_ACCOUNTS_ORIGIN?: string;
  CANOPY_CONSOLE_ORIGIN?: string;
  CANOPY_INSTALLATION_ID?: string;
  CANOPY_SOURCE_VERSION?: string;
  VOICE_ENABLED?: string;
  VOICE_INSTANCE_DAILY_CALL_LIMIT?: string;
  VOICE_INSTANCE_CONCURRENT_CALL_LIMIT?: string;
  VOICE_CARRIER_AGENT_ID?: string;
  VOICE_CARRIER_USER_ID?: string;
  VOICE_PUBLIC_ORIGIN?: string;
  TRANSCRIPT_RETENTION_DAYS?: string;
  VOICE_AI_GATEWAY_ACCOUNT_ID?: string;
  VOICE_AI_GATEWAY_ID?: string;
  VOICE_AI_GATEWAY_TOKEN?: string;
  DEEPGRAM_API_KEY?: string;
  CARTESIA_API_KEY?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_PHONE_NUMBER?: string;
  TWILIO_SIP_URI?: string;
  TELNYX_API_KEY?: string;
  TELNYX_PUBLIC_KEY?: string;
  TELNYX_ACCOUNT_SID?: string;
  TELNYX_CONNECTION_ID?: string;
  TELNYX_PHONE_NUMBER?: string;
  TELNYX_SIP_URI?: string;
}
