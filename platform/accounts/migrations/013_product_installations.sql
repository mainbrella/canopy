-- One installation per product and Canopy instance, never per signed-in user.
-- Only the authenticated Cloudflare operator writes this inventory.
CREATE TABLE product_installations (
  product TEXT PRIMARY KEY CHECK (product = 'voice'),
  installation_id TEXT NOT NULL UNIQUE,
  account_id TEXT NOT NULL,
  worker_name TEXT NOT NULL,
  database_id TEXT,
  namespace_id TEXT,
  origin TEXT NOT NULL,
  version TEXT NOT NULL,
  source_revision TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('installing', 'installed', 'failed')),
  lease_token TEXT,
  lease_expires INTEGER,
  updated_at TEXT NOT NULL
);
