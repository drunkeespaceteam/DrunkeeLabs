import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import Navbar from '../../components/Navbar'
import ArenaBackButton from '../../components/arena/ArenaBackButton'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'

export default function ArenaInviteJoin() {
  const navigate = useNavigate()
  const toast = useToast()
  const { teamSlug } = useParams()
  const [search] = useSearchParams()
  const inviteToken = useMemo(() => search.get('invite') || '', [search])
  const { user, profile } = useAuth()
  const userId = profile?.id || user?.id
  const [team, setTeam] = useState(null)
  const [joining, setJoining] = useState(false)

  useEffect(() => {
    if (!teamSlug || !userId) return
    fetch(`/api/arena/teams/slug/${teamSlug}`, { headers: { 'x-user-id': userId } })
      .then((r) => r.json())
      .then((j) => {
        if (j?.success) setTeam(j.data?.team || null)
      })
      .catch(() => {})
  }, [teamSlug, userId])

  const join = async () => {
    if (!userId) return
    if (!inviteToken) return toast.error('Invite token missing')
    setJoining(true)
    try {
      const res = await fetch(`/api/arena/join/${teamSlug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
        body: JSON.stringify({ invite: inviteToken })
      })
      const j = await res.json()
      if (!j?.success) throw new Error(j?.message || 'Join failed')
      toast.success('Joined team')
      navigate(`/arena/team/${j.data.teamSlug}`)
    } catch (e) {
      toast.error(e.message)
    } finally {
      setJoining(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#04070f] text-slate-200">
      <Navbar />
      <main className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        <ArenaBackButton to="/arena/teams" />
        <div className="rounded-3xl bg-slate-900/70 border border-white/10 p-6">
          <div className="text-xs uppercase tracking-wider text-slate-400 font-bold">Team Invite</div>
          <h1 className="text-2xl font-black mt-2">{team?.name || teamSlug}</h1>
          <p className="text-sm text-slate-400 mt-1">Invite token: <span className="font-mono text-slate-200">{inviteToken || 'missing'}</span></p>
          <button
            disabled={joining}
            onClick={join}
            className="mt-5 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 font-bold"
          >
            {joining ? 'Joining…' : 'Join Match Team'}
          </button>
        </div>
      </main>
    </div>
  )
}

