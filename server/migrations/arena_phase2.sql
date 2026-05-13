-- PHASE 2: Arena expansion (ranked + tournaments + AI)
-- Additive only; does not modify existing non-arena schemas.

-- Ranked progression
CREATE TABLE IF NOT EXISTS arena_player_ranks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope_mode text NOT NULL DEFAULT 'global' CHECK (scope_mode IN ('global')),
  rank_tier text NOT NULL DEFAULT 'Bronze' CHECK (rank_tier IN ('Bronze','Silver','Gold','Platinum','Diamond','Elite')),
  mmr integer NOT NULL DEFAULT 1000,
  wins integer NOT NULL DEFAULT 0,
  losses integer NOT NULL DEFAULT 0,
  matches_played integer NOT NULL DEFAULT 0,
  total_score numeric(12,2) NOT NULL DEFAULT 0,
  mvp_count integer NOT NULL DEFAULT 0,
  streak integer NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(player_id, scope_mode)
);

CREATE INDEX IF NOT EXISTS idx_arena_player_ranks_mmr ON arena_player_ranks(mmr DESC);

-- Tournament infrastructure (single elimination Phase 2)
CREATE TABLE IF NOT EXISTS arena_tournaments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('frontend','bugfix','fullstack')),
  queue_type text NOT NULL DEFAULT 'casual' CHECK (queue_type IN ('casual','ranked')),
  elimination_format text NOT NULL DEFAULT 'single_elimination' CHECK (elimination_format IN ('single_elimination','double_elimination')),
  status text NOT NULL DEFAULT 'recruiting' CHECK (status IN ('recruiting','started','completed')),
  duration_minutes integer NOT NULL DEFAULT 15,
  created_at timestamptz DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  metadata jsonb DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_arena_tournaments_status ON arena_tournaments(status);

CREATE TABLE IF NOT EXISTS arena_tournament_teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES arena_tournaments(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES arena_teams(id) ON DELETE CASCADE,
  registered_at timestamptz DEFAULT now(),
  UNIQUE(tournament_id, team_id)
);

CREATE INDEX IF NOT EXISTS idx_arena_tournament_teams_tournament_id ON arena_tournament_teams(tournament_id);

-- Bracket rows for tournament matches
CREATE TABLE IF NOT EXISTS arena_brackets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES arena_tournaments(id) ON DELETE CASCADE,
  round_number integer NOT NULL,
  match_index integer NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','completed')),
  team1_id uuid REFERENCES arena_teams(id) ON DELETE SET NULL,
  team2_id uuid REFERENCES arena_teams(id) ON DELETE SET NULL,
  match_id uuid REFERENCES arena_matches(id) ON DELETE SET NULL,
  winner_team_id uuid REFERENCES arena_teams(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(tournament_id, round_number, match_index)
);

CREATE INDEX IF NOT EXISTS idx_arena_brackets_match_id ON arena_brackets(match_id);
CREATE INDEX IF NOT EXISTS idx_arena_brackets_tournament_round ON arena_brackets(tournament_id, round_number);

