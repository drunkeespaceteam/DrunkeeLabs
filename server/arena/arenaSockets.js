import OpenAI from 'openai'

function arenaKey(...parts) {
  return ['arena', ...parts].join(':')
}

function defaultDocForMode(mode) {
  if (mode === 'bugfix') {
    return `// Bugfix challenge (Phase 1)\n// Fix the bug and submit a ZIP.\n\nexport function add(a, b) {\n  // TODO: fix\n  return a - b\n}\n`
  }
  if (mode === 'fullstack') {
    return `// Fullstack mini-challenge (Phase 1)\n// Implement minimal API + UI logic. Submit a ZIP.\n\nconsole.log('Hello arena')\n`
  }
  return `// Frontend challenge (Phase 1)\n// Build the UI logic. Submit a ZIP.\n\nconsole.log('Hello arena')\n`
}

export function initArenaSockets({ io, supabase, redisConnection }) {
  const nsp = io.of('/arena')

  // matchId -> interval handle
  const timers = new Map()

  const openai = new OpenAI({
    apiKey: process.env.GROK_API_KEY || 'placeholder',
    baseURL: 'https://api.x.ai/v1'
  })

  function isOpenAiConfigured() {
    return !!process.env.GROK_API_KEY && process.env.GROK_API_KEY !== 'placeholder'
  }

  function getRankTierFromMmr(mmr) {
    const m = Number(mmr) || 1000
    if (m < 1100) return 'Bronze'
    if (m < 1300) return 'Silver'
    if (m < 1600) return 'Gold'
    if (m < 1900) return 'Platinum'
    if (m < 2200) return 'Diamond'
    return 'Elite'
  }

  function expectedScore(ra, rb) {
    const a = Number(ra) || 1000
    const b = Number(rb) || 1000
    return 1 / (1 + 10 ** ((b - a) / 400))
  }

  function xpPerLevel(level) {
    const l = Math.max(1, Number(level) || 1)
    return 120 + Math.floor((l - 1) * 6)
  }

  async function grantRewardAtomic({ userId, sourceType, sourceRef, xpDelta = 0, creditDelta = 0, badgeCode = null, title = null, metadata = {} }) {
    // Duplicate guard for deterministic reward writes.
    const { data: existing } = await supabase
      .from('arena_rewards')
      .select('id')
      .eq('user_id', userId)
      .eq('source_type', sourceType)
      .eq('source_ref', sourceRef)
      .maybeSingle()
    if (existing?.id) return { granted: false }

    const { data: p } = await supabase.from('arena_player_progression').select('*').eq('user_id', userId).maybeSingle()
    let level = Number(p?.level || 1)
    let xp = Number(p?.xp || 0)
    let totalXp = Number(p?.total_xp || 0)
    let points = Number(p?.reward_points || 0)
    const currentStreak = Number(p?.current_streak || 0)
    const highestStreak = Number(p?.highest_streak || 0)
    const seasonRank = p?.season_rank || 'Unranked'

    totalXp += Number(xpDelta || 0)
    points += Number(creditDelta || 0)
    xp += Number(xpDelta || 0)
    let levelUp = false
    while (xp >= xpPerLevel(level)) {
      xp -= xpPerLevel(level)
      level += 1
      levelUp = true
    }

    await supabase
      .from('arena_player_progression')
      .upsert([{
        user_id: userId,
        level,
        xp,
        total_xp: totalXp,
        reward_points: points,
        current_streak: currentStreak,
        highest_streak: highestStreak,
        season_rank: seasonRank,
        updated_at: new Date().toISOString()
      }], { onConflict: 'user_id' })

    await supabase.from('arena_rewards').insert([{
      user_id: userId,
      source_type: sourceType,
      source_ref: sourceRef,
      xp_delta: Number(xpDelta || 0),
      credit_delta: Number(creditDelta || 0),
      badge_code: badgeCode,
      title,
      claim_status: 'granted',
      metadata
    }])

    return { granted: true, level, levelUp, xpDelta: Number(xpDelta || 0), creditDelta: Number(creditDelta || 0), badgeCode }
  }

  async function maybeUnlockAchievement({ userId, code, progressMeta = {} }) {
    const { data: ach } = await supabase.from('arena_achievements').select('*').eq('code', code).maybeSingle()
    if (!ach) return null

    const { data: exists } = await supabase
      .from('arena_user_achievements')
      .select('id')
      .eq('user_id', userId)
      .eq('achievement_id', ach.id)
      .maybeSingle()
    if (exists?.id) return null

    await supabase
      .from('arena_user_achievements')
      .insert([{ user_id: userId, achievement_id: ach.id, metadata: progressMeta }])

    await grantRewardAtomic({
      userId,
      sourceType: 'achievement',
      sourceRef: `${code}:${userId}`,
      xpDelta: Number(ach.xp_reward || 0),
      creditDelta: Number(ach.credit_reward || 0),
      badgeCode: ach.badge_code || null,
      title: `Achievement: ${ach.title}`,
      metadata: { code, title: ach.title }
    })
    return ach
  }

  async function finalizeMatch({ matchId }) {
    // Best-effort finalizer. Safe to call multiple times.
    const { data: match } = await supabase
      .from('arena_matches')
      .select('id,status,metadata,mode,duration_minutes')
      .eq('id', matchId)
      .maybeSingle()

    if (!match || match.status !== 'active') return

    const queueType = match.metadata?.queueType === 'ranked' ? 'ranked' : 'casual'
    const tournamentId = match.metadata?.tournamentId || null
    const roundNumber = Number(match.metadata?.roundNumber || 1)
    const matchIndex = Number(match.metadata?.matchIndex || 0)

    const docKey = arenaKey('doc', matchId)
    const code = (await redisConnection.get(docKey).catch(() => null)) || defaultDocForMode(match.mode)

    const { data: matchTeams } = await supabase
      .from('arena_match_teams')
      .select('team_id, arena_teams:team_id(id, owner_id)')
      .eq('match_id', matchId)

    const teams = (matchTeams || []).map((t) => ({ teamId: t.team_id, ownerId: t.arena_teams?.owner_id }))
    if (teams.length < 2) {
      // Can't evaluate properly; expire.
      await supabase.from('arena_matches').update({ status: 'expired', completed_at: new Date().toISOString() }).eq('id', matchId)
      nsp.to(`match:${matchId}`).emit('arena_match_finished', { matchId, status: 'expired' })
      return
    }

    // Evaluate (AI if configured; otherwise heuristic).
    let scoreA = 1
    let scoreB = 1
    if (isOpenAiConfigured()) {
      const ai = match.metadata?.aiChallenge || {}
      try {
        const system = 'You are an impartial competitive coding evaluator. Return ONLY valid JSON.'
        const prompt = `Evaluate the following collaborative code for an arena challenge.
Challenge title: ${ai.title || match.mode}
Scoring rules: ${Array.isArray(ai.scoring_rules) ? ai.scoring_rules.join('; ') : 'N/A'}
Expected output hints: ${Array.isArray(ai.expected_output) ? ai.expected_output.join('; ') : 'N/A'}

Return JSON:
{ total_score: number, breakdown: { correctness: number, ui_quality: number, structure: number } }

Code:\n${code}`

        const completion = await openai.chat.completions.create({
          model: process.env.ARENA_AI_MODEL || 'grok-2-latest',
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: prompt }
          ],
          response_format: { type: 'json_object' }
        })

        const raw = completion.choices?.[0]?.message?.content || '{}'
        const parsed = JSON.parse(raw)
        const total = Number(parsed.total_score)
        if (Number.isFinite(total)) {
          scoreA = total
          scoreB = total - 0.1 // deterministic tie-break
        }
      } catch {
        // fallback heuristic
      }
    }

    if (!Number.isFinite(scoreA)) scoreA = 1
    if (!Number.isFinite(scoreB)) scoreB = 0.5

    const winnerTeamId = scoreA >= scoreB ? teams[0].teamId : teams[1].teamId
    const completedAt = new Date().toISOString()

    // Upsert submissions (auto-submit) - store code in metadata.
    for (const t of teams) {
      const score = t.teamId === winnerTeamId ? scoreA : scoreB
      await supabase
        .from('arena_submissions')
        .insert([{ match_id: matchId, team_id: t.teamId, score, metadata: { sourceCode: code } }])
        .catch(() => {})
    }

    await supabase
      .from('arena_matches')
      .update({ status: 'completed', completed_at: completedAt, winning_team_id: winnerTeamId })
      .eq('id', matchId)

    // Update leaderboard (teams)
    for (const t of teams) {
      const isWin = t.teamId === winnerTeamId
      const { data: existing } = await supabase
        .from('arena_leaderboard')
        .select('*')
        .eq('scope', 'team')
        .eq('subject_id', t.teamId)
        .maybeSingle()

      const { error } = await supabase
        .from('arena_leaderboard')
        .upsert([
          {
            scope: 'team',
            subject_id: t.teamId,
            wins: (existing?.wins || 0) + (isWin ? 1 : 0),
            losses: (existing?.losses || 0) + (isWin ? 0 : 1),
            matches_played: (existing?.matches_played || 0) + 1,
            total_score: Number((existing?.total_score || 0) + (isWin ? scoreA : scoreB)),
            mvp_count: existing?.mvp_count || 0
          }
        ], { onConflict: 'scope,subject_id' })
      if (error) {
        // tolerate leaderboard schema differences
      }
    }

    // Rank update (if ranked match)
    if (queueType === 'ranked') {
      // Team-level MMR (average player MMR baseline)
      const teamMmrMap = new Map()

      for (const t of teams) {
        const { data: members } = await supabase
          .from('arena_team_members')
          .select('user_id')
          .eq('team_id', t.teamId)
          .eq('status', 'active')
        const memberIds = (members || []).map((m) => m.user_id)

        let sum = 0
        let count = 0
        for (const pid of memberIds) {
          const { data: rankRow } = await supabase
            .from('arena_player_ranks')
            .select('mmr')
            .eq('player_id', pid)
            .eq('scope_mode', 'global')
            .maybeSingle()
          sum += Number(rankRow?.mmr || 1000)
          count += 1
        }
        teamMmrMap.set(t.teamId, count > 0 ? sum / count : 1000)
      }

      const teamA = teams[0]
      const teamB = teams[1]
      const mmrA = teamMmrMap.get(teamA.teamId) || 1000
      const mmrB = teamMmrMap.get(teamB.teamId) || 1000
      const expA = expectedScore(mmrA, mmrB)
      const expB = expectedScore(mmrB, mmrA)
      const actA = teamA.teamId === winnerTeamId ? 1 : 0
      const actB = teamB.teamId === winnerTeamId ? 1 : 0
      const k = 24
      const deltaA = Math.round(k * (actA - expA))
      const deltaB = Math.round(k * (actB - expB))

      for (const t of teams) {
        const { data: members } = await supabase
          .from('arena_team_members')
          .select('user_id')
          .eq('team_id', t.teamId)
          .eq('status', 'active')
        const memberIds = (members || []).map((m) => m.user_id)
        const isWin = t.teamId === winnerTeamId
        const perMemberDelta = t.teamId === teamA.teamId ? deltaA : deltaB

        // MVP = winning team owner only
        const mvpUserId = isWin ? t.ownerId : null

        for (const pid of memberIds) {
          const { data: rankRow } = await supabase
            .from('arena_player_ranks')
            .select('*')
            .eq('player_id', pid)
            .eq('scope_mode', 'global')
            .maybeSingle()

          const currentMmr = Number(rankRow?.mmr || 1000)
          const nextMmr = Math.max(1, currentMmr + perMemberDelta)

          await supabase
            .from('arena_player_ranks')
            .upsert([
              {
                player_id: pid,
                scope_mode: 'global',
                mmr: nextMmr,
                rank_tier: getRankTierFromMmr(nextMmr),
                wins: (rankRow?.wins || 0) + (isWin ? 1 : 0),
                losses: (rankRow?.losses || 0) + (isWin ? 0 : 1),
                matches_played: (rankRow?.matches_played || 0) + 1,
                total_score: Number((rankRow?.total_score || 0) + (isWin ? scoreA : scoreB)),
                mvp_count: (rankRow?.mvp_count || 0) + (pid === mvpUserId ? 1 : 0),
                streak: (isWin ? (rankRow?.streak || 0) + 1 : 0)
              }
            ], { onConflict: 'player_id,scope_mode' })

          // Keep player arena_leaderboard in sync as well.
          const { data: lbExisting } = await supabase
            .from('arena_leaderboard')
            .select('*')
            .eq('scope', 'player')
            .eq('subject_id', pid)
            .maybeSingle()
          await supabase
            .from('arena_leaderboard')
            .upsert([
              {
                scope: 'player',
                subject_id: pid,
                wins: (lbExisting?.wins || 0) + (isWin ? 1 : 0),
                losses: (lbExisting?.losses || 0) + (isWin ? 0 : 1),
                matches_played: (lbExisting?.matches_played || 0) + 1,
                total_score: Number((lbExisting?.total_score || 0) + (isWin ? scoreA : scoreB)),
                mvp_count: (lbExisting?.mvp_count || 0) + (pid === mvpUserId ? 1 : 0)
              }
            ], { onConflict: 'scope,subject_id' })
        }
      }

      nsp.to(`match:${matchId}`).emit('arena_rank_updated', { matchId, winnerTeamId, queueType })
    }

    // Reward system (Phase 1, server-authoritative)
    const perUserRewards = {}
    for (const t of teams) {
      const isWin = t.teamId === winnerTeamId
      const { data: members } = await supabase
        .from('arena_team_members')
        .select('user_id')
        .eq('team_id', t.teamId)
        .eq('status', 'active')

      const memberIds = (members || []).map((m) => m.user_id)
      const isAiBattle = !!match.metadata?.aiBattle
      const isTournament = !!tournamentId
      for (const uid of memberIds) {
        const baseParticipationXp = 20
        const winXp = isWin ? 50 : 0
        const aiXp = isAiBattle ? 15 : 0
        const tournamentXp = isTournament ? 30 : 0
        const streakBonus = isWin ? 10 : 0
        const xpGain = baseParticipationXp + winXp + aiXp + tournamentXp + streakBonus
        const credits = (isWin ? 40 : 15) + (isTournament ? 25 : 0)
        const mvp = isWin && uid === t.ownerId
        const mvpXp = mvp ? 40 : 0
        const mvpCredits = mvp ? 20 : 0

        const result = await grantRewardAtomic({
          userId: uid,
          sourceType: 'match',
          sourceRef: `${matchId}:${uid}`,
          xpDelta: xpGain + mvpXp,
          creditDelta: credits + mvpCredits,
          badgeCode: null,
          title: `Match reward ${matchId}`,
          metadata: { matchId, teamId: t.teamId, winner: isWin, mvp, queueType }
        })

        // lightweight streak tracking
        const { data: p } = await supabase.from('arena_player_progression').select('*').eq('user_id', uid).maybeSingle()
        if (p) {
          const nextWinStreak = isWin ? Number(p.win_streak || 0) + 1 : 0
          await supabase
            .from('arena_player_progression')
            .update({
              win_streak: nextWinStreak,
              tournament_streak: isTournament ? (isWin ? Number(p.tournament_streak || 0) + 1 : 0) : Number(p.tournament_streak || 0),
              updated_at: new Date().toISOString()
            })
            .eq('user_id', uid)
        }

        // Achievements (minimal deterministic checks)
        const { data: lbPlayer } = await supabase
          .from('arena_leaderboard')
          .select('wins,mvp_count,matches_played')
          .eq('scope', 'player')
          .eq('subject_id', uid)
          .maybeSingle()

        if ((lbPlayer?.matches_played || 0) >= 1) {
          const ach = await maybeUnlockAchievement({ userId: uid, code: 'first_match', progressMeta: { matchId } })
          if (ach) {
            nsp.to(`match:${matchId}`).emit('achievement_completed', { userId: uid, code: ach.code, title: ach.title })
            if (ach.badge_code) nsp.to(`match:${matchId}`).emit('badge_earned', { userId: uid, badgeCode: ach.badge_code, title: ach.title })
          }
        }
        if ((lbPlayer?.wins || 0) >= 10) {
          const ach = await maybeUnlockAchievement({ userId: uid, code: 'ten_wins', progressMeta: { wins: lbPlayer.wins } })
          if (ach) {
            nsp.to(`match:${matchId}`).emit('achievement_completed', { userId: uid, code: ach.code, title: ach.title })
            if (ach.badge_code) nsp.to(`match:${matchId}`).emit('badge_earned', { userId: uid, badgeCode: ach.badge_code, title: ach.title })
          }
        }
        if ((lbPlayer?.mvp_count || 0) >= 5) {
          const ach = await maybeUnlockAchievement({ userId: uid, code: 'mvp_master', progressMeta: { mvp_count: lbPlayer.mvp_count } })
          if (ach) {
            nsp.to(`match:${matchId}`).emit('achievement_completed', { userId: uid, code: ach.code, title: ach.title })
            if (ach.badge_code) nsp.to(`match:${matchId}`).emit('badge_earned', { userId: uid, badgeCode: ach.badge_code, title: ach.title })
          }
        }
        if (isAiBattle && isWin) {
          const ach = await maybeUnlockAchievement({ userId: uid, code: 'ai_battle_champion', progressMeta: { matchId } })
          if (ach) {
            nsp.to(`match:${matchId}`).emit('achievement_completed', { userId: uid, code: ach.code, title: ach.title })
            if (ach.badge_code) nsp.to(`match:${matchId}`).emit('badge_earned', { userId: uid, badgeCode: ach.badge_code, title: ach.title })
          }
        }

        perUserRewards[uid] = {
          xpGain: result?.xpDelta || 0,
          credits: result?.creditDelta || 0,
          mvp,
          level: result?.level || null,
          levelUp: !!result?.levelUp,
          rankMovement: queueType === 'ranked' ? 'updated' : 'n/a',
          streakBonus
        }
        if (result?.levelUp) {
          nsp.to(`match:${matchId}`).emit('level_up', { userId: uid, level: result.level })
        }
      }
    }

    nsp.to(`match:${matchId}`).emit('xp_gained', { matchId, rewards: perUserRewards })
    nsp.to(`match:${matchId}`).emit('reward_unlocked', { matchId, rewards: perUserRewards })

    // Tournament progression (single elimination)
    if (tournamentId) {
      // bracket for this match
      const { data: bRow } = await supabase
        .from('arena_brackets')
        .select('id,status,match_index,round_number,team1_id,team2_id')
        .eq('tournament_id', tournamentId)
        .eq('round_number', roundNumber)
        .eq('match_index', matchIndex)
        .maybeSingle()

      if (bRow?.id) {
        await supabase
          .from('arena_brackets')
          .update({ status: 'completed', winner_team_id: winnerTeamId })
          .eq('id', bRow.id)
      }

      const nextRound = roundNumber + 1
      const nextMatchIndex = Math.floor(matchIndex / 2)

      // Find next bracket row and fill winner into next slot
      const { data: nextBracket } = await supabase
        .from('arena_brackets')
        .select('id,team1_id,team2_id')
        .eq('tournament_id', tournamentId)
        .eq('round_number', nextRound)
        .eq('match_index', nextMatchIndex)
        .maybeSingle()

      if (nextBracket?.id) {
        const isOdd = matchIndex % 2 === 1
        await supabase
          .from('arena_brackets')
          .update({
            team1_id: isOdd ? nextBracket.team1_id : winnerTeamId,
            team2_id: isOdd ? winnerTeamId : nextBracket.team2_id,
            updated_at: new Date().toISOString(),
          })
          .eq('id', nextBracket.id)

        const { data: updatedNext } = await supabase
          .from('arena_brackets')
          .select('*')
          .eq('id', nextBracket.id)
          .maybeSingle()

        if (updatedNext?.team1_id && updatedNext?.team2_id && !updatedNext.match_id) {
          const startedAt = new Date().toISOString()
          const endsAt = new Date(Date.now() + (match.duration_minutes || 15) * 60 * 1000).toISOString()
          const aiChallenge = match.metadata?.aiChallenge || {}

          const { data: nextMatch, error: nmErr } = await supabase
            .from('arena_matches')
            .insert([
              {
                mode: match.mode,
                status: 'active',
                duration_minutes: match.duration_minutes || 15,
                started_at: startedAt,
                ends_at: endsAt,
                metadata: {
                  queueType,
                  aiBattle: true,
                  aiChallenge,
                  tournamentId,
                  roundNumber: nextRound,
                  matchIndex: nextMatchIndex
                }
              }
            ])
            .select('*')
            .single()
          if (nmErr) throw nmErr

          await supabase
            .from('arena_match_teams')
            .insert([{ match_id: nextMatch.id, team_id: updatedNext.team1_id }, { match_id: nextMatch.id, team_id: updatedNext.team2_id }])

          await supabase
            .from('arena_brackets')
            .update({ status: 'active', match_id: nextMatch.id })
            .eq('id', updatedNext.id)

          nsp.to(`match:${nextMatch.id}`).emit('arena_ai_battle_generated', {
            matchId: nextMatch.id,
            challenge: {
              title: aiChallenge.title,
              difficulty: aiChallenge.difficulty
            }
          })

          nsp.to(`team:${updatedNext.team1_id}`).emit('arena_match_found', { matchId: nextMatch.id })
          nsp.to(`team:${updatedNext.team2_id}`).emit('arena_match_found', { matchId: nextMatch.id })
          nsp.to(`team:${updatedNext.team1_id}`).emit('arena_match_started', { matchId: nextMatch.id })
          nsp.to(`team:${updatedNext.team2_id}`).emit('arena_match_started', { matchId: nextMatch.id })
          nsp.to(`team:${updatedNext.team1_id}`).emit('arena_tournament_started', { tournamentId, matchId: nextMatch.id })
          nsp.to(`team:${updatedNext.team2_id}`).emit('arena_tournament_started', { tournamentId, matchId: nextMatch.id })
        }
      }

      // If no pending/active brackets remain, finish tournament and grant prestige rewards.
      const { data: unresolved } = await supabase
        .from('arena_brackets')
        .select('id')
        .eq('tournament_id', tournamentId)
        .in('status', ['pending', 'active'])

      if (!unresolved || unresolved.length === 0) {
        await supabase
          .from('arena_tournaments')
          .update({ status: 'completed', completed_at: new Date().toISOString() })
          .eq('id', tournamentId)

        const { data: finalWinnerMembers } = await supabase
          .from('arena_team_members')
          .select('user_id')
          .eq('team_id', winnerTeamId)
          .eq('status', 'active')

        const { data: tournament } = await supabase
          .from('arena_tournaments')
          .select('name')
          .eq('id', tournamentId)
          .maybeSingle()

        for (const m of finalWinnerMembers || []) {
          const uid = m.user_id
          await grantRewardAtomic({
            userId: uid,
            sourceType: 'tournament',
            sourceRef: `${tournamentId}:${uid}`,
            xpDelta: 250,
            creditDelta: 180,
            badgeCode: 'tournament-champion',
            title: `Tournament Champion: ${tournament?.name || 'Arena Tournament'}`,
            metadata: { tournamentId, winnerTeamId }
          })
          await supabase.from('arena_certificates').insert([{
            user_id: uid,
            team_id: winnerTeamId,
            tournament_id: tournamentId,
            certificate_title: `${tournament?.name || 'Arena Tournament'} Champion`,
            metadata: {
              playerName: uid,
              teamId: winnerTeamId,
              tournamentName: tournament?.name || 'Arena Tournament',
              achievementTitle: 'Tournament Champion',
              date: new Date().toISOString()
            }
          }]).catch(() => {})

          nsp.to(`match:${matchId}`).emit('badge_earned', { userId: uid, badgeCode: 'tournament-champion', title: 'Tournament Champion' })
          nsp.to(`match:${matchId}`).emit('reward_unlocked', { userId: uid, source: 'tournament', xpGain: 250, credits: 180 })
        }
      }
    }

    nsp.to(`match:${matchId}`).emit('arena_match_finished', { matchId, status: 'completed', winnerTeamId })
  }

  async function ensureTimer(matchId) {
    if (timers.has(matchId)) return
    const { data: match } = await supabase.from('arena_matches').select('id,status,ends_at').eq('id', matchId).maybeSingle()
    if (!match || match.status !== 'active' || !match.ends_at) return

    const handle = setInterval(async () => {
      try {
        const endsAt = new Date(match.ends_at).getTime()
        const now = Date.now()
        const remainingMs = Math.max(0, endsAt - now)
        const remainingSec = Math.ceil(remainingMs / 1000)
        nsp.to(`match:${matchId}`).emit('arena_timer_update', { matchId, remainingSec })

        if (remainingSec <= 0) {
          clearInterval(handle)
          timers.delete(matchId)
          await finalizeMatch({ matchId })
        }
      } catch {
        // don't crash timer loop
      }
    }, 1000)
    timers.set(matchId, handle)
  }

  nsp.on('connection', (socket) => {
    socket.on('arena_join_team', async ({ teamId }) => {
      if (!teamId) return
      socket.join(`team:${teamId}`)
    })

    socket.on('arena_join_match', async ({ matchId }) => {
      if (!matchId) return
      socket.join(`match:${matchId}`)

      const docKey = arenaKey('doc', matchId)
      let content = await redisConnection.get(docKey).catch(() => null)
      if (!content) {
        const { data: m } = await supabase
          .from('arena_matches')
          .select('mode,metadata')
          .eq('id', matchId)
          .maybeSingle()
        content = m?.metadata?.aiChallenge?.starter_template || defaultDocForMode(m?.mode || 'frontend')
        await redisConnection.set(docKey, content, { EX: 60 * 60 * 6 }).catch(() => {})
      }
      socket.emit('arena_editor_state', { matchId, content })
      await ensureTimer(matchId)
    })

    socket.on('arena_editor_update', async ({ matchId, content, user }) => {
      if (!matchId || typeof content !== 'string') return
      const docKey = arenaKey('doc', matchId)
      await redisConnection.set(docKey, content, { EX: 60 * 60 * 6 }).catch(() => {})
      socket.to(`match:${matchId}`).emit('arena_editor_update', { matchId, content, user: user || null })
    })

    socket.on('arena_cursor_update', ({ matchId, cursor, user }) => {
      if (!matchId) return
      socket.to(`match:${matchId}`).emit('arena_cursor_update', { matchId, cursor, user: user || null })
    })

    socket.on('arena_presence', ({ matchId, user }) => {
      if (!matchId) return
      socket.to(`match:${matchId}`).emit('arena_presence', { matchId, user })
    })

    // ─────────────────────────────────────────────
    // Phase 2 Voice chat (WebRTC signaling + isolation per match)
    // ─────────────────────────────────────────────

    socket.on('arena_voice_join', async ({ matchId, user }) => {
      if (!matchId || !user?.id) return
      const voiceRoom = `voice:${matchId}:${user.id}`
      socket.join(voiceRoom)

      // store presence best-effort
      const setKey = arenaKey('voice_rooms', matchId)
      await redisConnection.set(`${setKey}:${user.id}`, String(Date.now()), { EX: 60 * 60 }).catch(() => {})

      socket.to(`match:${matchId}`).emit('arena_voice_joined', { matchId, user })
    })

    socket.on('arena_voice_leave', async ({ matchId, user }) => {
      if (!matchId || !user?.id) return
      const setKey = arenaKey('voice_rooms', matchId)
      await redisConnection.del(`${setKey}:${user.id}`).catch(() => {})
      socket.to(`match:${matchId}`).emit('arena_voice_left', { matchId, user })
    })

    // Relay WebRTC offer/answer/candidates to a specific teammate voice room
    socket.on('arena_voice_signal', async ({ matchId, toUserId, fromUserId, signal }) => {
      if (!matchId || !toUserId || !fromUserId || !signal) return
      nsp.to(`voice:${matchId}:${toUserId}`).emit('arena_voice_signal', { matchId, fromUserId, signal })
    })
  })

  return nsp
}

