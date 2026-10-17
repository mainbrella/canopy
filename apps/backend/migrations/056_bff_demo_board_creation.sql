-- Allow every signed-in public-demo user to create a board. The existing own-row
-- insert policy still assigns and enforces user_id from the authenticated session.
-- Scope this grant to the demo's exact browser key and its project owner.
UPDATE bff_api_key_grants
SET tables=json_set(tables, '$.boards',
  json_insert(json_extract(tables, '$.boards'), '$[#]', 'insert'))
WHERE project_id='90da3093-84b6-4cd7-a39a-a8afc39403b8'
  AND api_key_id IN (
    SELECT k.id FROM api_keys k JOIN bff_projects p ON p.user_id=k.user_id
    WHERE p.id='90da3093-84b6-4cd7-a39a-a8afc39403b8'
      AND k.token_hash='e5906e35c913e2b79f96034830e20329940424ead22cc5302cee5d00f36851fb'
      AND k.prefix GLOB 'bff_pk_*'
  )
  AND json_type(tables, '$.boards')='array'
  AND EXISTS (SELECT 1 FROM json_each(tables, '$.boards') WHERE value='select')
  AND NOT EXISTS (SELECT 1 FROM json_each(tables, '$.boards') WHERE value='insert');
