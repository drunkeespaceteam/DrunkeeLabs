import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { io } from 'socket.io-client'
import Navbar from '../../components/Navbar'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import ArenaBackButton from '../../components/arena/ArenaBackButton'

export default function ArenaLobby() {
  const navigate = useNavigate()
  const toast = useToast()
  const { user, profile } = useAuth()
  const userId = profile?.id || user?.id

  const [teams, setTeams] = useState([])
  const [inviteCode, setInviteCode] = useState('')
  const [teamName, setTeamName] = useState('')
  const [selectedTeamId, setSelectedTeamId] = useState('')
  const [mode, setMode] = useState('frontend')
  const [durationMinutes, setDurationMinutes] = useState(15)
  const [queueType, setQueueType] = useState('casual')
  const [queued, setQueued] = useState(false)

  const socket = useMemo(() => {
    const s = io('/arena', { transports: ['websocket'] })
    return s
  }, [])

  const refreshTeams = async () => {
    if (!userId) return
    const res = await fetch('/api/arena/me/teams', { headers: { 'x-user-id': userId } })
    const json = await res.json()
    if (json?.success) {
      setTeams(json.data || [])
      const firstTeam = json.data?.[0]?.team_id
      if (!selectedTeamId && firstTeam) setSelectedTeamId(firstTeam)
    }
  }

  useEffect(() => {
    refreshTeams().catch(() => {})
    socket.on('arena_match_started', ({ matchId }) => {
      setQueued(false)
      navigate(`/arena/match/${matchId}`)
    })
    socket.on('arena_match_found', ({ matchId }) => {
      setQueued(false)
      navigate(`/arena/match/${matchId}`)
    })
    socket.on('arena_tournament_started', ({ matchId }) => {
      setQueued(false)
      navigate(`/arena/match/${matchId}`)
    })
    return () => {
      socket.off('arena_match_started')
      socket.off('arena_match_found')
      socket.off('arena_tournament_started')
      socket.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  useEffect(() => {
    if (selectedTeamId) socket.emit('arena_join_team', { teamId: selectedTeamId })
  }, [selectedTeamId, socket])

  const createTeam = async () => {
    if (!teamName.trim()) return toast.error('Enter a team name')
    const res = await fetch('/api/arena/teams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
      body: JSON.stringify({ name: teamName.trim() })
    })
    const json = await res.json()
    if (!json?.success) return toast.error(json.message || 'Failed to create team')
    toast.success('Team created')
    setTeamName('')
    await refreshTeams()
  }

  const joinTeam = async () => {
    const code = inviteCode.trim().toUpperCase()
    if (!code) return toast.error('Enter invite code')
    const res = await fetch('/api/arena/teams/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
      body: JSON.stringify({ inviteCode: code })
    })
    const json = await res.json()
    if (!json?.success) return toast.error(json.message || 'Failed to join')
    toast.success('Joined team')
    setInviteCode('')
    await refreshTeams()
  }

  const queue = async () => {
    if (!selectedTeamId) return toast.error('Select a team')
    setQueued(true)
    const res = await fetch('/api/arena/queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
      body: JSON.stringify({ teamId: selectedTeamId, mode, durationMinutes, queueType })
    })
    const json = await res.json()
    if (!json?.success) {
      setQueued(false)
      return toast.error(json.message || 'Queue failed')
    }
    if (json?.data?.matchId) {
      navigate(`/arena/match/${json.data.matchId}`)
    } else {
      toast.success('Queued. Waiting for opponent…')
    }
  }

  return (
    <div className="min-h-screen bg-[#04070f] text-slate-200">
      <Navbar />
      <main className="max-w-6xl mx-auto px-6 py-8 grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <ArenaBackButton to="/arena" />
          <div className="rounded-2xl bg-slate-900/70 border border-white/10 p-5">
            <h1 className="text-xl font-black">Arena Lobby</h1>
            <p className="text-sm text-slate-400 mt-1">Create/join a team, then queue for a match.</p>
            <div className="mt-3">
              <button
                onClick={() => navigate('/arena/teams')}
                className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 text-sm font-bold"
              >
                Open Team Marketplace
              </button>
            </div>
          </div>

          <div className="rounded-2xl bg-slate-900/70 border border-white/10 p-5 space-y-4">
            <h2 className="font-bold">Your Teams</h2>
            <div className="space-y-2">
              {(teams || []).map((m) => (
                <button
                  key={m.team_id}
                  onClick={() => setSelectedTeamId(m.team_id)}
                  className={`w-full text-left px-4 py-3 rounded-xl border ${
                    selectedTeamId === m.team_id ? 'border-sky-400/50 bg-sky-500/10' : 'border-white/10 bg-white/5 hover:bg-white/10'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="font-bold">{m.arena_teams?.name || 'Team'}</div>
                    <div className="text-xs text-slate-400">{m.role}</div>
                  </div>
                  <div className="text-xs text-slate-400 mt-1">Invite: <span className="font-mono">{m.arena_teams?.invite_code || '—'}</span></div>
                  <div className="mt-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        const slug = m.arena_teams?.team_slug
                        if (slug) navigate(`/arena/team/${slug}`)
                      }}
                      className="text-xs px-2 py-1 rounded-lg bg-white/10 border border-white/10 hover:bg-white/15"
                    >
                      View Profile
                    </button>
                  </div>
                </button>
              ))}
              {(!teams || teams.length === 0) && (
                <div className="text-sm text-slate-500">No teams yet.</div>
              )}
            </div>
          </div>
        </div>

        <aside className="space-y-6">
          <div className="rounded-2xl bg-slate-900/70 border border-white/10 p-5 space-y-3">
            <h3 className="font-bold">Create Team</h3>
            <input value={teamName} onChange={(e) => setTeamName(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10" placeholder="Team name" />
            <button onClick={createTeam} className="w-full px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold">Create</button>
          </div>

          <div className="rounded-2xl bg-slate-900/70 border border-white/10 p-5 space-y-3">
            <h3 className="font-bold">Join Team</h3>
            <input value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 font-mono" placeholder="INVITE CODE" />
            <button onClick={joinTeam} className="w-full px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-bold">Join</button>
          </div>

          <div className="rounded-2xl bg-slate-900/70 border border-white/10 p-5 space-y-4">
            <h3 className="font-bold">Queue Match</h3>
            <div className="space-y-2">
              <label className="text-xs text-slate-400 font-bold uppercase">Mode</label>
              <select value={mode} onChange={(e) => setMode(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10">
                <option value="frontend">Frontend challenge</option>
                <option value="bugfix">Bug fixing challenge</option>
                <option value="fullstack">Simple fullstack challenge</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs text-slate-400 font-bold uppercase">Duration</label>
              <select value={durationMinutes} onChange={(e) => setDurationMinutes(Number(e.target.value))} className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10">
                <option value={15}>15 min</option>
                <option value={30}>30 min</option>
                <option value={60}>60 min</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-slate-400 font-bold uppercase">Queue</label>
              <select value={queueType} onChange={(e) => setQueueType(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10">
                <option value="casual">Casual Queue</option>
                <option value="ranked">Ranked Queue</option>
              </select>
            </div>
            <button
              disabled={queued}
              onClick={queue}
              className="w-full px-4 py-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-black disabled:opacity-50"
            >
              {queued ? 'Queued…' : 'Queue Now'}
            </button>
          </div>
        </aside>
      </main>
    </div>
  )
}

