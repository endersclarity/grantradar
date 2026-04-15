-- 007: Funders table for Candid prospect data
-- Separate from grants table — funders are organizations that GIVE grants,
-- grants are the individual funding opportunities.

CREATE TABLE IF NOT EXISTS funders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity
  name text NOT NULL,
  ein text UNIQUE,
  source text NOT NULL DEFAULT 'candid',  -- candid | manual | niche_scraper
  source_id text,  -- Candid profile ID or other external ID

  -- Location
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  county text,
  zip text,
  phone text,
  website text,

  -- Classification
  irs_subsection text,
  subject_areas text[] NOT NULL DEFAULT '{}',
  ntee_code text,
  mission_statement text,

  -- Leadership
  principal_officer text,
  org_leader_name text,
  org_leader_title text,
  org_leader_email text,
  primary_contact_name text,
  primary_contact_title text,
  primary_contact_email text,
  employee_count integer,

  -- Financials (from most recent 990)
  form_year integer,
  form_type text,
  total_assets bigint,
  cash_and_equivalent bigint,
  investments_securities bigint,
  net_assets bigint,
  unrestricted_net_assets bigint,
  total_revenue bigint,
  total_expenses bigint,
  total_program_expenses bigint,
  total_contributions bigint,
  government_grants bigint,
  investment_income bigint,

  -- Links
  candid_profile_url text,
  form_990_url text,

  -- AI classification (same pattern as grants table)
  ai_tags text[],
  ai_summary text,
  ai_fit_score integer,  -- 0-100 relevance score for NSH
  ai_classified_at timestamptz,

  -- Metadata
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_funders_state ON funders (state);
CREATE INDEX IF NOT EXISTS idx_funders_source ON funders (source);
CREATE INDEX IF NOT EXISTS idx_funders_ein ON funders (ein);
CREATE INDEX IF NOT EXISTS idx_funders_ai_tags ON funders USING GIN (ai_tags);
CREATE INDEX IF NOT EXISTS idx_funders_ai_fit ON funders (ai_fit_score);
CREATE INDEX IF NOT EXISTS idx_funders_subject ON funders USING GIN (subject_areas);

-- RLS (matching pattern from 006)
ALTER TABLE funders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_read_funders" ON funders
  FOR SELECT USING (true);

CREATE POLICY "anon_no_insert_funders" ON funders
  FOR INSERT WITH CHECK (false);

CREATE POLICY "anon_no_update_funders" ON funders
  FOR UPDATE USING (false);

CREATE POLICY "anon_no_delete_funders" ON funders
  FOR DELETE USING (false);
