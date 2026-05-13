import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function ArenaModeCard() {
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const userId = profile?.id || user?.id

  const [status, setStatus] = useState({ liveMatches: 0, activePlayers: 0, queueStatus: '—' })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!userId) return
    setLoading(true)
    fetch('/api/arena/status')
      .then((r) => r.json())
      .then((j) => {
        if (j?.success) setStatus(j.data)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [userId])

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => navigate('/arena')}
      onKeyDown={(e) => { if (e.key === 'Enter') navigate('/arena') }}
      className="glass-card rounded-2xl p-6 cursor-pointer hover:shadow-lg transition-all border border-ice-500/20 bg-gradient-to-br from-sky-500/10 via-violet-500/10 to-rose-500/10"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">Arena Mode</div>
          <div className="text-xl font-black text-slate-800">
            <span className="text-transparent bg-clip-text bg-gradient-to-br from-sky-400 to-violet-400">Realtime Battle</span>
          </div>
          <div className="mt-3 space-y-2">
            <div className="flex items-center justify-between text-sm text-slate-600">
              <span className="font-semibold">Live Matches</span>
              <span className="font-black text-slate-900">{loading ? '—' : status.liveMatches}</span>
            </div>
            <div className="flex items-center justify-between text-sm text-slate-600">
              <span className="font-semibold">Active Players</span>
              <span className="font-black text-slate-900">{loading ? '—' : status.activePlayers}</span>
            </div>
            <div className="flex items-center justify-between text-sm text-slate-600">
              <span className="font-semibold">Queue</span>
              <span className="font-black text-slate-900">{loading ? '—' : status.queueStatus}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-col items-end gap-3">
          <div className="w-12 h-12 rounded-2xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center">
            <span className="text-slate-800 text-xl font-black">⚔️</span>
          </div>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); navigate('/arena') }}
            className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-bold shadow-lg shadow-sky-500/20"
          >
            Quick Join
          </button>
        </div>
      </div>
    </div>
  )
}

