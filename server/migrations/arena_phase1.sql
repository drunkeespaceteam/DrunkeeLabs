-- PHASE 1: Realtime Competitive Coding Arena (isolated module)
-- Additive only. Does NOT touch existing task/escrow/sandbox tables.

-- Teams
CREATE TABLE IF NOT EXISTS arena_teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  avatar_url text,
  invite_code text UNIQUE,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_arena_teams_owner_id ON arena_teams(owner_id);

-- Team members
CREATE TABLE IF NOT EXISTS arena_team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES arena_teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','invited','left')),
  joined_at timestamptz DEFAULT now(),
  left_at timestamptz,
  UNIQUE(team_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_arena_team_members_team_id ON arena_team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_arena_team_members_user_id ON arena_team_members(user_id);

-- Matches
CREATE TABLE IF NOT EXISTS arena_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode text NOT NULL CHECK (mode IN ('frontend','bugfix','fullstack')),
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','active','completed','expired')),
  duration_minutes integer NOT NULL DEFAULT 15,
  created_at timestamptz DEFAULT now(),
  started_at timestamptz,
  ends_at timestamptz,
  completed_at timestamptz,
  winning_team_id uuid REFERENCES arena_teams(id),
  metadata jsonb DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_arena_matches_status ON arena_matches(status);
CREATE INDEX IF NOT EXISTS idx_arena_matches_mode ON arena_matches(mode);

-- Match teams
CREATE TABLE IF NOT EXISTS arena_match_teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES arena_matches(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES arena_teams(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(match_id, team_id)
);

CREATE INDEX IF NOT EXISTS idx_arena_match_teams_match_id ON arena_match_teams(match_id);
CREATE INDEX IF NOT EXISTS idx_arena_match_teams_team_id ON arena_match_teams(team_id);

-- Submissions
CREATE TABLE IF NOT EXISTS arena_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES arena_matches(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES arena_teams(id) ON DELETE CASCADE,
  artifact_url text,
  submitted_at timestamptz DEFAULT now(),
  score numeric(10,2) DEFAULT 0,
  metadata jsonb DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_arena_submissions_match_id ON arena_submissions(match_id);
CREATE INDEX IF NOT EXISTS idx_arena_submissions_team_id ON arena_submissions(team_id);

-- Leaderboard (simple rollup; phase 1 can be updated by server code)
CREATE TABLE IF NOT EXISTS arena_leaderboard (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('team','player')),
  subject_id uuid NOT NULL,
  wins integer NOT NULL DEFAULT 0,
  losses integer NOT NULL DEFAULT 0,
  matches_played integer NOT NULL DEFAULT 0,
  total_score numeric(12,2) NOT NULL DEFAULT 0,
  mvp_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(scope, subject_id)
);

CREATE INDEX IF NOT EXISTS idx_arena_leaderboard_scope ON arena_leaderboard(scope);
CREATE INDEX IF NOT EXISTS idx_arena_leaderboard_wins ON arena_leaderboard(wins DESC);

-- Refresh schema cache
NOTIFY pgrst, 'reload schema';

