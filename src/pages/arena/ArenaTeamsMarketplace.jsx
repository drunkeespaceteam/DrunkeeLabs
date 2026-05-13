import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Navbar from '../../components/Navbar'
import ArenaBackButton from '../../components/arena/ArenaBackButton'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'

export default function ArenaTeamsMarketplace() {
  const navigate = useNavigate()
  const toast = useToast()
  const { user, profile } = useAuth()
  const userId = profile?.id || user?.id
  const [query, setQuery] = useState('')
  const [teams, setTeams] = useState([])

  const loadTeams = async (q = '') => {
    const u = new URL('/api/arena/teams/marketplace', window.location.origin)
    if (q.trim()) u.searchParams.set('q', q.trim())
    const res = await fetch(`${u.pathname}${u.search}`, { headers: { 'x-user-id': userId } })
    const j = await res.json()
    if (!j?.success) throw new Error(j?.message || 'Failed to load teams')
    setTeams(j.data || [])
  }

  useEffect(() => {
    if (!userId) return
    loadTeams().catch((e) => toast.error(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  return (
    <div className="min-h-screen bg-[#04070f] text-slate-200">
      <Navbar />
      <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        <ArenaBackButton to="/arena" />
        <div className="rounded-3xl bg-slate-900/70 border border-white/10 p-5">
          <div className="flex flex-col md:flex-row md:items-center gap-3 justify-between">
            <div>
              <div className="text-xs uppercase tracking-widest text-slate-400 font-bold">Arena Teams</div>
              <h1 className="text-2xl font-black mt-1">Public Team Marketplace</h1>
            </div>
            <div className="flex gap-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search teams..."
                className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm min-w-[220px]"
              />
              <button onClick={() => loadTeams(query).catch((e) => toast.error(e.message))} className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 font-bold text-sm">Search</button>
            </div>
          </div>
        </div>

        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {teams.map((t) => (
            <div key={t.id} className="rounded-2xl border border-white/10 bg-slate-900/70 p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center overflow-hidden">
                    {t.avatar_url ? <img src={t.avatar_url} alt={t.name} className="w-full h-full object-cover" /> : <span className="text-sm font-black">⚔️</span>}
                  </div>
                  <div>
                    <div className="font-black text-slate-100">{t.name}</div>
                    <div className="text-xs text-slate-400">/{t.team_slug}</div>
                  </div>
                </div>
                <div className="text-[11px] px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-slate-300">{t.recruitment_status}</div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-white/5 border border-white/10 p-2">Rank: #{Math.max(1, 1000 - Number(t.leaderboard?.total_score || 0))}</div>
                <div className="rounded-lg bg-white/5 border border-white/10 p-2">{t.leaderboard?.wins || 0}W/{t.leaderboard?.losses || 0}L</div>
                <div className="rounded-lg bg-white/5 border border-white/10 p-2">Members: {t.active_members || 0}</div>
                <div className="rounded-lg bg-white/5 border border-white/10 p-2">Tournaments: {t.tournament_history_count || 0}</div>
              </div>

              <div className="text-xs text-slate-400">
                Captain: <span className="text-slate-200 font-semibold">{t.captain_name || 'Captain'}</span>
              </div>

              <div className="flex gap-2">
                <button onClick={() => navigate(`/arena/team/${t.team_slug}`)} className="flex-1 px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 text-sm font-bold">
                  View Team
                </button>
                <button onClick={() => navigate(`/arena/team/${t.team_slug}`)} className="flex-1 px-3 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-sm font-bold">
                  Apply
                </button>
              </div>
            </div>
          ))}
          {teams.length === 0 && (
            <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4 text-sm text-slate-500">
              No teams found.
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

