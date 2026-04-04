-- Organizations: nonprofits that receive weekly grant digests
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  categories text[] not null default '{}',
  geography_keywords text[] not null default '{}',
  applicant_type text not null default 'Nonprofit',
  subscription_status text not null default 'trial'
    check (subscription_status in ('trial', 'active', 'cancelled', 'expired')),
  trial_digests_sent int not null default 0,
  stripe_customer_id text,
  unsubscribe_token uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create unique index idx_organizations_unsubscribe_token on organizations (unsubscribe_token);
create index idx_organizations_status on organizations (subscription_status);

-- Grants: synced daily from CA Grants Portal CSV
create table grants (
  id uuid primary key default gen_random_uuid(),
  portal_id int not null unique,
  grant_id text,
  status text not null default 'active',
  agency text,
  title text not null,
  purpose text,
  description text,
  categories text[] not null default '{}',
  applicant_types text[] not null default '{}',
  geography_text text,
  est_amounts_text text,
  est_available_funds_text text,
  application_deadline text,
  deadline_date date,
  open_date date,
  grant_url text,
  contact_info text,
  first_seen_at timestamptz not null default now(),
  last_synced timestamptz not null default now()
);

create index idx_grants_status on grants (status);
create index idx_grants_deadline on grants (deadline_date);
create index idx_grants_first_seen on grants (first_seen_at);

-- Digests: log of sent emails
create table digests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  sent_at timestamptz not null default now(),
  grant_count int not null default 0,
  resend_message_id text
);

create index idx_digests_org on digests (org_id);
