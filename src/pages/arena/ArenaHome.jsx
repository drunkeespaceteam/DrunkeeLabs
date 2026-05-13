import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Navbar from '../../components/Navbar'
import { useAuth } from '../../context/AuthContext'
import ArenaBackButton from '../../components/arena/ArenaBackButton'

export default function ArenaHome() {
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const userId = profile?.id || user?.id
  const [leaderboard, setLeaderboard] = useState({ teams: [], players: [] })
  const [tournaments, setTournaments] = useState([])
  const [allTournaments, setAllTournaments] = useState([])
  const [myTeams, setMyTeams] = useState([])
  const [selectedTournamentId, setSelectedTournamentId] = useState('')
  const [bracketData, setBracketData] = useState({ tournament: null, brackets: [] })

  useEffect(() => {
    fetch('/api/arena/leaderboard')
      .then((r) => r.json())
      .then((j) => {
        if (j?.success) setLeaderboard(j.data)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!userId) return
    fetch('/api/arena/tournaments/recruiting', { headers: { 'x-user-id': userId } })
      .then((r) => r.json())
      .then((j) => { if (j?.success) setTournaments(j.data || []) })
      .catch(() => {})

    fetch('/api/arena/tournaments/list', { headers: { 'x-user-id': userId } })
      .then((r) => r.json())
      .then((j) => { if (j?.success) setAllTournaments(j.data || []) })
      .catch(() => {})

    fetch('/api/arena/me/teams', { headers: { 'x-user-id': userId } })
      .then((r) => r.json())
      .then((j) => { if (j?.success) setMyTeams(j.data || []) })
      .catch(() => {})
  }, [userId])

  useEffect(() => {
    if (!userId || !selectedTournamentId) {
      setBracketData({ tournament: null, brackets: [] })
      return
    }
    fetch(`/api/arena/tournaments/${selectedTournamentId}/bracket`, { headers: { 'x-user-id': userId } })
      .then((r) => r.json())
      .then((j) => {
        if (j?.success) setBracketData(j.data || { tournament: null, brackets: [] })
      })
      .catch(() => {})
  }, [selectedTournamentId, userId])

  return (
    <div className="min-h-screen bg-[#04070f] text-slate-200">
      <Navbar />
      <main className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        <ArenaBackButton to="/dashboard" />
        <div className="rounded-3xl bg-gradient-to-r from-sky-500/15 via-violet-500/10 to-rose-500/15 border border-white/10 p-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-wider text-slate-400 font-bold">Realtime Competitive Coding Arena</div>
              <h1 className="text-2xl md:text-3xl font-black mt-2">Arena Mode</h1>
              <p className="text-sm text-slate-300/80 mt-2 max-w-2xl">
                Team up, queue into a match, collaborate in a shared editor, race the timer, and submit your solution.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => navigate('/arena/lobby')}
                className="px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-bold"
              >
                Enter Lobby
              </button>
              <button
                onClick={() => navigate('/arena/teams')}
                className="px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-bold"
              >
                Team Marketplace
              </button>
              <button
                onClick={() => navigate('/arena/rewards')}
                className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold"
              >
                Rewards
              </button>
              <button
                onClick={() => userId ? navigate('/arena/lobby') : navigate('/login')}
                className="px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 text-slate-100 font-bold"
              >
                Quick Queue
              </button>
            </div>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div className="rounded-2xl bg-slate-900/70 border border-white/10 p-5">
            <h2 className="font-bold mb-3">Top Teams</h2>
            <div className="space-y-2">
              {(leaderboard.teams || []).slice(0, 10).map((t, idx) => (
                <div key={t.subject_id} className="flex items-center justify-between text-sm border border-white/5 rounded-xl px-3 py-2 bg-white/5">
                  <div className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-lg bg-white/10 flex items-center justify-center font-black">{idx + 1}</div>
                    <div className="text-slate-200">Team {String(t.subject_id).slice(0, 8)}</div>
                  </div>
                  <div className="text-slate-300">{t.wins}W / {t.losses}L</div>
                </div>
              ))}
              {(!leaderboard.teams || leaderboard.teams.length === 0) && (
                <div className="text-sm text-slate-500">No team leaderboard data yet.</div>
              )}
            </div>
          </div>

          <div className="rounded-2xl bg-slate-900/70 border border-white/10 p-5">
            <h2 className="font-bold mb-3">Top Players</h2>
            <div className="space-y-2">
              {(leaderboard.players || []).slice(0, 10).map((p, idx) => (
                <div key={p.subject_id} className="flex items-center justify-between text-sm border border-white/5 rounded-xl px-3 py-2 bg-white/5">
                  <div className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-lg bg-white/10 flex items-center justify-center font-black">{idx + 1}</div>
                    <div className="text-slate-200">Player {String(p.subject_id).slice(0, 8)}</div>
                  </div>
                  <div className="text-slate-300">{p.wins}W / {p.losses}L</div>
                </div>
              ))}
              {(!leaderboard.players || leaderboard.players.length === 0) && (
                <div className="text-sm text-slate-500">No player leaderboard data yet.</div>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-3xl bg-slate-900/60 border border-white/10 p-5">
          <div className="flex items-center justify-between gap-4 mb-4">
            <h2 className="font-bold text-lg">Tournaments</h2>
            <button
              onClick={() => (userId ? navigate('/arena/lobby') : navigate('/login'))}
              className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 text-slate-100 font-bold"
            >
              Create/Join Team
            </button>
          </div>

          {tournaments.length === 0 ? (
            <div className="text-sm text-slate-500">No recruiting tournaments right now.</div>
          ) : (
            <div className="space-y-3">
              {tournaments.slice(0, 5).map((t) => (
                <div key={t.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-xs uppercase tracking-wider text-slate-400 font-bold">Tournament</div>
                      <div className="font-black text-slate-200">{t.name}</div>
                      <div className="text-xs text-slate-400 mt-1">
                        Mode: {t.mode} • {t.duration_minutes} min • {t.queue_type}
                      </div>
                    </div>
                    {String(t.owner_id) === String(userId) ? (
                      <span className="text-xs px-2 py-1 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-200 font-bold">
                        Owner
                      </span>
                    ) : (
                      <span className="text-xs px-2 py-1 rounded-xl bg-sky-500/15 border border-sky-500/30 text-sky-200 font-bold">
                        Recruiting
                      </span>
                    )}
                  </div>

                  {userId && myTeams.length > 0 && (
                    <div className="flex gap-2 flex-wrap mt-4">
                      {String(t.owner_id) === String(userId) ? (
                        <button
                          onClick={async () => {
                            await fetch(`/api/arena/tournaments/${t.id}/start`, {
                              method: 'POST',
                              headers: { 'x-user-id': userId, 'Content-Type': 'application/json' },
                              body: JSON.stringify({})
                            })
                              .then((r) => r.json())
                              .then((j) => {
                                if (!j?.success) throw new Error(j?.message || 'Failed to start')
                                navigate('/arena/lobby')
                              })
                              .catch(() => {})
                          }}
                          className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold"
                        >
                          Start
                        </button>
                      ) : (
                        <button
                          onClick={async () => {
                            const teamId = myTeams[0]?.team_id || myTeams[0]?.id
                            if (!teamId) return
                            await fetch(`/api/arena/tournaments/${t.id}/register`, {
                              method: 'POST',
                              headers: { 'x-user-id': userId, 'Content-Type': 'application/json' },
                              body: JSON.stringify({ teamId })
                            })
                              .then((r) => r.json())
                              .then((j) => {
                                if (!j?.success) throw new Error(j?.message || 'Failed to register')
                                navigate('/arena/lobby')
                              })
                              .catch(() => {})
                          }}
                          className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-bold"
                        >
                          Register
                        </button>
                      )}
                    </div>
                  )}

                  {userId && myTeams.length === 0 && (
                    <div className="text-sm text-slate-500 mt-4">Create a team to register.</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-3xl bg-slate-900/60 border border-white/10 p-5">
          <div className="flex items-center justify-between gap-4 mb-4">
            <h2 className="font-bold text-lg">Tournament Bracket</h2>
            <select
              value={selectedTournamentId}
              onChange={(e) => setSelectedTournamentId(e.target.value)}
              className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm"
            >
              <option value="">Select tournament…</option>
              {tournaments.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
              {allTournaments
                .filter((x) => !tournaments.some((t) => t.id === x.id))
                .map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
            </select>
          </div>

          {!selectedTournamentId && (
            <div className="text-sm text-slate-500">Select a tournament to view the bracket.</div>
          )}

          {selectedTournamentId && (
            <div className="overflow-x-auto">
              <div className="flex gap-4 min-w-max">
                {Object.entries(
                  (bracketData.brackets || []).reduce((acc, b) => {
                    const key = String(b.round_number || 1)
                    if (!acc[key]) acc[key] = []
                    acc[key].push(b)
                    return acc
                  }, {})
                )
                  .sort((a, b) => Number(a[0]) - Number(b[0]))
                  .map(([round, matches]) => (
                    <div key={round} className="w-72 shrink-0">
                      <div className="text-xs uppercase tracking-wider text-slate-400 font-bold mb-2">Round {round}</div>
                      <div className="space-y-3">
                        {matches.map((m) => (
                          <div key={m.id} className="rounded-2xl border border-white/10 bg-white/5 p-3">
                            <div className="text-xs text-slate-400 mb-2">Match {Number(m.match_index) + 1}</div>
                            <div className={`rounded-lg px-2 py-1 text-sm ${m.winner_team_id === m.team1_id ? 'bg-emerald-500/15 text-emerald-200 border border-emerald-500/25' : 'bg-white/5 text-slate-200 border border-white/10'}`}>
                              {m.arena_teams?.name || (m.team1_id ? `Team ${String(m.team1_id).slice(0, 6)}` : 'TBD')}
                            </div>
                            <div className="text-center text-xs text-slate-500 py-1">vs</div>
                            <div className={`rounded-lg px-2 py-1 text-sm ${m.winner_team_id === m.team2_id ? 'bg-emerald-500/15 text-emerald-200 border border-emerald-500/25' : 'bg-white/5 text-slate-200 border border-white/10'}`}>
                              {m.arena_teams2?.name || (m.team2_id ? `Team ${String(m.team2_id).slice(0, 6)}` : 'TBD')}
                            </div>
                            <div className="mt-2 text-[11px] text-slate-400">Status: {m.status}</div>
                          </div>
                        ))}
                        {matches.length === 0 && <div className="text-sm text-slate-500">No matches</div>}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

