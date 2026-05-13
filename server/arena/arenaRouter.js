import express from 'express'
import crypto from 'crypto'
import multer from 'multer'
import path from 'path'
import fsPromises from 'fs/promises'
import OpenAI from 'openai'

function clampTeamSize(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return 5
  return Math.min(5, Math.max(3, Math.round(v)))
}

function normalizeMode(mode) {
  const m = String(mode || '').trim().toLowerCase()
  if (m === 'frontend') return 'frontend'
  if (m === 'bugfix' || m === 'bug') return 'bugfix'
  if (m === 'fullstack') return 'fullstack'
  return 'frontend'
}

function normalizeDuration(minutes) {
  const m = Number(minutes)
  if (m === 15 || m === 30 || m === 60) return m
  return 15
}

function defaultDocForMode(mode) {
  if (mode === 'bugfix') {
    return `// Bugfix arena challenge (Phase 2)\n// Fix the bug and submit a ZIP.\n\nexport function add(a, b) {\n  // TODO: fix\n  return a - b\n}\n`
  }
  if (mode === 'fullstack') {
    return `// Fullstack mini-challenge (Phase 2)\n// Implement a minimal UI + API. Submit a ZIP.\n\nconsole.log('Hello arena')\n`
  }
  return `// Frontend challenge (Phase 2)\n// Build the UI logic. Submit a ZIP.\n\nconsole.log('Hello arena')\n`
}

function slugifyTeamName(name) {
  return String(name || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function arenaKey(...parts) {
  return ['arena', ...parts].join(':')
}

async function requireArenaUser(req, res, next) {
  // Lightweight auth gate (additive). Frontend already uses Supabase auth,
  // but Phase 1 uses a simple header user id to avoid touching main auth stack.
  const userId = req.header('x-user-id') || req.body?.userId || req.query?.userId
  if (!userId) return res.status(401).json({ success: false, message: 'Missing userId' })
  req.arenaUserId = userId
  next()
}

export function createArenaRouter({ supabase, io, redisConnection, storageBucket = 'submissions' }) {
  const router = express.Router()

  const upload = multer({
    dest: path.join(process.cwd(), 'server', 'tmp', 'arena'),
    limits: { fileSize: 50 * 1024 * 1024 }
  })

  const openai = new OpenAI({
    apiKey: process.env.GROK_API_KEY || 'placeholder',
    baseURL: 'https://api.x.ai/v1'
  })

  async function generateAiBattleChallenge({ mode, difficulty }) {
    // Placeholder fallback if not configured.
    if (!process.env.GROK_API_KEY || process.env.GROK_API_KEY === 'placeholder') {
      return {
        title: `${mode} arena challenge`,
        difficulty: difficulty || 'Medium',
        requirements: ['Implement the required functionality.', 'Submit a ZIP before timer ends.'],
        starter_template: defaultDocForMode(mode),
        scoring_rules: ['Correctness, readability, and completeness.'],
        expected_output: ['A working solution that matches requirements.']
      }
    }

    const system = `You are an expert competitive coding arena coach. Return ONLY valid JSON.`
    const prompt = `Generate an AI coding challenge.
Mode: ${mode}
Difficulty: ${difficulty}

Return JSON with keys:
title, requirements (array of strings), starter_template (string), scoring_rules (array of strings),
difficulty (string), expected_output (array of strings), task_type (string).

Keep starter_template small.`

    try {
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
      return {
        title: parsed.title || `${mode} arena challenge`,
        difficulty: parsed.difficulty || difficulty || 'Medium',
        requirements: Array.isArray(parsed.requirements) ? parsed.requirements : [],
        starter_template: String(parsed.starter_template || defaultDocForMode(mode)),
        scoring_rules: Array.isArray(parsed.scoring_rules) ? parsed.scoring_rules : [],
        expected_output: Array.isArray(parsed.expected_output) ? parsed.expected_output : [],
        task_type: parsed.task_type || mode
      }
    } catch {
      return {
        title: `${mode} arena challenge (fallback)`,
        difficulty: difficulty || 'Medium',
        requirements: ['Implement the required functionality.', 'Submit a ZIP before timer ends.'],
        starter_template: defaultDocForMode(mode),
        scoring_rules: ['Correctness, readability, and completeness.'],
        expected_output: ['A working solution that matches requirements.']
      }
    }
  }

  function getAiDifficultyFromMatchMinutes(minutes) {
    const m = Number(minutes)
    if (m >= 60) return 'Hard'
    if (m >= 30) return 'Medium'
    return 'Easy'
  }

  async function generateUniqueTeamSlug(teamName) {
    const base = slugifyTeamName(teamName) || `team-${crypto.randomBytes(2).toString('hex')}`
    let candidate = base
    for (let i = 0; i < 25; i++) {
      const { data } = await supabase.from('arena_teams').select('id').eq('team_slug', candidate).maybeSingle()
      if (!data) return candidate
      candidate = `${base}-${i + 2}`
    }
    return `${base}-${crypto.randomBytes(2).toString('hex')}`
  }

  // ─────────────────────────────────────────────
  // Teams
  // ─────────────────────────────────────────────

  router.get('/me/teams', requireArenaUser, async (req, res) => {
    try {
      const userId = req.arenaUserId
      const { data: memberships, error } = await supabase
        .from('arena_team_members')
        .select('team_id, role, status, arena_teams:team_id(id, owner_id, captain_user_id, name, team_slug, avatar_url, invite_code, recruitment_status, created_at)')
        .eq('user_id', userId)
        .eq('status', 'active')
      if (error) throw error
      res.json({ success: true, data: memberships || [] })
    } catch (err) {
      res.status(500).json({ success: false, message: err.message || 'Failed to load teams' })
    }
  })

  router.post('/teams', requireArenaUser, async (req, res) => {
    try {
      const userId = req.arenaUserId
      const name = String(req.body?.name || '').trim()
      const avatarUrl = req.body?.avatarUrl ? String(req.body.avatarUrl) : null
      const maxPlayers = clampTeamSize(req.body?.maxPlayers)
      const recruitmentStatusRaw = String(req.body?.recruitmentStatus || 'recruiting').toLowerCase()
      const recruitmentStatus = ['recruiting', 'invite-only', 'closed'].includes(recruitmentStatusRaw) ? recruitmentStatusRaw : 'recruiting'
      if (!name) return res.status(400).json({ success: false, message: 'Team name is required' })

      const inviteCode = crypto.randomBytes(4).toString('hex').toUpperCase()
      const teamSlug = await generateUniqueTeamSlug(name)
      const { data: team, error: teamErr } = await supabase
        .from('arena_teams')
        .insert([{ owner_id: userId, captain_user_id: userId, name, team_slug: teamSlug, avatar_url: avatarUrl, invite_code: inviteCode, recruitment_status: recruitmentStatus, metadata: { maxPlayers } }])
        .select('*')
        .single()
      if (teamErr) throw teamErr

      const { error: memErr } = await supabase
        .from('arena_team_members')
        .insert([{ team_id: team.id, user_id: userId, role: 'owner', status: 'active' }])
      if (memErr) throw memErr

      io.of('/arena').emit('arena_team_created', { teamId: team.id, teamSlug: team.team_slug, name: team.name })
      res.json({ success: true, data: team })
    } catch (err) {
      res.status(500).json({ success: false, message: err.message || 'Failed to create team' })
    }
  })

  router.post('/teams/:teamId/leave', requireArenaUser, async (req, res) => {
    try {
      const userId = req.arenaUserId
      const teamId = req.params.teamId

      const { data: mem } = await supabase
        .from('arena_team_members')
        .select('id, role, status')
        .eq('team_id', teamId)
        .eq('user_id', userId)
        .maybeSingle()
      if (!mem || mem.status !== 'active') return res.status(404).json({ success: false, message: 'Not a team member' })
      if (mem.role === 'owner') {
        return res.status(400).json({ success: false, message: 'Owner cannot leave team. Transfer ownership (Phase 2) or delete team (not implemented).' })
      }

      const { error } = await supabase
        .from('arena_team_members')
        .update({ status: 'left', left_at: new Date().toISOString() })
        .eq('id', mem.id)
      if (error) throw error

      res.json({ success: true })
    } catch (err) {
      res.status(500).json({ success: false, message: err.message || 'Failed to leave team' })
    }
  })

  router.post('/teams/join', requireArenaUser, async (req, res) => {
    try {
      const userId = req.arenaUserId
      const inviteCode = String(req.body?.inviteCode || '').trim().toUpperCase()
      if (!inviteCode) return res.status(400).json({ success: false, message: 'Invite code is required' })

      const { data: team, error: teamErr } = await supabase
        .from('arena_teams')
        .select('*')
        .eq('invite_code', inviteCode)
        .maybeSingle()
      if (teamErr) throw teamErr
      if (!team) return res.status(404).json({ success: false, message: 'Invalid invite code' })

      const { data: activeMembers } = await supabase
        .from('arena_team_members')
        .select('id')
        .eq('team_id', team.id)
        .eq('status', 'active')
      const maxPlayers = clampTeamSize(team?.metadata?.maxPlayers)
      if ((activeMembers?.length || 0) >= maxPlayers) {
        return res.status(400).json({ success: false, message: 'Team is full' })
      }

      const { error: joinErr } = await supabase
        .from('arena_team_members')
        .upsert([{ team_id: team.id, user_id: userId, role: 'member', status: 'active', joined_at: new Date().toISOString(), left_at: null }], { onConflict: 'team_id,user_id' })
      if (joinErr) throw joinErr

      io.of('/arena').to(`team:${team.id}`).emit('arena_team_joined', { teamId: team.id, userId })
      res.json({ success: true, data: { teamId: team.id } })
    } catch (err) {
      res.status(500).json({ success: false, message: err.message || 'Failed to join team' })
    }
  })

  router.get('/teams/marketplace', async (req, res) => {
    try {
      const q = String(req.query?.q || '').trim()
      let query = supabase
        .from('arena_teams')
        .select('id,name,team_slug,avatar_url,recruitment_status,captain_user_id,created_at')
        .order('created_at', { ascending: false })
        .limit(80)
      if (q) query = query.ilike('name', `%${q}%`)
      const { data: teams, error } = await query
      if (error) throw error

      const teamIds = (teams || []).map((t) => t.id)
      const [membersRes, lbRes, captainRes, tournRegRes] = await Promise.all([
        teamIds.length
          ? supabase.from('arena_team_members').select('team_id,user_id').eq('status', 'active').in('team_id', teamIds)
          : Promise.resolve({ data: [] }),
        teamIds.length
          ? supabase.from('arena_leaderboard').select('subject_id,wins,losses,matches_played,mvp_count,total_score').eq('scope', 'team').in('subject_id', teamIds)
          : Promise.resolve({ data: [] }),
        (teams || []).length
          ? supabase.from('users').select('id,name').in('id', (teams || []).map((t) => t.captain_user_id).filter(Boolean))
          : Promise.resolve({ data: [] }),
        teamIds.length
          ? supabase.from('arena_tournament_teams').select('team_id,id').in('team_id', teamIds)
          : Promise.resolve({ data: [] }),
      ])

      const memberCount = new Map()
      for (const m of membersRes.data || []) memberCount.set(m.team_id, (memberCount.get(m.team_id) || 0) + 1)
      const lbMap = new Map((lbRes.data || []).map((r) => [r.subject_id, r]))
      const capMap = new Map((captainRes.data || []).map((u) => [u.id, u.name]))
      const tournCount = new Map()
      for (const r of tournRegRes.data || []) tournCount.set(r.team_id, (tournCount.get(r.team_id) || 0) + 1)

      const out = (teams || []).map((t) => ({
        ...t,
        captain_name: capMap.get(t.captain_user_id) || 'Captain',
        active_members: memberCount.get(t.id) || 0,
        leaderboard: lbMap.get(t.id) || { wins: 0, losses: 0, matches_played: 0, mvp_count: 0, total_score: 0 },
        tournament_history_count: tournCount.get(t.id) || 0
      }))

      res.json({ success: true, data: out })
    } catch (err) {
      res.status(500).json({ success: false, message: err.message || 'Failed to load team marketplace' })
    }
  })

  router.get('/teams/slug/:teamSlug', async (req, res) => {
    try {
      const teamSlug = String(req.params.teamSlug || '').trim().toLowerCase()
      if (!teamSlug) return res.status(400).json({ success: false, message: 'Missing team slug' })

      const { data: team, error } = await supabase
        .from('arena_teams')
        .select('*')
        .eq('team_slug', teamSlug)
        .maybeSingle()
      if (error) throw error
      if (!team) return res.status(404).json({ success: false, message: 'Team not found' })

      const { data: members } = await supabase
        .from('arena_team_members')
        .select('user_id, role, status, joined_at, users(name, email)')
        .eq('team_id', team.id)
        .eq('status', 'active')

      const { data: lb } = await supabase
        .from('arena_leaderboard')
        .select('*')
        .eq('scope', 'team')
        .eq('subject_id', team.id)
        .maybeSingle()

      const { data: recentMatches } = await supabase
        .from('arena_match_teams')
        .select('match_id, arena_matches:match_id(id, mode, status, created_at, completed_at, winning_team_id, scheduled_at)')
        .eq('team_id', team.id)
        .order('match_id', { ascending: false })
        .limit(12)

      res.json({ success: true, data: { team, members: members || [], leaderboard: lb || null, recentMatches: recentMatches || [] } })
    } catch (err) {
      res.status(500).json({ success: false, message: err.message || 'Failed to load team profile' })
    }
  })

  router.post('/teams/:teamId/applications', requireArenaUser, async (req, res) => {
    try {
      const userId = req.arenaUserId
      const teamId = req.params.teamId
      const introduction = String(req.body?.introduction || '').trim().slice(0, 400)
      const desiredRole = String(req.body?.desiredRole || '').trim().slice(0, 64) || null

      const { data: team } = await supabase.from('arena_teams').select('id,recruitment_status').eq('id', teamId).maybeSingle()
      if (!team) return res.status(404).json({ success: false, message: 'Team not found' })
      if (team.recruitment_status === 'closed') return res.status(400).json({ success: false, message: 'Team is closed for applications' })

      const { data: alreadyMem } = await supabase
        .from('arena_team_members')
        .select('id')
        .eq('team_id', teamId)
        .eq('user_id', userId)
        .eq('status', 'active')
        .maybeSingle()
      if (alreadyMem) return res.status(400).json({ success: false, message: 'Already a team member' })

      const { error } = await supabase
        .from('arena_team_applications')
        .upsert([{ team_id: teamId, applicant_user_id: userId, desired_role: desiredRole, introduction, status: 'pending' }], { onConflict: 'team_id,applicant_user_id' })
      if (error) throw error
      res.json({ success: true })
    } catch (err) {
      res.status(500).json({ success: false, message: err.message || 'Failed to submit application' })
    }
  })

  router.get('/teams/:teamId/applications', requireArenaUser, async (req, res) => {
    try {
      const userId = req.arenaUserId
      const teamId = req.params.teamId

      const { data: team } = await supabase.from('arena_teams').select('owner_id,captain_user_id').eq('id', teamId).maybeSingle()
      if (!team) return res.status(404).json({ success: false, message: 'Team not found' })
      if (team.owner_id !== userId && team.captain_user_id !== userId) {
        return res.status(403).json({ success: false, message: 'Only captain can view applications' })
      }

      const { data, error } = await supabase
        .from('arena_team_applications')
        .select('id,team_id,applicant_user_id,desired_role,introduction,status,created_at,users:applicant_user_id(name,email)')
        .eq('team_id', teamId)
        .order('created_at', { ascending: false })
      if (error) throw error
      res.json({ success: true, data: data || [] })
    } catch (err) {
      res.status(500).json({ success: false, message: err.message || 'Failed to load applications' })
    }
  })

  router.post('/teams/:teamId/applications/:applicationId/review', requireArenaUser, async (req, res) => {
    try {
      const reviewer = req.arenaUserId
      const teamId = req.params.teamId
      const applicationId = req.params.applicationId
      const action = String(req.body?.action || '').toLowerCase()
      if (!['accept', 'reject'].includes(action)) return res.status(400).json({ success: false, message: 'action must be accept|reject' })

      const { data: team } = await supabase.from('arena_teams').select('id,owner_id,captain_user_id').eq('id', teamId).maybeSingle()
      if (!team) return res.status(404).json({ success: false, message: 'Team not found' })
      if (team.owner_id !== reviewer && team.captain_user_id !== reviewer) {
        return res.status(403).json({ success: false, message: 'Only captain can review applications' })
      }

      const { data: app } = await supabase
        .from('arena_team_applications')
        .select('*')
        .eq('id', applicationId)
        .eq('team_id', teamId)
        .maybeSingle()
      if (!app) return res.status(404).json({ success: false, message: 'Application not found' })

      await supabase
        .from('arena_team_applications')
        .update({ status: action === 'accept' ? 'accepted' : 'rejected', reviewed_by: reviewer, reviewed_at: new Date().toISOString() })
        .eq('id', applicationId)

      if (action === 'accept') {
        await supabase
          .from('arena_team_members')
          .upsert([{ team_id: teamId, user_id: app.applicant_user_id, role: 'member', status: 'active', joined_at: new Date().toISOString(), left_at: null }], { onConflict: 'team_id,user_id' })
        io.of('/arena').to(`team:${teamId}`).emit('arena_team_joined', { teamId, userId: app.applicant_user_id })
      }

      res.json({ success: true })
    } catch (err) {
      res.status(500).json({ success: false, message: err.message || 'Failed to review application' })
    }
  })

  router.post('/teams/:teamId/invite-link', requireArenaUser, async (req, res) => {
    try {
      const userId = req.arenaUserId
      const teamId = req.params.teamId
      const { data: team } = await supabase.from('arena_teams').select('id,team_slug,owner_id,captain_user_id').eq('id', teamId).maybeSingle()
      if (!team) return res.status(404).json({ success: false, message: 'Team not found' })
      if (team.owner_id !== userId && team.captain_user_id !== userId) return res.status(403).json({ success: false, message: 'Only captain can create invites' })

      const token = crypto.randomBytes(6).toString('hex')
      const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString()
      const { error } = await supabase
        .from('arena_team_invites')
        .insert([{ team_id: teamId, invite_token: token, created_by: userId, expires_at: expiresAt, uses_remaining: 50 }])
      if (error) throw error

      const invitePath = `/arena/join/${team.team_slug}?invite=${token}`
      res.json({ success: true, data: { invitePath, token, teamSlug: team.team_slug, expiresAt } })
    } catch (err) {
      res.status(500).json({ success: false, message: err.message || 'Failed to create invite link' })
    }
  })

  router.post('/join/:teamSlug', requireArenaUser, async (req, res) => {
    try {
      const userId = req.arenaUserId
      const teamSlug = String(req.params.teamSlug || '').trim().toLowerCase()
      const token = String(req.body?.invite || req.query?.invite || '').trim()
      if (!teamSlug || !token) return res.status(400).json({ success: false, message: 'Missing slug or invite token' })

      const { data: team } = await supabase.from('arena_teams').select('*').eq('team_slug', teamSlug).maybeSingle()
      if (!team) return res.status(404).json({ success: false, message: 'Team not found' })

      const { data: inv } = await supabase
        .from('arena_team_invites')
        .select('*')
        .eq('team_id', team.id)
        .eq('invite_token', token)
        .maybeSingle()
      if (!inv) return res.status(403).json({ success: false, message: 'Invalid invite' })
      if (inv.expires_at && new Date(inv.expires_at).getTime() < Date.now()) return res.status(403).json({ success: false, message: 'Invite expired' })
      if ((inv.uses_remaining || 0) <= 0) return res.status(403).json({ success: false, message: 'Invite exhausted' })

      await supabase
        .from('arena_team_members')
        .upsert([{ team_id: team.id, user_id: userId, role: 'member', status: 'active', joined_at: new Date().toISOString(), left_at: null }], { onConflict: 'team_id,user_id' })
      await supabase
        .from('arena_team_invites')
        .update({ uses_remaining: Math.max(0, Number(inv.uses_remaining || 1) - 1) })
        .eq('id', inv.id)

      io.of('/arena').to(`team:${team.id}`).emit('arena_team_joined', { teamId: team.id, userId })
      res.json({ success: true, data: { teamId: team.id, teamSlug: team.team_slug } })
    } catch (err) {
      res.status(500).json({ success: false, message: err.message || 'Failed to join with invite' })
    }
  })

  router.get('/teams/:teamId', requireArenaUser, async (req, res) => {
    try {
      const teamId = req.params.teamId
      const { data: team, error } = await supabase.from('arena_teams').select('*').eq('id', teamId).single()
      if (error) throw error
      const { data: members } = await supabase
        .from('arena_team_members')
        .select('user_id, role, status, joined_at, users(name, email)')
        .eq('team_id', teamId)
        .eq('status', 'active')
      res.json({ success: true, data: { team, members: members || [] } })
    } catch (err) {
      res.status(500).json({ success: false, message: err.message || 'Failed to load team' })
    }
  })

  router.post('/teams/:teamId/members/:memberUserId/remove', requireArenaUser, async (req, res) => {
    try {
      const actor = req.arenaUserId
      const teamId = req.params.teamId
      const memberUserId = req.params.memberUserId
      const { data: team } = await supabase.from('arena_teams').select('owner_id,captain_user_id').eq('id', teamId).maybeSingle()
      if (!team) return res.status(404).json({ success: false, message: 'Team not found' })
      if (team.owner_id !== actor && team.captain_user_id !== actor) return res.status(403).json({ success: false, message: 'Only captain can remove members' })
      if (team.owner_id === memberUserId) return res.status(400).json({ success: false, message: 'Cannot remove owner' })

      await supabase
        .from('arena_team_members')
        .update({ status: 'left', left_at: new Date().toISOString() })
        .eq('team_id', teamId)
        .eq('user_id', memberUserId)
        .eq('status', 'active')
      res.json({ success: true })
    } catch (err) {
      res.status(500).json({ success: false, message: err.message || 'Failed to remove member' })
    }
  })

  router.post('/teams/:teamId/members/:memberUserId/promote', requireArenaUser, async (req, res) => {
    try {
      const actor = req.arenaUserId
      const teamId = req.params.teamId
      const memberUserId = req.params.memberUserId
      const { data: team } = await supabase.from('arena_teams').select('owner_id,captain_user_id').eq('id', teamId).maybeSingle()
      if (!team) return res.status(404).json({ success: false, message: 'Team not found' })
      if (team.owner_id !== actor && team.captain_user_id !== actor) return res.status(403).json({ success: false, message: 'Only captain can promote members' })

      await supabase
        .from('arena_team_members')
        .update({ role: 'owner' })
        .eq('team_id', teamId)
        .eq('user_id', memberUserId)
        .eq('status', 'active')
      await supabase.from('arena_teams').update({ captain_user_id: memberUserId }).eq('id', teamId)
      res.json({ success: true })
    } catch (err) {
      res.status(500).json({ success: false, message: err.message || 'Failed to promote member' })
    }
  })

  // ─────────────────────────────────────────────
  // Matchmaking (simplified)
  // ─────────────────────────────────────────────

  router.post('/queue', requireArenaUser, async (req, res) => {
    try {
      const userId = req.arenaUserId
      const teamId = String(req.body?.teamId || '').trim()
      const mode = normalizeMode(req.body?.mode)
      const queueTypeRaw = String(req.body?.queueType || 'casual').trim().toLowerCase()
      const queueType = queueTypeRaw === 'ranked' ? 'ranked' : 'casual'
      const durationMinutes = normalizeDuration(req.body?.durationMinutes)

      if (!teamId) return res.status(400).json({ success: false, message: 'Missing teamId' })

      const { data: mem } = await supabase
        .from('arena_team_members')
        .select('role, status')
        .eq('team_id', teamId)
        .eq('user_id', userId)
        .maybeSingle()
      if (!mem || mem.status !== 'active') return res.status(403).json({ success: false, message: 'Not a team member' })

      const qKey = arenaKey('matchmaking', mode, String(durationMinutes))
      // prevent duplicate queue entries for same team
      const pendingKey = arenaKey('team_registry', 'queue_pending', teamId)
      const existing = await redisConnection.get(pendingKey).catch(() => null)
      if (existing) return res.json({ success: true, data: { queued: true } })

      await redisConnection.set(pendingKey, qKey, { EX: 1200 }).catch(() => {})
      await redisConnection.rpush(qKey, teamId).catch(() => {})

      // simplistic: when 2+ teams, pop two and create match
      const t1 = await redisConnection.lrange(qKey, 0, 0).then((a) => a?.[0]).catch(() => null)
      const t2 = await redisConnection.lrange(qKey, 1, 1).then((a) => a?.[0]).catch(() => null)

      if (t1 && t2) {
        // clear queue entries (best-effort)
        await redisConnection.del(pendingKey).catch(() => {})
        await redisConnection.del(arenaKey('team_registry', 'queue_pending', t2)).catch(() => {})

        // create match in DB
        const startedAt = new Date().toISOString()
        const endsAt = new Date(Date.now() + durationMinutes * 60 * 1000).toISOString()
        const aiDifficulty = getAiDifficultyFromMatchMinutes(durationMinutes)
        const aiChallenge = await generateAiBattleChallenge({ mode, difficulty: aiDifficulty })
        const { data: match, error: mErr } = await supabase
          .from('arena_matches')
          .insert([
            {
              mode,
              status: 'active',
              duration_minutes: durationMinutes,
              started_at: startedAt,
              ends_at: endsAt,
              metadata: {
                queueType,
                aiBattle: true,
                aiChallenge
              }
            }
          ])
          .select('*')
          .single()
        if (mErr) throw mErr

        const { error: mtErr } = await supabase
          .from('arena_match_teams')
          .insert([{ match_id: match.id, team_id: t1 }, { match_id: match.id, team_id: t2 }])
        if (mtErr) throw mtErr

        io.of('/arena').to(`team:${t1}`).emit('arena_match_started', { matchId: match.id })
        io.of('/arena').to(`team:${t2}`).emit('arena_match_started', { matchId: match.id })

        io.of('/arena').to(`team:${t1}`).emit('arena_match_found', { matchId: match.id })
        io.of('/arena').to(`team:${t2}`).emit('arena_match_found', { matchId: match.id })

        io.of('/arena').to(`match:${match.id}`).emit('arena_ai_battle_generated', {
          matchId: match.id,
          challenge: {
            title: aiChallenge.title,
            difficulty: aiChallenge.difficulty,
          }
        })

        return res.json({ success: true, data: { matchId: match.id, status: 'active' } })
      }

      res.json({ success: true, data: { queued: true } })
    } catch (err) {
      res.status(500).json({ success: false, message: err.message || 'Failed to queue' })
    }
  })

  // ─────────────────────────────────────────────
  // Tournament system (single elimination, Phase 2)
  // ─────────────────────────────────────────────

  router.post('/tournaments', requireArenaUser, async (req, res) => {
    try {
      const ownerId = req.arenaUserId
      const name = String(req.body?.name || '').trim()
      const mode = normalizeMode(req.body?.mode)
      const elimination_format = 'single_elimination'
      const duration_minutes = normalizeDuration(req.body?.durationMinutes)
      const queueTypeRaw = String(req.body?.queueType || 'casual').toLowerCase()
      const queue_type = queueTypeRaw === 'ranked' ? 'ranked' : 'casual'

      if (!name) return res.status(400).json({ success: false, message: 'Tournament name is required' })

      const { data: tournament, error } = await supabase
        .from('arena_tournaments')
        .insert([
          {
            owner_id: ownerId,
            name,
            mode,
            elimination_format,
            duration_minutes,
            queue_type,
            status: 'recruiting',
            metadata: {}
          }
        ])
        .select('*')
        .single()
      if (error) throw error

      res.json({ success: true, data: tournament })
    } catch (err) {
      res.status(500).json({ success: false, message: err.message || 'Failed to create tournament' })
    }
  })

  router.post('/tournaments/:tournamentId/register', requireArenaUser, async (req, res) => {
    try {
      const tournamentId = req.params.tournamentId
      const userId = req.arenaUserId
      const teamId = String(req.body?.teamId || '').trim()
      if (!teamId) return res.status(400).json({ success: false, message: 'teamId is required' })

      const { data: tournament } = await supabase
        .from('arena_tournaments')
        .select('id,status')
        .eq('id', tournamentId)
        .maybeSingle()

      if (!tournament) return res.status(404).json({ success: false, message: 'Tournament not found' })
      if (tournament.status !== 'recruiting') return res.status(400).json({ success: false, message: 'Tournament not recruiting' })

      const { data: team } = await supabase
        .from('arena_teams')
        .select('id,name,captain_user_id,owner_id,team_slug')
        .eq('id', teamId)
        .maybeSingle()
      if (!team) return res.status(404).json({ success: false, message: 'Team not found' })
      if (team.owner_id !== userId && team.captain_user_id !== userId) {
        return res.status(403).json({ success: false, message: 'Only team captain can register' })
      }

      const [{ data: members }, { data: rankRow }] = await Promise.all([
        supabase.from('arena_team_members').select('user_id,role,status').eq('team_id', teamId).eq('status', 'active'),
        supabase.from('arena_leaderboard').select('wins,losses,matches_played,total_score,mvp_count').eq('scope', 'team').eq('subject_id', teamId).maybeSingle()
      ])

      const snapshot = {
        team: { id: team.id, name: team.name, slug: team.team_slug },
        rank: rankRow || { wins: 0, losses: 0, matches_played: 0, total_score: 0, mvp_count: 0 },
        members: members || [],
        active_players: (members || []).length
      }

      const { error } = await supabase
        .from('arena_tournament_teams')
        .insert([{ tournament_id: tournamentId, team_id: teamId, metadata: snapshot }])
      if (error) throw error

      await redisConnection
        .set(arenaKey('tournament_queue', tournamentId, teamId), JSON.stringify({ registeredAt: new Date().toISOString() }), { EX: 60 * 60 * 24 * 30 })
        .catch(() => {})

      io.of('/arena').emit('arena_tournament_registered', { tournamentId, teamId })
      res.json({ success: true })
    } catch (err) {
      res.status(500).json({ success: false, message: err.message || 'Failed to register' })
    }
  })

  router.post('/tournaments/:tournamentId/start', requireArenaUser, async (req, res) => {
    try {
      const tournamentId = req.params.tournamentId
      const userId = req.arenaUserId

      const { data: tournament } = await supabase
        .from('arena_tournaments')
        .select('*')
        .eq('id', tournamentId)
        .maybeSingle()
      if (!tournament) return res.status(404).json({ success: false, message: 'Tournament not found' })
      if (tournament.owner_id !== userId) return res.status(403).json({ success: false, message: 'Only owner can start' })
      if (tournament.status !== 'recruiting') return res.status(400).json({ success: false, message: 'Tournament not recruiting' })

      const { data: regs } = await supabase
        .from('arena_tournament_teams')
        .select('team_id')
        .eq('tournament_id', tournamentId)
      const teamIds = (regs || []).map((r) => r.team_id)

      if (teamIds.length < 2) return res.status(400).json({ success: false, message: 'Need at least 2 teams' })
      const isPowerOfTwo = (n) => n && (n & (n - 1)) === 0
      if (!isPowerOfTwo(teamIds.length)) {
        return res.status(400).json({ success: false, message: 'Phase 2 requires team count to be a power of 2.' })
      }

      const now = new Date().toISOString()
      const { error: tErr } = await supabase
        .from('arena_tournaments')
        .update({ status: 'started', started_at: now })
        .eq('id', tournamentId)
      if (tErr) throw tErr

      const difficulty = getAiDifficultyFromMatchMinutes(tournament.duration_minutes)

      const rounds = Math.log2(teamIds.length)
      const rCount = (r) => teamIds.length / (2 ** r)

      // Create bracket rows for all rounds (pending), then fill Round 1 pairings.
      for (let r = 1; r <= rounds; r++) {
        const countR = rCount(r)
        for (let i = 0; i < countR; i++) {
          const t1 = r === 1 ? teamIds[i * 2] : null
          const t2 = r === 1 ? teamIds[i * 2 + 1] : null
          await supabase.from('arena_brackets').insert([
            {
              tournament_id: tournamentId,
              round_number: r,
              match_index: i,
              status: r === 1 ? 'active' : 'pending',
              team1_id: t1,
              team2_id: t2,
              match_id: null,
              winner_team_id: null
            }
          ])
        }
      }

      // Create matches only for Round 1 right away.
      const roundNumber = 1
      const matchCount = teamIds.length / 2
      for (let i = 0; i < matchCount; i++) {
        const t1 = teamIds[i * 2]
        const t2 = teamIds[i * 2 + 1]
        const startedAt = now
        const endsAt = new Date(Date.now() + tournament.duration_minutes * 60 * 1000).toISOString()

        const aiChallenge = await generateAiBattleChallenge({ mode: tournament.mode, difficulty })

        const { data: match, error: mErr } = await supabase
          .from('arena_matches')
          .insert([
            {
              mode: tournament.mode,
              status: 'active',
              duration_minutes: tournament.duration_minutes,
              started_at: startedAt,
              ends_at: endsAt,
              metadata: {
                queueType: tournament.queue_type,
                aiBattle: true,
                aiChallenge,
                tournamentId,
                roundNumber,
                matchIndex: i
              }
            }
          ])
          .select('*')
          .single()
        if (mErr) throw mErr

        const { error: mtErr } = await supabase
          .from('arena_match_teams')
          .insert([{ match_id: match.id, team_id: t1 }, { match_id: match.id, team_id: t2 }])
        if (mtErr) throw mtErr

        // Attach match_id to the already-created Round 1 bracket row.
        await supabase
          .from('arena_brackets')
          .update({ status: 'active', match_id: match.id })
          .eq('tournament_id', tournamentId)
          .eq('round_number', roundNumber)
          .eq('match_index', i)

        io.of('/arena').to(`team:${t1}`).emit('arena_tournament_started', { tournamentId, matchId: match.id })
        io.of('/arena').to(`team:${t2}`).emit('arena_tournament_started', { tournamentId, matchId: match.id })

        // Match found + match started for navigation.
        io.of('/arena').to(`team:${t1}`).emit('arena_match_found', { matchId: match.id })
        io.of('/arena').to(`team:${t2}`).emit('arena_match_found', { matchId: match.id })
        io.of('/arena').to(`team:${t1}`).emit('arena_match_started', { matchId: match.id })
        io.of('/arena').to(`team:${t2}`).emit('arena_match_started', { matchId: match.id })
      }

      res.json({ success: true, data: { started: true } })
    } catch (err) {
      res.status(500).json({ success: false, message: err.message || 'Failed to start tournament' })
    }
  })

  // Organizer schedules a bracket match (pre-match lobby)
  router.post('/tournaments/:tournamentId/schedule-match', requireArenaUser, async (req, res) => {
    try {
      const userId = req.arenaUserId
      const tournamentId = req.params.tournamentId
      const roundNumber = Number(req.body?.roundNumber || 1)
      const matchIndex = Number(req.body?.matchIndex || 0)
      const scheduledAt = String(req.body?.scheduledAt || '').trim()
      if (!scheduledAt) return res.status(400).json({ success: false, message: 'scheduledAt is required' })

      const { data: tournament } = await supabase
        .from('arena_tournaments')
        .select('*')
        .eq('id', tournamentId)
        .maybeSingle()
      if (!tournament) return res.status(404).json({ success: false, message: 'Tournament not found' })
      if (tournament.owner_id !== userId) return res.status(403).json({ success: false, message: 'Only organizer can schedule' })

      const { data: bracket } = await supabase
        .from('arena_brackets')
        .select('*')
        .eq('tournament_id', tournamentId)
        .eq('round_number', roundNumber)
        .eq('match_index', matchIndex)
        .maybeSingle()
      if (!bracket) return res.status(404).json({ success: false, message: 'Bracket row not found' })
      if (!bracket.team1_id || !bracket.team2_id) return res.status(400).json({ success: false, message: 'Both teams not finalized yet' })

      const aiDifficulty = getAiDifficultyFromMatchMinutes(tournament.duration_minutes)
      const aiChallenge = await generateAiBattleChallenge({ mode: tournament.mode, difficulty: aiDifficulty })

      const { data: match, error: mErr } = await supabase
        .from('arena_matches')
        .insert([
          {
            mode: tournament.mode,
            status: 'waiting',
            duration_minutes: tournament.duration_minutes,
            scheduled_at: scheduledAt,
            metadata: {
              queueType: tournament.queue_type,
              aiBattle: true,
              aiChallenge,
              tournamentId,
              roundNumber,
              matchIndex
            }
          }
        ])
        .select('*')
        .single()
      if (mErr) throw mErr

      await supabase
        .from('arena_match_teams')
        .insert([{ match_id: match.id, team_id: bracket.team1_id }, { match_id: match.id, team_id: bracket.team2_id }])

      await supabase
        .from('arena_brackets')
        .update({ status: 'pending', match_id: match.id, updated_at: new Date().toISOString() })
        .eq('id', bracket.id)

      io.of('/arena').to(`team:${bracket.team1_id}`).emit('arena_match_scheduled', { matchId: match.id, scheduledAt, tournamentId })
      io.of('/arena').to(`team:${bracket.team2_id}`).emit('arena_match_scheduled', { matchId: match.id, scheduledAt, tournamentId })

      res.json({ success: true, data: { matchId: match.id, scheduledAt } })
    } catch (err) {
      res.status(500).json({ success: false, message: err.message || 'Failed to schedule match' })
    }
  })

  router.get('/matches/:matchId/prematch', requireArenaUser, async (req, res) => {
    try {
      const userId = req.arenaUserId
      const matchId = req.params.matchId
      const { data: match } = await supabase.from('arena_matches').select('*').eq('id', matchId).maybeSingle()
      if (!match) return res.status(404).json({ success: false, message: 'Match not found' })

      const { data: teams } = await supabase
        .from('arena_match_teams')
        .select('team_id, arena_teams:team_id(id,name,team_slug,avatar_url)')
        .eq('match_id', matchId)

      const teamIds = (teams || []).map((t) => t.team_id)
      const { data: members } = teamIds.length
        ? await supabase.from('arena_team_members').select('team_id,user_id,users(name)').in('team_id', teamIds).eq('status', 'active')
        : { data: [] }

      const readiness = {}
      for (const teamId of teamIds) {
        const readyRaw = await redisConnection.get(arenaKey('matchmaking', 'ready', matchId, teamId)).catch(() => null)
        readiness[teamId] = Number(readyRaw || 0)
      }

      res.json({ success: true, data: { match, teams: teams || [], members: members || [], readiness } })
    } catch (err) {
      res.status(500).json({ success: false, message: err.message || 'Failed to load pre-match lobby' })
    }
  })

  router.post('/matches/:matchId/join-day', requireArenaUser, async (req, res) => {
    try {
      const userId = req.arenaUserId
      const matchId = req.params.matchId
      const teamId = String(req.body?.teamId || '').trim()
      if (!teamId) return res.status(400).json({ success: false, message: 'teamId is required' })

      const { data: match } = await supabase.from('arena_matches').select('*').eq('id', matchId).maybeSingle()
      if (!match) return res.status(404).json({ success: false, message: 'Match not found' })
      if (match.status !== 'waiting' && match.status !== 'active') {
        return res.status(400).json({ success: false, message: 'Match not joinable' })
      }

      const { data: teamLink } = await supabase
        .from('arena_match_teams')
        .select('id')
        .eq('match_id', matchId)
        .eq('team_id', teamId)
        .maybeSingle()
      if (!teamLink) return res.status(403).json({ success: false, message: 'Team not in match' })

      const { data: mem } = await supabase
        .from('arena_team_members')
        .select('id')
        .eq('team_id', teamId)
        .eq('user_id', userId)
        .eq('status', 'active')
        .maybeSingle()
      if (!mem) return res.status(403).json({ success: false, message: 'Not an active team member' })

      const teamMembers = await supabase.from('arena_team_members').select('user_id').eq('team_id', teamId).eq('status', 'active')
      const minRequired = Math.min(2, (teamMembers.data || []).length)
      const readyKey = arenaKey('matchmaking', 'ready', matchId, teamId)
      const currentReady = Number((await redisConnection.get(readyKey).catch(() => '0')) || 0)
      const nextReady = currentReady + 1
      await redisConnection.set(readyKey, String(nextReady), { EX: 60 * 60 }).catch(() => {})

      io.of('/arena').to(`team:${teamId}`).emit('arena_match_ready', { matchId, teamId, readyCount: nextReady, required: minRequired })

      const { data: teams } = await supabase.from('arena_match_teams').select('team_id').eq('match_id', matchId)
      let allReady = true
      for (const t of teams || []) {
        const tm = await supabase.from('arena_team_members').select('user_id').eq('team_id', t.team_id).eq('status', 'active')
        const reqCount = Math.min(2, (tm.data || []).length)
        const readyCount = Number((await redisConnection.get(arenaKey('matchmaking', 'ready', matchId, t.team_id)).catch(() => '0')) || 0)
        if (readyCount < reqCount) {
          allReady = false
          break
        }
      }

      if (allReady && match.status === 'waiting') {
        const startedAt = new Date().toISOString()
        const endsAt = new Date(Date.now() + Number(match.duration_minutes || 15) * 60 * 1000).toISOString()
        await supabase
          .from('arena_matches')
          .update({ status: 'active', started_at: startedAt, ends_at: endsAt })
          .eq('id', matchId)
          .eq('status', 'waiting')

        for (const t of teams || []) {
          io.of('/arena').to(`team:${t.team_id}`).emit('arena_match_started', { matchId })
        }
      }

      res.json({ success: true, data: { readyCount: nextReady, required: minRequired, allReady } })
    } catch (err) {
      res.status(500).json({ success: false, message: err.message || 'Failed to join match day flow' })
    }
  })

  // Tournament listing + bracket fetch (Phase 2 UI scaffolding)
  router.get('/tournaments/recruiting', async (_req, res) => {
    try {
      const { data } = await supabase
        .from('arena_tournaments')
        .select('*')
        .eq('status', 'recruiting')
        .order('created_at', { ascending: false })
        .limit(10)
      res.json({ success: true, data: data || [] })
    } catch (err) {
      res.status(500).json({ success: false, message: err.message || 'Failed to load tournaments' })
    }
  })

  router.get('/tournaments/list', async (_req, res) => {
    try {
      const { data } = await supabase
        .from('arena_tournaments')
        .select('*')
        .in('status', ['recruiting', 'started'])
        .order('created_at', { ascending: false })
        .limit(25)
      res.json({ success: true, data: data || [] })
    } catch (err) {
      res.status(500).json({ success: false, message: err.message || 'Failed to load tournaments' })
    }
  })

  router.get('/tournaments/:tournamentId/bracket', requireArenaUser, async (req, res) => {
    try {
      const tournamentId = req.params.tournamentId

      const { data: tournament } = await supabase
        .from('arena_tournaments')
        .select('id,name,status,mode,duration_minutes,queue_type')
        .eq('id', tournamentId)
        .maybeSingle()

      if (!tournament) return res.status(404).json({ success: false, message: 'Tournament not found' })

      const { data: brackets } = await supabase
        .from('arena_brackets')
        .select('id,round_number,match_index,status,team1_id,team2_id,match_id,winner_team_id,arena_teams:team1_id(id,name),arena_teams2:team2_id(id,name)')
        .eq('tournament_id', tournamentId)
        .order('round_number', { ascending: true })
        .order('match_index', { ascending: true })

      res.json({ success: true, data: { tournament, brackets: brackets || [] } })
    } catch (err) {
      res.status(500).json({ success: false, message: err.message || 'Failed to load bracket' })
    }
  })

  router.get('/matches/:matchId', requireArenaUser, async (req, res) => {
    try {
      const matchId = req.params.matchId
      const { data: match, error } = await supabase.from('arena_matches').select('*').eq('id', matchId).single()
      if (error) throw error
      const { data: teams } = await supabase
        .from('arena_match_teams')
        .select('team_id, arena_teams:team_id(id, name, avatar_url)')
        .eq('match_id', matchId)
      res.json({ success: true, data: { match, teams: teams || [] } })
    } catch (err) {
      res.status(500).json({ success: false, message: err.message || 'Failed to load match' })
    }
  })

  // Arena status for dashboard card (Phase 2)
  router.get('/status', async (_req, res) => {
    try {
      const { data: activeMatches } = await supabase
        .from('arena_matches')
        .select('id,status')
        .eq('status', 'active')
      const matchIds = (activeMatches || []).map((m) => m.id)

      let activePlayers = 0
      if (matchIds.length > 0) {
        const { data: matchTeams } = await supabase
          .from('arena_match_teams')
          .select('team_id')
          .in('match_id', matchIds)
        const teamIds = (matchTeams || []).map((x) => x.team_id)
        if (teamIds.length > 0) {
          const { data: members } = await supabase
            .from('arena_team_members')
            .select('user_id')
            .eq('status', 'active')
            .in('team_id', teamIds)
          const uniq = new Set((members || []).map((m) => m.user_id))
          activePlayers = uniq.size
        }
      }

      res.json({
        success: true,
        data: {
          liveMatches: (activeMatches || []).length,
          activePlayers,
          queueStatus: (activeMatches || []).length > 0 ? 'In matches' : 'Open'
        }
      })
    } catch (err) {
      res.status(500).json({ success: false, message: err.message || 'Failed to load arena status' })
    }
  })

  // ─────────────────────────────────────────────
  // Submissions (ZIP)
  // ─────────────────────────────────────────────

  router.post('/matches/:matchId/submit', requireArenaUser, upload.single('zip'), async (req, res) => {
    try {
      const userId = req.arenaUserId
      const matchId = req.params.matchId
      const teamId = String(req.body?.teamId || '').trim()
      if (!teamId) return res.status(400).json({ success: false, message: 'Missing teamId' })
      if (!req.file) return res.status(400).json({ success: false, message: 'Missing zip file' })

      const { data: mem } = await supabase
        .from('arena_team_members')
        .select('status')
        .eq('team_id', teamId)
        .eq('user_id', userId)
        .maybeSingle()
      if (!mem || mem.status !== 'active') return res.status(403).json({ success: false, message: 'Not a team member' })

      const fileName = `arena/matches/${matchId}/${teamId}/${crypto.randomUUID()}.zip`
      const fileBuf = await fsPromises.readFile(req.file.path)
      await fsPromises.unlink(req.file.path).catch(() => {})

      const { error: upErr } = await supabase.storage.from(storageBucket).upload(fileName, fileBuf, {
        contentType: 'application/zip',
        upsert: true
      })
      if (upErr) throw upErr

      const { data: pub } = supabase.storage.from(storageBucket).getPublicUrl(fileName)
      const artifactUrl = pub?.publicUrl || null

      const { error: sErr } = await supabase
        .from('arena_submissions')
        .insert([{ match_id: matchId, team_id: teamId, artifact_url: artifactUrl }])
      if (sErr) throw sErr

      io.of('/arena').to(`match:${matchId}`).emit('arena_submission_received', { matchId, teamId })
      res.json({ success: true, data: { artifactUrl } })
    } catch (err) {
      res.status(500).json({ success: false, message: err.message || 'Failed to submit' })
    }
  })

  // ─────────────────────────────────────────────
  // Leaderboard
  // ─────────────────────────────────────────────

  router.get('/leaderboard', async (_req, res) => {
    try {
      const { data: topTeams } = await supabase
        .from('arena_leaderboard')
        .select('*')
        .eq('scope', 'team')
        .order('wins', { ascending: false })
        .limit(20)
      const { data: topPlayers } = await supabase
        .from('arena_leaderboard')
        .select('*')
        .eq('scope', 'player')
        .order('wins', { ascending: false })
        .limit(20)
      res.json({ success: true, data: { teams: topTeams || [], players: topPlayers || [] } })
    } catch (err) {
      res.status(500).json({ success: false, message: err.message || 'Failed to load leaderboard' })
    }
  })

  router.get('/ranks/me', requireArenaUser, async (req, res) => {
    try {
      const userId = req.arenaUserId
      const { data, error } = await supabase
        .from('arena_player_ranks')
        .select('*')
        .eq('player_id', userId)
        .eq('scope_mode', 'global')
        .maybeSingle()
      if (error) throw error
      res.json({ success: true, data: data || null })
    } catch (err) {
      res.status(500).json({ success: false, message: err.message || 'Failed to load rank' })
    }
  })

  // ─────────────────────────────────────────────
  // Reward Center (Phase 1)
  // ─────────────────────────────────────────────
  router.get('/rewards/me', requireArenaUser, async (req, res) => {
    try {
      const userId = req.arenaUserId
      const [{ data: progression }, { data: rewards }, { data: achievements }, { data: certs }, { data: rank }] = await Promise.all([
        supabase.from('arena_player_progression').select('*').eq('user_id', userId).maybeSingle(),
        supabase.from('arena_rewards').select('*').eq('user_id', userId).order('granted_at', { ascending: false }).limit(100),
        supabase
          .from('arena_user_achievements')
          .select('id,unlocked_at,achievement_id,arena_achievements:achievement_id(code,title,description,badge_code)')
          .eq('user_id', userId)
          .order('unlocked_at', { ascending: false })
          .limit(100),
        supabase.from('arena_certificates').select('*').eq('user_id', userId).order('issued_at', { ascending: false }).limit(50),
        supabase.from('arena_player_ranks').select('*').eq('player_id', userId).eq('scope_mode', 'global').maybeSingle()
      ])

      res.json({
        success: true,
        data: {
          progression: progression || null,
          rewards: rewards || [],
          achievements: achievements || [],
          certificates: certs || [],
          rank: rank || null
        }
      })
    } catch (err) {
      res.status(500).json({ success: false, message: err.message || 'Failed to load reward center' })
    }
  })

  router.post('/rewards/daily-claim', requireArenaUser, async (req, res) => {
    try {
      const userId = req.arenaUserId
      const now = Date.now()
      const { data: p } = await supabase.from('arena_player_progression').select('*').eq('user_id', userId).maybeSingle()
      const row = p || {
        user_id: userId,
        level: 1,
        xp: 0,
        total_xp: 0,
        reward_points: 0,
        current_streak: 0,
        highest_streak: 0,
        win_streak: 0,
        tournament_streak: 0,
        season_rank: 'Unranked',
        daily_last_claimed_at: null,
        daily_streak_count: 0
      }

      const last = row.daily_last_claimed_at ? new Date(row.daily_last_claimed_at).getTime() : 0
      const diff = now - last
      const oneDay = 1000 * 60 * 60 * 24
      if (last && diff < oneDay) {
        return res.status(400).json({ success: false, message: 'Daily reward already claimed' })
      }

      let streak = Number(row.daily_streak_count || 0)
      if (!last || diff > oneDay * 2) streak = 1
      else streak += 1

      const dayIdx = ((streak - 1) % 7) + 1
      let xpGain = 15
      let creditGain = 20
      let badgeCode = null
      if (dayIdx === 1) xpGain = 25
      if (dayIdx === 2) creditGain = 40
      if (dayIdx === 3) xpGain = 40
      if (dayIdx === 7) {
        xpGain = 60
        creditGain = 80
        badgeCode = 'daily-7'
      }

      const totalXp = Number(row.total_xp || 0) + xpGain
      const level = Math.max(1, Math.floor(totalXp / 120) + 1)
      const xpInLevel = totalXp % 120
      const points = Number(row.reward_points || 0) + creditGain

      await supabase
        .from('arena_player_progression')
        .upsert([{
          user_id: userId,
          level,
          xp: xpInLevel,
          total_xp: totalXp,
          reward_points: points,
          current_streak: streak,
          highest_streak: Math.max(Number(row.highest_streak || 0), streak),
          daily_last_claimed_at: new Date(now).toISOString(),
          daily_streak_count: streak,
          updated_at: new Date(now).toISOString(),
          season_rank: row.season_rank || 'Unranked'
        }], { onConflict: 'user_id' })

      await supabase.from('arena_rewards').insert([{
        user_id: userId,
        source_type: 'daily',
        source_ref: `${new Date(now).toISOString().slice(0, 10)}`,
        xp_delta: xpGain,
        credit_delta: creditGain,
        badge_code: badgeCode,
        title: `Daily reward (Day ${dayIdx})`,
        claim_status: 'granted',
        metadata: { day: dayIdx, streak }
      }])

      res.json({ success: true, data: { xpGain, creditGain, streak, day: dayIdx, badgeCode, level } })
    } catch (err) {
      res.status(500).json({ success: false, message: err.message || 'Failed to claim daily reward' })
    }
  })

  return router
}

