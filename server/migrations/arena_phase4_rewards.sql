-- PHASE 4: Arena reward progression (isolated, additive)

CREATE TABLE IF NOT EXISTS arena_player_progression (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  level integer NOT NULL DEFAULT 1,
  xp integer NOT NULL DEFAULT 0,
  total_xp integer NOT NULL DEFAULT 0,
  reward_points integer NOT NULL DEFAULT 0,
  current_streak integer NOT NULL DEFAULT 0,
  highest_streak integer NOT NULL DEFAULT 0,
  win_streak integer NOT NULL DEFAULT 0,
  tournament_streak integer NOT NULL DEFAULT 0,
  season_rank text NOT NULL DEFAULT 'Unranked',
  daily_last_claimed_at timestamptz,
  daily_streak_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_arena_player_progression_total_xp ON arena_player_progression(total_xp DESC);

CREATE TABLE IF NOT EXISTS arena_achievements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  title text NOT NULL,
  description text NOT NULL,
  xp_reward integer NOT NULL DEFAULT 0,
  credit_reward integer NOT NULL DEFAULT 0,
  badge_code text,
  criteria jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arena_user_achievements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_id uuid NOT NULL REFERENCES arena_achievements(id) ON DELETE CASCADE,
  unlocked_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(user_id, achievement_id)
);

CREATE INDEX IF NOT EXISTS idx_arena_user_achievements_user_id ON arena_user_achievements(user_id);

CREATE TABLE IF NOT EXISTS arena_rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (source_type IN ('match','tournament','daily','achievement','streak','season')),
  source_ref text,
  xp_delta integer NOT NULL DEFAULT 0,
  credit_delta integer NOT NULL DEFAULT 0,
  badge_code text,
  title text,
  claim_status text NOT NULL DEFAULT 'granted' CHECK (claim_status IN ('granted','claimable','claimed')),
  granted_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_arena_rewards_user_granted ON arena_rewards(user_id, granted_at DESC);

CREATE TABLE IF NOT EXISTS arena_certificates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id uuid REFERENCES arena_teams(id) ON DELETE SET NULL,
  tournament_id uuid REFERENCES arena_tournaments(id) ON DELETE SET NULL,
  certificate_title text NOT NULL,
  certificate_url text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  issued_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_arena_certificates_user_id ON arena_certificates(user_id);

CREATE TABLE IF NOT EXISTS arena_seasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_code text NOT NULL UNIQUE,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming','active','ended')),
  starts_at timestamptz,
  ends_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_arena_seasons_status ON arena_seasons(status);

-- Anti-abuse reward lock per match/user/source.
CREATE UNIQUE INDEX IF NOT EXISTS idx_arena_rewards_unique_match_user_source
  ON arena_rewards(user_id, source_type, source_ref);

-- Seed baseline achievements (safe upsert by unique code)
INSERT INTO arena_achievements (code, title, description, xp_reward, credit_reward, badge_code, criteria)
VALUES
  ('first_match', 'First Match', 'Complete your first Arena match', 40, 20, 'rookie-init', '{"type":"matches_played","gte":1}'),
  ('ten_wins', '10 Match Wins', 'Win ten Arena matches', 120, 80, 'win-10', '{"type":"wins","gte":10}'),
  ('streak_5', 'Win Streak x5', 'Reach a 5 match win streak', 180, 100, 'streak-5', '{"type":"win_streak","gte":5}'),
  ('mvp_master', 'MVP Master', 'Earn 5 MVP awards', 160, 90, 'mvp-5', '{"type":"mvp_count","gte":5}'),
  ('ai_battle_champion', 'AI Battle Champion', 'Win an AI-generated battle', 80, 50, 'ai-champion', '{"type":"ai_battle_win","gte":1}')
ON CONFLICT (code) DO NOTHING;

