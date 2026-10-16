-- Optional Canopy authentication supports a workspace per platform user.
-- Standalone authentication continues to select only the existing owner row.
PRAGMA defer_foreign_keys = ON;
CREATE TABLE voice_agents_next (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE CHECK (length(user_id) BETWEEN 1 AND 128),
  name TEXT NOT NULL, business_name TEXT NOT NULL, greeting TEXT NOT NULL,
  instructions TEXT NOT NULL, voice TEXT NOT NULL,
  voice_logic TEXT NOT NULL DEFAULT 'original_no_reply' CHECK (voice_logic IN ('original_no_reply', 'reply_right_away')),
  model TEXT NOT NULL DEFAULT 'aura-1' CHECK (model IN ('aura-1', 'aura-2', 'aura-2-gateway', 'sonic-3.6')),
  language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'es', 'fr', 'de', 'hi', 'ru', 'pt', 'ja', 'it', 'nl')),
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, id)
);
INSERT INTO voice_agents_next SELECT * FROM voice_agents;
CREATE TABLE voice_calls_next (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('browser', 'text', 'phone')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'failed')),
  started_at TEXT NOT NULL, ended_at TEXT,
  transcript_json TEXT NOT NULL DEFAULT '[]', config_json TEXT NOT NULL,
  provider_call_id TEXT UNIQUE, media_token_hash TEXT, media_token_expires_at TEXT, connected_at TEXT,
  phone_transport TEXT CHECK (phone_transport IN ('pstn', 'sip')),
  phone_provider TEXT CHECK (phone_provider IN ('twilio', 'telnyx')),
  deleted_at TEXT,
  FOREIGN KEY (user_id, agent_id) REFERENCES voice_agents_next(user_id, id)
);
INSERT INTO voice_calls_next SELECT * FROM voice_calls;
DROP TABLE voice_calls;
DROP TABLE voice_agents;
ALTER TABLE voice_agents_next RENAME TO voice_agents;
ALTER TABLE voice_calls_next RENAME TO voice_calls;
CREATE INDEX voice_calls_started ON voice_calls(user_id, started_at DESC);
ALTER TABLE sessions ADD COLUMN user_id TEXT NOT NULL DEFAULT 'owner';
ALTER TABLE sessions ADD COLUMN platform_session_hash TEXT;
CREATE TABLE canopy_handoffs (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  platform_session_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
PRAGMA defer_foreign_keys = OFF;
