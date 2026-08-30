-- Create default organization
INSERT INTO organizations (id, name, slug, created_at)
VALUES ('org_default', 'Default Organization', 'default', now())
ON CONFLICT (id) DO NOTHING;

-- Create test leads
INSERT INTO leads (organization_id, name, email, phone, metadata, created_at)
VALUES
  ('org_default', 'Test Lead 1', 'lead1@test.com', '+15551001', '{"address": "123 Main St"}', now()),
  ('org_default', 'Test Lead 2', 'lead2@test.com', '+15551002', '{"address": "456 Oak Ave"}', now()),
  ('org_default', 'Test Lead 3', 'lead3@test.com', '+15551003', '{"address": "789 Elm St"}', now())
ON CONFLICT (organization_id, email) DO NOTHING;

-- Create warmup config
INSERT INTO email_warmup_config (organization_id, daily_limit, paused, created_at)
VALUES ('org_default', 20, false, now())
ON CONFLICT (organization_id) DO NOTHING;

SELECT 'Organization created' as status;
