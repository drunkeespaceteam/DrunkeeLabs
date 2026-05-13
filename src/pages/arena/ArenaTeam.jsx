import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Navbar from '../../components/Navbar'
import { useAuth } from '../../context/AuthContext'
import ArenaBackButton from '../../components/arena/ArenaBackButton'
import { useToast } from '../../components/Toast'

export default function ArenaTeam() {
  const navigate = useNavigate()
  const toast = useToast()
  const { teamSlug } = useParams()
  const { user, profile } = useAuth()
  const userId = profile?.id || user?.id

  const [team, setTeam] = useState(null)
  const [members, setMembers] = useState([])
  const [leaderboard, setLeaderboard] = useState(null)
  const [applications, setApplications] = useState([])
  const [intro, setIntro] = useState('')
  const [desiredRole, setDesiredRole] = useState('Fullstack')
  const [inviteLink, setInviteLink] = useState('')

  const isCaptain = !!team && (String(team.owner_id) === String(userId) || String(team.captain_user_id) === String(userId))

  const loadTeam = async () => {
    if (!teamSlug) return
    const r = await fetch(`/api/arena/teams/slug/${teamSlug}`, { headers: { 'x-user-id': userId } })
    const j = await r.json()
    if (!j?.success) throw new Error(j?.message || 'Failed to load team')
    setTeam(j.data?.team || null)
    setMembers(j.data?.members || [])
    setLeaderboard(j.data?.leaderboard || null)
  }

  useEffect(() => {
    if (!userId) return
    loadTeam().catch((e) => toast.error(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamSlug, toast, userId])

  useEffect(() => {
    if (!isCaptain || !team?.id) return
    fetch(`/api/arena/teams/${team.id}/applications`, { headers: { 'x-user-id': userId } })
      .then((r) => r.json())
      .then((j) => {
        if (j?.success) setApplications(j.data || [])
      })
      .catch(() => {})
  }, [isCaptain, team?.id, userId])

  const leaveTeam = async () => {
    if (!userId || !team?.id) return
    const res = await fetch(`/api/arena/teams/${team.id}/leave`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
      body: JSON.stringify({})
    })
    const j = await res.json()
    if (!j?.success) return toast.error(j?.message || 'Failed to leave')
    toast.success('Left team')
    navigate('/arena/lobby')
  }

  const applyToTeam = async () => {
    if (!team?.id) return
    const res = await fetch(`/api/arena/teams/${team.id}/applications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
      body: JSON.stringify({ desiredRole, introduction: intro })
    })
    const j = await res.json()
    if (!j?.success) return toast.error(j?.message || 'Failed to apply')
    toast.success('Application submitted')
    setIntro('')
  }

  const reviewApplication = async (applicationId, action) => {
    if (!team?.id) return
    const res = await fetch(`/api/arena/teams/${team.id}/applications/${applicationId}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
      body: JSON.stringify({ action })
    })
    const j = await res.json()
    if (!j?.success) return toast.error(j?.message || 'Failed')
    toast.success(`Application ${action}ed`)
    const next = applications.filter((a) => a.id !== applicationId)
    setApplications(next)
    loadTeam().catch(() => {})
  }

  const makeInviteLink = async () => {
    if (!team?.id) return
    const res = await fetch(`/api/arena/teams/${team.id}/invite-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
      body: JSON.stringify({})
    })
    const j = await res.json()
    if (!j?.success) return toast.error(j?.message || 'Failed to create invite')
    const full = `${window.location.origin}${j.data.invitePath}`
    setInviteLink(full)
    navigator.clipboard?.writeText(full).catch(() => {})
    toast.success('Invite link created')
  }

  return (
    <div className="min-h-screen bg-[#04070f] text-slate-200">
      <Navbar />
      <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        <ArenaBackButton to="/arena/teams" />

        <div className="rounded-3xl bg-slate-900/70 border border-white/10 p-6">
          <h1 className="text-2xl font-black">{team?.name || 'Team'}</h1>
          <p className="text-sm text-slate-400 mt-1">Slug: <span className="font-mono text-slate-200">{team?.team_slug || '—'}</span></p>
          <p className="text-sm text-slate-400 mt-1">Recruitment: <span className="text-slate-200 font-bold">{team?.recruitment_status || '—'}</span></p>
          {leaderboard && (
            <p className="text-sm text-slate-300 mt-2">
              Record: <span className="font-bold">{leaderboard.wins}W / {leaderboard.losses}L</span> • MVP {leaderboard.mvp_count || 0}
            </p>
          )}

          <div className="mt-6 grid md:grid-cols-3 gap-4">
            <div className="rounded-2xl bg-white/5 border border-white/10 p-4">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Members</div>
              <div className="space-y-2">
                {members.map((m) => (
                  <div key={m.user_id} className="flex items-center justify-between border border-white/5 rounded-xl px-3 py-2 bg-white/5">
                    <div>
                      <div className="font-bold text-sm">{m.users?.name || m.user_id}</div>
                      <div className="text-xs text-slate-400">{m.role}</div>
                    </div>
                    <div className="text-xs text-slate-300">{m.users?.email || ''}</div>
                  </div>
                ))}
                {members.length === 0 && <div className="text-sm text-slate-500">No members</div>}
              </div>
            </div>

            <div className="rounded-2xl bg-white/5 border border-white/10 p-4 flex flex-col justify-between">
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Actions</div>
                {!isCaptain && (
                  <div className="space-y-2 mb-4">
                    <select value={desiredRole} onChange={(e) => setDesiredRole(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm">
                      <option>Frontend</option>
                      <option>Backend</option>
                      <option>Fullstack</option>
                      <option>DevOps</option>
                      <option>UI/UX</option>
                      <option>AI Engineer</option>
                    </select>
                    <textarea value={intro} onChange={(e) => setIntro(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm min-h-[90px]" placeholder="Short introduction…" />
                    <button className="w-full px-3 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 font-bold" onClick={applyToTeam}>Apply to team</button>
                  </div>
                )}
                {isCaptain && (
                  <div className="space-y-2 mb-4">
                    <button className="w-full px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-bold" onClick={makeInviteLink}>Generate Invite Link</button>
                    {inviteLink && <div className="text-xs break-all text-slate-300 bg-black/20 border border-white/10 rounded-xl p-2">{inviteLink}</div>}
                  </div>
                )}
              </div>
              <button
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold"
                onClick={leaveTeam}
              >
                Leave team
              </button>
            </div>

            <div className="rounded-2xl bg-white/5 border border-white/10 p-4">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Captain Inbox</div>
              {!isCaptain && <div className="text-sm text-slate-500">Only captains can review applications.</div>}
              {isCaptain && (
                <div className="space-y-2">
                  {applications.map((a) => (
                    <div key={a.id} className="border border-white/10 rounded-xl p-3 bg-white/5">
                      <div className="text-sm font-bold">{a.users?.name || a.applicant_user_id}</div>
                      <div className="text-xs text-slate-400">{a.desired_role || 'Role not set'}</div>
                      <div className="text-xs text-slate-300 mt-2">{a.introduction || 'No intro'}</div>
                      <div className="flex gap-2 mt-3">
                        <button onClick={() => reviewApplication(a.id, 'accept')} className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-bold">Accept</button>
                        <button onClick={() => reviewApplication(a.id, 'reject')} className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-xs font-bold">Reject</button>
                      </div>
                    </div>
                  ))}
                  {applications.length === 0 && <div className="text-sm text-slate-500">No pending applications.</div>}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

