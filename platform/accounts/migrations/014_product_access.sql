-- Preserve the Voice inventory while allowing explicitly integrated products.
CREATE TABLE product_inventory (
  product TEXT PRIMARY KEY,
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
  updated_at TEXT NOT NULL,
  provisioner TEXT NOT NULL DEFAULT 'canopy-voice',
  owner_user_id TEXT,
  source_repository TEXT,
  resources_json TEXT NOT NULL DEFAULT '[]',
  capabilities_json TEXT NOT NULL DEFAULT '{"identity":true,"billing":false,"health":"canopy"}',
  verification_json TEXT,
  external_install_id TEXT
);
INSERT INTO product_inventory(product,installation_id,account_id,worker_name,database_id,namespace_id,origin,version,source_revision,state,lease_token,lease_expires,updated_at)
  SELECT product,installation_id,account_id,worker_name,database_id,namespace_id,origin,version,source_revision,state,lease_token,lease_expires,updated_at FROM product_installations;
DROP TABLE product_installations;
ALTER TABLE product_inventory RENAME TO product_installations;

-- Cloudflare operator pins the owner's existing user id in Worker configuration.
-- Public signup creates neither authority nor a product grant.
CREATE TABLE product_access (
  product TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  granted_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY(product, user_id)
);
CREATE TABLE product_install_requests (
  product TEXT PRIMARY KEY CHECK (product IN ('voice', 'cut')),
  request_id TEXT NOT NULL UNIQUE,
  requested_by TEXT NOT NULL REFERENCES users(id),
  state TEXT NOT NULL CHECK (state IN ('pending', 'running', 'failed', 'complete')),
  updated_at TEXT NOT NULL
);
