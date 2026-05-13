-- PHASE 3: Arena team marketplace + tournament registration upgrade
-- Additive and isolated to arena tables.

ALTER TABLE arena_teams
  ADD COLUMN IF NOT EXISTS team_slug text,
  ADD COLUMN IF NOT EXISTS recruitment_status text NOT NULL DEFAULT 'recruiting' CHECK (recruitment_status IN ('recruiting', 'invite-only', 'closed')),
  ADD COLUMN IF NOT EXISTS team_bio text,
  ADD COLUMN IF NOT EXISTS captain_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS trophies integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS badges integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS achievements jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS idx_arena_teams_team_slug ON arena_teams(team_slug);
CREATE INDEX IF NOT EXISTS idx_arena_teams_recruitment_status ON arena_teams(recruitment_status);

UPDATE arena_teams
SET captain_user_id = owner_id
WHERE captain_user_id IS NULL;

ALTER TABLE arena_matches
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_arena_matches_scheduled_at ON arena_matches(scheduled_at);

CREATE TABLE IF NOT EXISTS arena_team_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES arena_teams(id) ON DELETE CASCADE,
  role_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(team_id, role_name)
);

ALTER TABLE arena_tournament_teams
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS arena_team_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES arena_teams(id) ON DELETE CASCADE,
  applicant_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  desired_role text,
  introduction text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(team_id, applicant_user_id)
);

CREATE INDEX IF NOT EXISTS idx_arena_team_applications_team_status ON arena_team_applications(team_id, status);

CREATE TABLE IF NOT EXISTS arena_team_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES arena_teams(id) ON DELETE CASCADE,
  invite_token text NOT NULL UNIQUE,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz,
  uses_remaining integer NOT NULL DEFAULT 50,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_arena_team_invites_team_id ON arena_team_invites(team_id);

