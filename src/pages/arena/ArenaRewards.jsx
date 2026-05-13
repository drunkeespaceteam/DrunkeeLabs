import { useEffect, useMemo, useState } from 'react'
import Navbar from '../../components/Navbar'
import ArenaBackButton from '../../components/arena/ArenaBackButton'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'

export default function ArenaRewards() {
  const { user, profile } = useAuth()
  const toast = useToast()
  const userId = profile?.id || user?.id
  const [data, setData] = useState({ progression: null, rewards: [], achievements: [], certificates: [], rank: null })
  const [claimingDaily, setClaimingDaily] = useState(false)

  const pct = useMemo(() => {
    const xp = Number(data.progression?.xp || 0)
    const required = 120 + Math.floor((Math.max(1, Number(data.progression?.level || 1)) - 1) * 6)
    return Math.min(100, Math.round((xp / required) * 100))
  }, [data.progression?.xp, data.progression?.level])

  const load = async () => {
    if (!userId) return
    const r = await fetch('/api/arena/rewards/me', { headers: { 'x-user-id': userId } })
    const j = await r.json()
    if (!j?.success) throw new Error(j?.message || 'Failed to load reward center')
    setData(j.data)
  }

  useEffect(() => {
    load().catch((e) => toast.error(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  const claimDaily = async () => {
    setClaimingDaily(true)
    try {
      const r = await fetch('/api/arena/rewards/daily-claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
        body: JSON.stringify({})
      })
      const j = await r.json()
      if (!j?.success) throw new Error(j?.message || 'Daily claim failed')
      toast.success(`Daily claimed +${j.data.xpGain} XP, +${j.data.creditGain} credits`)
      await load()
    } catch (e) {
      toast.error(e.message)
    } finally {
      setClaimingDaily(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#04070f] text-slate-200">
      <Navbar />
      <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        <ArenaBackButton to="/arena" />

        <div className="rounded-3xl bg-slate-900/70 border border-white/10 p-5">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-wider text-slate-400 font-bold">Reward Center</div>
              <h1 className="text-2xl font-black mt-1">Arena Progression</h1>
              <p className="text-sm text-slate-400 mt-1">XP, credits, achievements, badges, certificates, streaks.</p>
            </div>
            <button
              disabled={claimingDaily}
              onClick={claimDaily}
              className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 font-bold"
            >
              {claimingDaily ? 'Claiming…' : 'Claim Daily Reward'}
            </button>
          </div>
        </div>

        <div className="grid md:grid-cols-4 gap-4">
          <div className="rounded-2xl bg-white/5 border border-white/10 p-4">
            <div className="text-xs text-slate-400 uppercase tracking-wider font-bold">Level</div>
            <div className="text-3xl font-black mt-1">{data.progression?.level || 1}</div>
          </div>
          <div className="rounded-2xl bg-white/5 border border-white/10 p-4">
            <div className="text-xs text-slate-400 uppercase tracking-wider font-bold">Total XP</div>
            <div className="text-3xl font-black mt-1">{data.progression?.total_xp || 0}</div>
          </div>
          <div className="rounded-2xl bg-white/5 border border-white/10 p-4">
            <div className="text-xs text-slate-400 uppercase tracking-wider font-bold">Reward Credits</div>
            <div className="text-3xl font-black mt-1">{data.progression?.reward_points || 0}</div>
          </div>
          <div className="rounded-2xl bg-white/5 border border-white/10 p-4">
            <div className="text-xs text-slate-400 uppercase tracking-wider font-bold">Streak</div>
            <div className="text-3xl font-black mt-1">{data.progression?.daily_streak_count || 0}</div>
          </div>
        </div>

        <div className="rounded-2xl bg-white/5 border border-white/10 p-4">
          <div className="flex items-center justify-between text-sm">
            <span>XP to next level</span>
            <span>{pct}%</span>
          </div>
          <div className="mt-2 h-3 rounded-full bg-white/10 overflow-hidden">
            <div className="h-full bg-gradient-to-r from-sky-500 to-violet-500 transition-all duration-500" style={{ width: `${pct}%` }} />
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div className="rounded-2xl bg-slate-900/70 border border-white/10 p-4">
            <h2 className="font-bold mb-3">Recent Rewards</h2>
            <div className="space-y-2">
              {(data.rewards || []).slice(0, 12).map((r) => (
                <div key={r.id} className="rounded-xl bg-white/5 border border-white/10 p-3 text-sm">
                  <div className="font-semibold">{r.title || r.source_type}</div>
                  <div className="text-xs text-slate-400 mt-1">+{r.xp_delta} XP • +{r.credit_delta} credits</div>
                </div>
              ))}
              {(!data.rewards || data.rewards.length === 0) && <div className="text-sm text-slate-500">No rewards yet.</div>}
            </div>
          </div>

          <div className="rounded-2xl bg-slate-900/70 border border-white/10 p-4">
            <h2 className="font-bold mb-3">Achievements & Badges</h2>
            <div className="space-y-2">
              {(data.achievements || []).slice(0, 12).map((a) => (
                <div key={a.id} className="rounded-xl bg-white/5 border border-white/10 p-3 text-sm">
                  <div className="font-semibold">{a.arena_achievements?.title || 'Achievement'}</div>
                  <div className="text-xs text-slate-400 mt-1">{a.arena_achievements?.description || ''}</div>
                  {a.arena_achievements?.badge_code && (
                    <div className="mt-2 text-[11px] inline-block px-2 py-1 rounded-lg bg-violet-500/15 border border-violet-500/30 text-violet-200">
                      Badge: {a.arena_achievements.badge_code}
                    </div>
                  )}
                </div>
              ))}
              {(!data.achievements || data.achievements.length === 0) && <div className="text-sm text-slate-500">No achievements unlocked yet.</div>}
            </div>
          </div>
        </div>

        <div className="rounded-2xl bg-slate-900/70 border border-white/10 p-4">
          <h2 className="font-bold mb-3">Certificates</h2>
          <div className="space-y-2">
            {(data.certificates || []).slice(0, 10).map((c) => (
              <div key={c.id} className="rounded-xl bg-white/5 border border-white/10 p-3 text-sm flex items-center justify-between gap-3">
                <div>
                  <div className="font-semibold">{c.certificate_title}</div>
                  <div className="text-xs text-slate-400 mt-1">{new Date(c.issued_at).toLocaleString()}</div>
                </div>
                {c.certificate_url ? (
                  <a className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-xs font-bold" href={c.certificate_url} target="_blank" rel="noreferrer">Download</a>
                ) : (
                  <span className="text-xs text-slate-500">Pending</span>
                )}
              </div>
            ))}
            {(!data.certificates || data.certificates.length === 0) && <div className="text-sm text-slate-500">No certificates yet.</div>}
          </div>
        </div>
      </main>
    </div>
  )
}

