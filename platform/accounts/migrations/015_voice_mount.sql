-- Existing installations retain their origin and resources until explicitly moved.
ALTER TABLE product_installations ADD COLUMN base_path TEXT NOT NULL DEFAULT ''
  CHECK (base_path = '' OR (product = 'voice' AND base_path = '/installed/voice'));
