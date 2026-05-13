import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useToast } from './Toast'

const STATUS_CONFIG = {
  running:      { label: 'Running',      dot: 'bg-emerald-400', badge: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30', ring: 'border-emerald-500/20', pulse: true  },
  building:     { label: 'Building',     dot: 'bg-amber-400',   badge: 'bg-amber-500/15 text-amber-400 border-amber-500/30',       ring: 'border-amber-500/20',   pulse: true  },
  starting:     { label: 'Starting',     dot: 'bg-sky-400',     badge: 'bg-sky-500/15 text-sky-400 border-sky-500/30',             ring: 'border-sky-500/20',     pulse: true  },
  health_check: { label: 'Health Check', dot: 'bg-sky-400',     badge: 'bg-sky-500/15 text-sky-400 border-sky-500/30',             ring: 'border-sky-500/20',     pulse: true  },
  queued:       { label: 'Queued',       dot: 'bg-slate-400',   badge: 'bg-slate-500/15 text-slate-400 border-slate-500/30',       ring: 'border-white/10',       pulse: false },
  failed:       { label: 'Failed',       dot: 'bg-red-400',     badge: 'bg-red-500/20 text-red-400 border-red-500/40',             ring: 'border-red-500/40',     pulse: false },
  stopped:      { label: 'Stopped',      dot: 'bg-slate-600',   badge: 'bg-slate-800/60 text-slate-500 border-slate-700/40',       ring: 'border-white/5',        pulse: false },
  timeout:      { label: 'Timed Out',    dot: 'bg-orange-400',  badge: 'bg-orange-500/15 text-orange-400 border-orange-500/30',    ring: 'border-orange-500/30',  pulse: false },
}

const FILTERS = ['all', 'running', 'building', 'failed', 'queued']

function fmt(secs) {
  if (!secs && secs !== 0) return '—'
  if (secs < 60) return `${secs}s`
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`
}

function shortId(id = '') {
  return id.slice(0, 8) + '…'
}

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.stopped
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold uppercase tracking-wider border ${cfg.badge}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot} ${cfg.pulse ? 'animate-pulse' : ''}`} />
      {cfg.label}
    </span>
  )
}

function ContainerCard({ container, adminId, onKilled, onRefresh }) {
  const toast = useToast()
  const [showLogs, setShowLogs] = useState(false)
  const [logs, setLogs] = useState(container.recentLogs || [])
  const [killing, setKilling] = useState(false)
  const [loadingLogs, setLoadingLogs] = useState(false)
  const logsRef = useRef(null)

  const cfg = STATUS_CONFIG[container.status] || STATUS_CONFIG.stopped
  const isFailed = container.status === 'failed'
  const isActive = ['running', 'building', 'starting', 'health_check'].includes(container.status)

  const fetchLogs = async () => {
    setLoadingLogs(true)
    try {
      const res = await fetch(`/logs/${container.submissionId}`)
      const data = await res.json()
      if (data.success) setLogs(data.logs || [])
    } catch {
      setLogs(['Could not fetch logs.'])
    } finally {
      setLoadingLogs(false)
      setTimeout(() => logsRef.current?.scrollTo({ top: logsRef.current.scrollHeight, behavior: 'smooth' }), 50)
    }
  }

  const toggleLogs = () => {
    if (!showLogs) fetchLogs()
    setShowLogs(!showLogs)
  }

  const killContainer = async () => {
    if (!confirm(`Kill container ${shortId(container.submissionId)}? This will stop the sandbox immediately.`)) return
    setKilling(true)
    try {
      const res = await fetch('/admin/kill-container', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-id': adminId },
        body: JSON.stringify({ submissionId: container.submissionId, adminId })
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.message)
      toast.success('Container killed')
      onKilled?.()
    } catch (err) {
      toast.error(err.message || 'Kill failed')
    } finally {
      setKilling(false)
    }
  }

  const uptime = container.ageSeconds != null ? fmt(container.ageSeconds) : '—'
  const idle   = container.inactiveSeconds != null ? fmt(container.inactiveSeconds) : '—'

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      className={`rounded-2xl border bg-slate-900/60 backdrop-blur-sm overflow-hidden transition-colors ${cfg.ring} ${isFailed ? 'shadow-[0_0_20px_rgba(239,68,68,0.15)]' : ''}`}
    >
      {/* Error Banner */}
      {isFailed && (
        <div className="flex items-center gap-2 px-4 py-2 bg-red-500/10 border-b border-red-500/20">
          <svg className="w-4 h-4 text-red-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <span className="text-xs font-bold text-red-400 uppercase tracking-wider">Container Error — Build or startup failed</span>
          <button onClick={toggleLogs} className="ml-auto text-xs text-red-400/70 hover:text-red-400 underline underline-offset-2">
            {showLogs ? 'Hide' : 'View'} Logs
          </button>
        </div>
      )}

      <div className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          {/* Left — identity */}
          <div className="flex items-start gap-3 min-w-0">
            <div className={`mt-0.5 w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${isFailed ? 'bg-red-500/20' : isActive ? 'bg-slate-700/60' : 'bg-slate-800/60'}`}>
              {isFailed ? (
                <svg className="w-4 h-4 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
              ) : isActive ? (
                <svg className="w-4 h-4 text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
              ) : (
                <svg className="w-4 h-4 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-xs text-slate-300 font-semibold" title={container.submissionId}>{shortId(container.submissionId)}</span>
                <StatusBadge status={container.status} />
                {container.previewType && (
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${container.previewType === 'mentor' ? 'bg-violet-500/10 text-violet-400 border-violet-500/20' : 'bg-sky-500/10 text-sky-400 border-sky-500/20'}`}>
                    {container.previewType}
                  </span>
                )}
              </div>
              <div className="mt-1.5 text-sm font-semibold text-white truncate max-w-sm">
                {container.taskTitle || <span className="text-slate-500 italic text-xs">Unknown Task</span>}
              </div>
              <div className="mt-0.5 text-xs text-slate-500 flex items-center gap-1.5">
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                {container.userName || container.userId?.slice(0, 12) + '…'}
              </div>
            </div>
          </div>

          {/* Right — meta + actions */}
          <div className="flex flex-col items-end gap-2.5 flex-shrink-0">
            <div className="flex items-center gap-2">
              {isActive && (
                <button
                  onClick={killContainer}
                  disabled={killing}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-xs font-bold uppercase tracking-wide transition-all disabled:opacity-50"
                >
                  {killing ? (
                    <div className="w-3 h-3 border border-red-400/30 border-t-red-400 rounded-full animate-spin" />
                  ) : (
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  )}
                  Kill
                </button>
              )}
              <button
                onClick={toggleLogs}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 text-xs font-bold uppercase tracking-wide transition-all"
              >
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                Logs
              </button>
            </div>

            {/* Stats row */}
            <div className="flex items-center gap-4 text-[11px] text-slate-500">
              {container.port && <span className="font-mono">:{container.port}</span>}
              <span title="Uptime">⏱ {uptime}</span>
              {container.status === 'running' && <span title="Idle since">💤 {idle}</span>}
            </div>
          </div>
        </div>

        {/* Log Drawer */}
        <AnimatePresence>
          {showLogs && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="mt-4 rounded-xl bg-black/60 border border-white/10 overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 bg-white/5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Terminal Logs</span>
                  <button onClick={fetchLogs} className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors">↻ Refresh</button>
                </div>
                <div ref={logsRef} className="h-52 overflow-y-auto p-3 font-mono text-[11px] text-slate-300 leading-5 space-y-0.5">
                  {loadingLogs ? (
                    <div className="text-slate-500 text-center py-8">Loading logs…</div>
                  ) : logs.length === 0 ? (
                    <div className="text-slate-600 text-center py-8">No logs available</div>
                  ) : logs.map((line, i) => {
                    const isErr = /error|fail|fatal|exception/i.test(line)
                    const isWarn = /warn|warning/i.test(line)
                    return (
                      <div key={i} className={`${isErr ? 'text-red-400' : isWarn ? 'text-amber-400' : 'text-slate-300'}`}>
                        <span className="text-slate-700 select-none mr-2">{String(i + 1).padStart(3, ' ')}</span>
                        {line}
                      </div>
                    )
                  })}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}

export default function AdminSandboxPanel({ adminId }) {
  const toast = useToast()
  const [containers, setContainers] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [refreshCountdown, setRefreshCountdown] = useState(10)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [killingAll, setKillingAll] = useState(false)
  const intervalRef = useRef(null)
  const countdownRef = useRef(null)

  const fetchSandboxes = useCallback(async () => {
    try {
      const res = await fetch('/admin/sandboxes', { headers: { 'x-admin-id': adminId } })
      const data = await res.json()
      if (data.success) setContainers(data.containers || [])
    } catch {
      // silent
    } finally {
      setLoading(false)
      setRefreshCountdown(10)
    }
  }, [adminId])

  useEffect(() => {
    fetchSandboxes()
  }, [fetchSandboxes])

  useEffect(() => {
    if (!autoRefresh) {
      clearInterval(intervalRef.current)
      clearInterval(countdownRef.current)
      return
    }
    intervalRef.current = setInterval(fetchSandboxes, 10000)
    countdownRef.current = setInterval(() => setRefreshCountdown(c => (c <= 1 ? 10 : c - 1)), 1000)
    return () => {
      clearInterval(intervalRef.current)
      clearInterval(countdownRef.current)
    }
  }, [autoRefresh, fetchSandboxes])

  const killAll = async () => {
    const active = containers.filter(c => ['running', 'building', 'starting'].includes(c.status))
    if (active.length === 0) return toast.info('No active containers to kill')
    if (!confirm(`Kill ALL ${active.length} active container(s)? This will stop all running sandboxes.`)) return
    setKillingAll(true)
    try {
      await Promise.all(active.map(c =>
        fetch('/admin/kill-container', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-admin-id': adminId },
          body: JSON.stringify({ submissionId: c.submissionId, adminId })
        })
      ))
      toast.success(`Killed ${active.length} container(s)`)
      fetchSandboxes()
    } catch {
      toast.error('Some containers failed to kill')
    } finally {
      setKillingAll(false)
    }
  }

  const counts = {
    all: containers.length,
    running: containers.filter(c => c.status === 'running').length,
    building: containers.filter(c => ['building', 'starting', 'health_check', 'queued'].includes(c.status)).length,
    failed: containers.filter(c => c.status === 'failed').length,
    queued: containers.filter(c => c.status === 'queued').length,
  }

  const filtered = filter === 'all' ? containers
    : filter === 'building' ? containers.filter(c => ['building', 'starting', 'health_check'].includes(c.status))
    : containers.filter(c => c.status === filter)

  const hasErrors = counts.failed > 0

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-white tracking-tight">Sandbox Control</h2>
          <p className="text-xs text-slate-500 mt-0.5">{containers.length} total containers tracked</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setAutoRefresh(a => !a) }}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-bold transition-all ${autoRefresh ? 'bg-sky-500/10 border-sky-500/30 text-sky-400' : 'bg-white/5 border-white/10 text-slate-400'}`}
          >
            <svg className={`w-3 h-3 ${autoRefresh ? 'animate-spin' : ''}`} style={{ animationDuration: '3s' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
            </svg>
            {autoRefresh ? `Auto ${refreshCountdown}s` : 'Auto Off'}
          </button>
          <button onClick={fetchSandboxes} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 text-xs font-bold transition-all">
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            Refresh
          </button>
          <button
            onClick={killAll}
            disabled={killingAll || counts.running + counts.building === 0}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-xs font-bold uppercase tracking-wide transition-all disabled:opacity-40"
          >
            {killingAll ? <div className="w-3 h-3 border border-red-400/30 border-t-red-400 rounded-full animate-spin" /> : (
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            )}
            Kill All
          </button>
        </div>
      </div>

      {/* Error Alert Banner */}
      {hasErrors && (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-red-500/10 border border-red-500/30">
          <div className="w-8 h-8 rounded-xl bg-red-500/20 flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          </div>
          <div>
            <div className="text-sm font-bold text-red-400">{counts.failed} container{counts.failed > 1 ? 's' : ''} failed</div>
            <div className="text-xs text-red-400/60">Check logs below for build or startup errors</div>
          </div>
          <button onClick={() => setFilter('failed')} className="ml-auto px-3 py-1.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-xs font-bold transition-all">
            View Failed
          </button>
        </motion.div>
      )}

      {/* Stats strip */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Running', count: counts.running, color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20' },
          { label: 'Building', count: counts.building, color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20' },
          { label: 'Failed', count: counts.failed, color: 'text-red-400', bg: counts.failed > 0 ? 'bg-red-500/10 border-red-500/30' : 'bg-white/5 border-white/10' },
          { label: 'Total', count: counts.all, color: 'text-slate-300', bg: 'bg-white/5 border-white/10' },
        ].map(s => (
          <div key={s.label} className={`rounded-xl p-3 border ${s.bg} text-center`}>
            <div className={`text-2xl font-black ${s.color}`}>{s.count}</div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-xl p-1 w-fit">
        {FILTERS.map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold capitalize transition-all ${filter === f ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-slate-300'}`}
          >
            {f}
            {f !== 'all' && counts[f] > 0 && (
              <span className={`ml-1.5 px-1 py-0.5 rounded text-[10px] ${f === 'failed' ? 'bg-red-500/30 text-red-400' : 'bg-white/10 text-slate-400'}`}>
                {counts[f] > 0 ? counts[f] : ''}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Container List */}
      {loading ? (
        <div className="py-16 text-center text-slate-500 text-sm">Loading sandbox registry…</div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center rounded-2xl border border-white/10 bg-slate-900/40">
          <div className="text-3xl mb-3">🟢</div>
          <div className="text-slate-400 font-semibold text-sm">No containers in this state</div>
          <div className="text-slate-600 text-xs mt-1">
            {filter === 'all' ? 'No containers tracked yet. Sandbox submissions will appear here.' : `No ${filter} containers right now.`}
          </div>
        </div>
      ) : (
        <AnimatePresence mode="popLayout">
          <div className="space-y-3">
            {filtered.map(c => (
              <ContainerCard
                key={c.submissionId}
                container={c}
                adminId={adminId}
                onKilled={fetchSandboxes}
                onRefresh={fetchSandboxes}
              />
            ))}
          </div>
        </AnimatePresence>
      )}
    </div>
  )
}
