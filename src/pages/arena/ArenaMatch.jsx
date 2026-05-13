import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { io } from 'socket.io-client'
import MonacoEditor from '@monaco-editor/react'
import Navbar from '../../components/Navbar'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import ArenaBackButton from '../../components/arena/ArenaBackButton'
import VoiceChat from '../../components/arena/VoiceChat'

function formatTime(sec) {
  const s = Math.max(0, Number(sec) || 0)
  const mm = String(Math.floor(s / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

export default function ArenaMatch() {
  const { matchId } = useParams()
  const toast = useToast()
  const { user, profile } = useAuth()
  const userId = profile?.id || user?.id

  const [match, setMatch] = useState(null)
  const [teams, setTeams] = useState([])
  const [teamId, setTeamId] = useState('')
  const [content, setContent] = useState('')
  const [locked, setLocked] = useState(false)
  const [remainingSec, setRemainingSec] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [connected, setConnected] = useState([])
  const [cursors, setCursors] = useState({})
  const [typingNow, setTypingNow] = useState({})
  const [rankTier, setRankTier] = useState(null)
  const [prematch, setPrematch] = useState(null)
  const [joiningMatchDay, setJoiningMatchDay] = useState(false)
  const [rewardSummary, setRewardSummary] = useState(null)

  const lastSentRef = useRef(0)
  const lastCursorSentRef = useRef(0)
  const socket = useMemo(() => io('/arena', { transports: ['websocket'] }), [])

  useEffect(() => {
    if (!userId) return
    fetch(`/api/arena/matches/${matchId}`, { headers: { 'x-user-id': userId } })
      .then((r) => r.json())
      .then((j) => {
        if (!j?.success) throw new Error(j?.message || 'Failed')
        setMatch(j.data.match)
        setTeams(j.data.teams || [])
      })
      .catch((e) => toast.error(e.message))
  }, [matchId, toast, userId])

  useEffect(() => {
    if (!userId || !matchId) return
    const loadPrematch = () => {
      fetch(`/api/arena/matches/${matchId}/prematch`, { headers: { 'x-user-id': userId } })
        .then((r) => r.json())
        .then((j) => {
          if (j?.success) setPrematch(j.data || null)
        })
        .catch(() => {})
    }
    loadPrematch()
    const t = setInterval(loadPrematch, 5000)
    return () => clearInterval(t)
  }, [matchId, userId])

  useEffect(() => {
    if (!userId) return
    if (!match?.metadata?.queueType || match.metadata.queueType !== 'ranked') {
      setRankTier(null)
      return
    }
    fetch('/api/arena/ranks/me', { headers: { 'x-user-id': userId } })
      .then((r) => r.json())
      .then((j) => {
        if (j?.success && j.data?.rank_tier) setRankTier(j.data.rank_tier)
      })
      .catch(() => {})
  }, [match?.metadata?.queueType, toast, userId, match?.id])

  useEffect(() => {
    socket.emit('arena_join_match', { matchId })
    socket.emit('arena_presence', { matchId, user: { id: userId, name: profile?.name || user?.user_metadata?.name || 'User' } })

    const editorStateHandler = ({ content: c }) => setContent(c || '')
    const editorUpdateHandler = ({ content: c, user }) => {
      if (c != null) setContent(c)
      const uid = user?.id
      if (uid) {
        setTypingNow((prev) => ({ ...prev, [uid]: Date.now() }))
      }
    }
    const timerUpdateHandler = ({ remainingSec: s }) => setRemainingSec(s)
    const matchFinishedHandler = ({ status }) => {
      setLocked(true)
      toast.warning(status === 'expired' ? 'Match expired. Editor locked.' : 'Match finished. Editor locked.')
    }
    const xpGainedHandler = ({ rewards }) => {
      const my = rewards?.[userId]
      if (my) setRewardSummary(my)
    }
    const presenceHandler = ({ user }) => {
      if (!user?.id) return
      setConnected((prev) => {
        const exists = prev.some((x) => x.id === user.id)
        if (exists) return prev
        return [...prev, user]
      })
    }
    const cursorUpdateHandler = ({ cursor, user }) => {
      if (!user?.id || !cursor) return
      setCursors((prev) => ({
        ...prev,
        [user.id]: cursor
      }))
    }

    socket.on('arena_editor_state', editorStateHandler)
    socket.on('arena_editor_update', editorUpdateHandler)
    socket.on('arena_timer_update', timerUpdateHandler)
    socket.on('arena_match_finished', matchFinishedHandler)
    socket.on('arena_presence', presenceHandler)
    socket.on('arena_cursor_update', cursorUpdateHandler)
    socket.on('xp_gained', xpGainedHandler)

    return () => {
      socket.off('arena_editor_state', editorStateHandler)
      socket.off('arena_editor_update', editorUpdateHandler)
      socket.off('arena_timer_update', timerUpdateHandler)
      socket.off('arena_match_finished', matchFinishedHandler)
      socket.off('arena_presence', presenceHandler)
      socket.off('arena_cursor_update', cursorUpdateHandler)
      socket.off('xp_gained', xpGainedHandler)
    }
  }, [matchId, profile?.name, socket, toast, user?.user_metadata?.name, userId])

  const onChange = (v) => {
    const next = v ?? ''
    setContent(next)
    const now = Date.now()
    if (now - lastSentRef.current < 120) return
    lastSentRef.current = now
    socket.emit('arena_editor_update', {
      matchId,
      content: next,
      user: { id: userId, name: profile?.name || user?.user_metadata?.name || 'User' }
    })
  }

  const submitZip = async (file) => {
    if (!file) return
    if (!teamId) return toast.error('Select your team to submit')
    setSubmitting(true)
    try {
      const form = new FormData()
      form.append('zip', file)
      form.append('teamId', teamId)
      const res = await fetch(`/api/arena/matches/${matchId}/submit`, {
        method: 'POST',
        headers: { 'x-user-id': userId },
        body: form
      })
      const json = await res.json()
      if (!json?.success) throw new Error(json?.message || 'Submit failed')
      toast.success('Submission received')
    } catch (e) {
      toast.error(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  const joinMatchDay = async () => {
    if (!teamId) return toast.error('Select your team first')
    setJoiningMatchDay(true)
    try {
      const res = await fetch(`/api/arena/matches/${matchId}/join-day`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
        body: JSON.stringify({ teamId })
      })
      const j = await res.json()
      if (!j?.success) throw new Error(j?.message || 'Failed to join')
      toast.success(`Ready ${j.data.readyCount}/${j.data.required}`)
    } catch (e) {
      toast.error(e.message)
    } finally {
      setJoiningMatchDay(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#04070f] text-slate-200">
      <Navbar />
      <main className="max-w-[1400px] mx-auto px-6 py-6 space-y-4">
        <ArenaBackButton to="/arena/lobby" />
        <div className="rounded-2xl bg-slate-900/70 border border-white/10 p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wider text-slate-400 font-bold">Match</div>
            <div className="text-lg font-black">{matchId}</div>
            <div className="text-xs text-slate-400 mt-1">
              Mode: {match?.mode || '—'} • Status: {match?.status || '—'}
              {match?.metadata?.queueType === 'ranked' && rankTier && (
                <span className="ml-3 px-2 py-0.5 rounded-lg bg-white/5 border border-white/10 text-slate-200 font-bold">
                  {rankTier}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className={`px-4 py-2 rounded-xl border ${remainingSec <= 60 ? 'border-rose-400/30 bg-rose-500/10 text-rose-200' : 'border-sky-400/30 bg-sky-500/10 text-sky-100'}`}>
              <div className="text-[10px] uppercase tracking-wider font-bold opacity-80">Time left</div>
              <div className="text-xl font-black">{formatTime(remainingSec)}</div>
            </div>
            <div className="min-w-[240px]">
              <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold mb-1">Your team</div>
              <select value={teamId} onChange={(e) => setTeamId(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10">
                <option value="">Select team…</option>
                {(teams || []).map((t) => (
                  <option key={t.team_id} value={t.team_id}>{t.arena_teams?.name || t.team_id}</option>
                ))}
              </select>
            </div>
            <label className={`px-4 py-3 rounded-xl font-black cursor-pointer ${locked ? 'bg-white/10 text-slate-500 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-500 text-white'}`}>
              {submitting ? 'Submitting…' : locked ? 'Locked' : 'Submit ZIP'}
              <input type="file" accept=".zip" className="hidden" disabled={locked || submitting} onChange={(e) => submitZip(e.target.files?.[0])} />
            </label>
            {match?.status === 'waiting' && (
              <button
                type="button"
                onClick={joinMatchDay}
                disabled={joiningMatchDay}
                className="px-4 py-3 rounded-xl font-black bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-50"
              >
                {joiningMatchDay ? 'Joining…' : 'Join Match Day'}
              </button>
            )}
          </div>
        </div>

        {match?.status === 'waiting' && prematch && (
          <div className="rounded-2xl bg-violet-500/10 border border-violet-500/20 p-4">
            <div className="text-xs uppercase tracking-wider text-violet-200 font-bold">Pre-Match Lobby</div>
            <div className="mt-2 text-sm text-slate-200">
              Scheduled: {prematch.match?.scheduled_at ? new Date(prematch.match.scheduled_at).toLocaleString() : 'TBD'}
            </div>
            <div className="mt-3 grid md:grid-cols-2 gap-3">
              {(prematch.teams || []).map((t) => (
                <div key={t.team_id} className="rounded-xl bg-black/20 border border-white/10 p-3">
                  <div className="font-bold">{t.arena_teams?.name || t.team_id}</div>
                  <div className="text-xs text-slate-300 mt-1">
                    Ready: {prematch.readiness?.[t.team_id] || 0}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {match?.metadata?.aiChallenge && (
          <div className="rounded-2xl bg-white/5 border border-white/10 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-wider text-slate-400 font-bold">AI Challenge</div>
                <div className="text-lg font-black mt-1">{match.metadata.aiChallenge.title}</div>
                <div className="text-sm text-slate-300 mt-2">Difficulty: <span className="font-bold text-slate-100">{match.metadata.aiChallenge.difficulty}</span></div>
              </div>
              <div className="px-3 py-2 rounded-xl bg-sky-500/10 border border-sky-500/20 text-slate-200 text-sm font-semibold">
                {match.metadata.queueType === 'ranked' ? 'Ranked Queue' : 'Casual Queue'}
              </div>
            </div>
          </div>
        )}

        {rewardSummary && (
          <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/30 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-wider text-emerald-300 font-bold">Match Rewards</div>
                <div className="text-sm text-slate-100 mt-2">
                  +{rewardSummary.xpGain || 0} XP • +{rewardSummary.credits || 0} credits
                </div>
                <div className="text-xs text-slate-300 mt-1">
                  MVP: {rewardSummary.mvp ? 'Yes' : 'No'} • Rank movement: {rewardSummary.rankMovement || 'n/a'} • Streak bonus: {rewardSummary.streakBonus || 0}
                </div>
                {rewardSummary.levelUp && (
                  <div className="mt-2 text-xs inline-block px-2 py-1 rounded-lg bg-emerald-600/20 border border-emerald-500/30 text-emerald-200">
                    Level Up! Now Level {rewardSummary.level}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => setRewardSummary(null)}
                className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 border border-white/10 text-xs font-bold"
              >
                Close
              </button>
            </div>
          </div>
        )}

        <div className="grid lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
        <div className="rounded-2xl bg-slate-900/70 border border-white/10 overflow-hidden">
          <MonacoEditor
            height="70vh"
            theme="vs-dark"
            language="javascript"
            value={content}
            options={{
              readOnly: locked,
              minimap: { enabled: false },
              fontSize: 13,
              wordWrap: 'on'
            }}
            onMount={(editor) => {
              editor.onDidChangeCursorSelection((e) => {
                if (locked) return
                const pos = e.selection?.active
                if (!pos) return
                const now = Date.now()
                if (now - lastCursorSentRef.current < 60) return
                lastCursorSentRef.current = now
                socket.emit('arena_cursor_update', {
                  matchId,
                  cursor: { lineNumber: pos.lineNumber, column: pos.column },
                  user: { id: userId, name: profile?.name || user?.user_metadata?.name || 'User' }
                })
              })
            }}
            onChange={onChange}
          />
        </div>
          </div>

          <div className="space-y-4">
            <VoiceChat
              socket={socket}
              matchId={matchId}
              selfUserId={userId}
              selfName={profile?.name || user?.user_metadata?.name || 'User'}
              locked={locked}
            />

            <div className="rounded-2xl bg-slate-900/70 border border-white/10 p-4">
              <div className="text-xs uppercase tracking-wider text-slate-400 font-bold mb-3">Connected</div>
              <div className="space-y-2">
                {[{ id: userId, name: profile?.name || user?.user_metadata?.name || 'User' }, ...connected]
                  .reduce((acc, u) => {
                    if (!u?.id) return acc
                    if (acc.some((x) => x.id === u.id)) return acc
                    acc.push(u)
                    return acc
                  }, [])
                  .map((u) => {
                    const cur = cursors[u.id]
                    const typingAt = typingNow[u.id] || 0
                    const typing = Date.now() - typingAt < 1200
                    return (
                      <div key={u.id} className="flex items-center justify-between text-sm border border-white/5 rounded-xl px-3 py-2 bg-white/5">
                        <div>
                          <div className="font-bold text-slate-200">{u.name}</div>
                          <div className="text-xs text-slate-400">
                            {typing ? 'typing…' : (cur ? `cursor L${cur.lineNumber}` : 'online')}
                          </div>
                        </div>
                        <div className="text-xs text-slate-500">{u.id === userId ? 'You' : ''}</div>
                      </div>
                    )
                  })}
                {connected.length === 0 && (
                  <div className="text-sm text-slate-500">No teammates connected yet.</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

