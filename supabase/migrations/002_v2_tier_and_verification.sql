-- Add tier column (free or pro, default free)
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS tier text NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'pro'));

-- Add email verification columns
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT false;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS email_verify_token uuid DEFAULT gen_random_uuid();

-- Index for verify token lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_verify_token ON organizations (email_verify_token);

-- Index for email lookups (used by checkout and signup duplicate check)
CREATE INDEX IF NOT EXISTS idx_organizations_email ON organizations (email);

-- Migrate existing trial/active orgs: keep their status, set tier=free
UPDATE organizations SET tier = 'free' WHERE tier IS NULL OR tier = '';

-- Webhook idempotency table
CREATE TABLE IF NOT EXISTS webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id text NOT NULL UNIQUE,
  event_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_stripe_id ON webhook_events (stripe_event_id);
