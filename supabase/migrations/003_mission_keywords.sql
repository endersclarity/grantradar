-- Add mission keywords for relevance scoring
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS mission_keywords text[] NOT NULL DEFAULT '{}';

-- Add minimum grant amount filter (in dollars, null = no filter)
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS min_grant_amount integer DEFAULT NULL;

-- Add index for future queries
CREATE INDEX IF NOT EXISTS idx_organizations_mission_keywords ON organizations USING gin (mission_keywords);
