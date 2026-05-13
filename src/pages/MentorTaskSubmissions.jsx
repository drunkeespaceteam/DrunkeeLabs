import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import Navbar from '../components/Navbar'
import ChatPanel from '../components/ChatPanel'
import { useAuth } from '../context/AuthContext'
import { db, realtime, supabase } from '../lib/supabase'
import { useToast } from '../components/Toast'
import { io as socketIO } from 'socket.io-client'
import { mergeSubmissionRevisionSources, isPersistedRevisionRowId } from '../utils/revisionMerge'

const socket = socketIO('/', { path: '/socket.io', transports: ['websocket', 'polling'] })

function getScoreColor(score) {
  if (score >= 80) return { ring: '#10b981', bg: 'from-emerald-500 to-emerald-400', text: 'text-emerald-400', label: 'Excellent' }
  if (score >= 60) return { ring: '#38bdf8', bg: 'from-sky-500 to-sky-400', text: 'text-sky-400', label: 'Good' }
  if (score >= 40) return { ring: '#f59e0b', bg: 'from-amber-500 to-amber-400', text: 'text-amber-400', label: 'Needs Work' }
  return { ring: '#ef4444', bg: 'from-rose-500 to-rose-400', text: 'text-rose-400', label: 'Poor' }
}

function getBuildStatusMeta(status) {
  const normalized = (status || '').toLowerCase()
  const map = {
    uploading:          { label: 'Uploading',      cls: 'text-sky-400 bg-sky-500/10 border-sky-500/20' },
    queued:             { label: 'Queued',          cls: 'text-violet-400 bg-violet-500/10 border-violet-500/20' },
    extracting:         { label: 'Extracting',      cls: 'text-blue-400 bg-blue-500/10 border-blue-500/20' },
    validating:         { label: 'Validating',      cls: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20' },
    building:           { label: 'Building',        cls: 'text-amber-400 bg-amber-500/10 border-amber-500/20' },
    starting:           { label: 'Starting',        cls: 'text-orange-400 bg-orange-500/10 border-orange-500/20' },
    health_check:       { label: 'Health Check',    cls: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20' },
    running:            { label: 'Running',         cls: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
    failed:             { label: 'Failed',          cls: 'text-rose-400 bg-rose-500/10 border-rose-500/20' },
    failed_permanently: { label: 'Build Failed',    cls: 'text-rose-500 bg-rose-500/10 border-rose-500/20' },
    expired:            { label: 'Expired',         cls: 'text-slate-400 bg-slate-500/10 border-slate-500/20' },
    stopped:            { label: 'Stopped',         cls: 'text-slate-300 bg-slate-500/10 border-slate-500/20' }
  }
  return map[normalized] || { label: status || 'Unknown', cls: 'text-slate-400 bg-slate-500/10 border-slate-500/20' }
}

function parseSuggestionLinesFromLogs(lines) {
  const text = (lines || []).join('\n')
  const block = text.match(/💡 Suggested Fixes:[\s\S]*?(?=\n\s*Category:|$)/)
  if (!block) return []
  return block[0].split('\n').filter(l => /^\s*\d+\./.test(l)).map(l => l.replace(/^\s*\d+\.\s*/, '').trim())
}

/* ─── Build log diagnostics (mentor project viewer) ─── */
function BuildLogDiagnosticsPanel({ liveLogs, fallbackText, errorCategory, errorSuggestion, showRawLogs, onToggleRaw }) {
  const lines = liveLogs.length > 0 ? liveLogs : (typeof fallbackText === 'string' ? fallbackText.split('\n') : [])
  const joined = lines.join('\n')
  const hasAlert = joined.includes('❌') || joined.includes('⚠️')
  const cat =
    errorCategory ||
    (joined.match(/Category:\s*([\w_]+)/i) || [])[1]
  const suggestionsFromLogs = parseSuggestionLinesFromLogs(lines)
  const suggestions = (errorSuggestion ? errorSuggestion.split(' · ').filter(Boolean) : []).length
    ? errorSuggestion.split(' · ').filter(Boolean)
    : suggestionsFromLogs

  return (
    <div className="absolute inset-0 flex flex-col min-h-0 bg-[#050505]">
      {(cat || suggestions.length > 0 || hasAlert) && (
        <div className="flex-shrink-0 border-b border-white/10 p-4 space-y-3 bg-black/40">
          {cat && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Error type</span>
              <span className="px-2 py-0.5 rounded-md bg-rose-500/15 border border-rose-500/25 text-rose-300 text-[10px] font-black uppercase tracking-wide">
                {(cat || '').replace(/_/g, ' ')}
              </span>
              {hasAlert && <span className="text-amber-400 text-xs">Warnings / errors in log</span>}
            </div>
          )}
          {suggestions.length > 0 && (
            <details open className="group rounded-lg border border-amber-500/20 bg-amber-500/5 overflow-hidden">
              <summary className="cursor-pointer px-3 py-2 text-[11px] font-bold text-amber-200/90 uppercase tracking-wider list-none flex items-center justify-between">
                Suggested fixes
                <span className="text-amber-400/60 text-[10px] group-open:hidden">Expand</span>
              </summary>
              <ul className="px-3 pb-3 space-y-1.5 text-[11px] text-slate-300 leading-relaxed">
                {suggestions.map((s, i) => (
                  <li key={i} className="flex gap-2"><span className="text-amber-500 font-bold">{i + 1}.</span> {s}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 font-mono text-[11px] text-slate-300 whitespace-pre-wrap leading-relaxed">
        {showRawLogs ? (
          lines.length > 0 ? joined : fallbackText
        ) : (
          <div className="space-y-1">
            {(() => {
              const src = lines.length > 0 ? lines : String(fallbackText || '').split('\n')
              const marked = src.filter(l => l.includes('❌') || l.includes('⚠️') || l.includes('Suggested Fixes') || l.includes('═══'))
              const toShow = marked.length > 0 ? marked : src.filter(Boolean).slice(-24)
              return toShow.map((l, i) => (
                <div key={i} className={l.includes('❌') ? 'text-rose-300' : l.includes('⚠️') ? 'text-amber-300' : 'text-slate-400'}>{l}</div>
              ))
            })()}
            {!lines.length && !fallbackText && <span className="text-slate-600">No logs yet.</span>}
          </div>
        )}
      </div>
      {onToggleRaw ? (
        <button
          type="button"
          onClick={onToggleRaw}
          className="flex-shrink-0 border-t border-white/10 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-sky-400 hover:bg-white/5"
        >
          {showRawLogs ? 'Show filtered view' : 'Show full raw logs'}
        </button>
      ) : null}
    </div>
  )
}

/* ─── Confirmation Modal ─── */
function ConfirmModal({ isOpen, onClose, onConfirm, userName, loading }) {
  if (!isOpen) return null
  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-[200] flex items-center justify-center p-4"
        onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
          className="relative bg-[#0a0a0a] border border-white/10 rounded-2xl p-8 max-w-md w-full shadow-2xl text-center">
          <div className="w-16 h-16 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto mb-5">
            <span className="text-3xl">🏆</span>
          </div>
          <h3 className="text-xl font-bold text-white mb-2">Announce Winner</h3>
          <p className="text-sm text-slate-400 mb-6">
            Are you sure you want to select <span className="text-white font-bold">{userName}</span> as the winner? The task will close and they will be prompted to submit their final code snapshot for your approval.
          </p>
          <div className="flex gap-3">
            <button onClick={onClose} disabled={loading} className="flex-1 py-3 rounded-xl bg-white/5 border border-white/10 text-sm font-bold text-white hover:bg-white/10 transition-all">Cancel</button>
            <button onClick={onConfirm} disabled={loading} className="flex-1 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-black text-sm font-bold transition-all shadow-[0_0_20px_rgba(245,158,11,0.3)] flex items-center justify-center gap-2">
              {loading ? <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" /> : '🏆'} Announce Winner
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

// Module-level guard: prevent duplicate sandbox requests even across re-renders
const pendingSandboxRequests = new Set()

/* ─── Project Viewer Modal (Sandbox Preview) ─── */
function ProjectViewerModal({ isOpen, onClose, submission, onConfirmCode, onDownload, onStartSandbox, startingSandbox, confirming }) {
  const [fullscreenImage, setFullscreenImage] = useState(null)
  const [viewMode, setViewMode] = useState('preview') // 'preview' | 'logs'
  const [liveLogs, setLiveLogs] = useState([])
  const [showRawLogs, setShowRawLogs] = useState(false)
  // Polling state: merge latest backend status so frontend never gets stuck
  const [pollStatus, setPollStatus] = useState({ status: null, previewUrl: null })

  const fb = submission?.feedback || {}
  const colors = getScoreColor(submission?.score || 0)
  const ssArray = submission?.screenshots || (submission?.screenshot ? [submission.screenshot] : [])

  // Effective status: prefer polled backend status over stale prop
  const effectiveStatus = pollStatus.status || submission?.build_status
  const effectivePreviewUrl = pollStatus.previewUrl || submission?.preview_url

  // Fetch logs when modal opens
  useEffect(() => {
    if (isOpen && submission?.id) {
      fetch(`/logs/${submission.id}`)
        .then(res => res.json())
        .then(data => { if (data.success) setLiveLogs(data.logs) })
        .catch(console.error)
    }
  }, [isOpen, submission?.id])

  // Poll job status every 2 seconds while modal is open and preview is not running
  useEffect(() => {
    if (!isOpen || !submission?.id) return
    let cancelled = false
    let interval = null
    const tick = async () => {
      try {
        const res = await fetch(`/job-status/${submission.id}`)
        const data = await res.json()
        console.log(`[Frontend Poll ${submission.id}] status=${data.status} previewUrl=${data.previewUrl || 'null'}`)
        if (!cancelled && data.success) {
          setPollStatus({ status: data.status, previewUrl: data.previewUrl })
          if (Array.isArray(data.logs) && data.logs.length > 0) {
            setLiveLogs(data.logs)
          }
          // Stop polling ONLY when backend says running AND preview_url exists
          if (data.status === 'running' && data.previewUrl) {
            console.log(`[Frontend Poll ${submission.id}] RUNNING + previewUrl ready. Stopping poll.`)
            clearInterval(interval)
          }
        }
      } catch (err) {
        console.warn(`[Frontend Poll ${submission.id}] Request failed:`, err)
      }
    }
    // Run immediately, then every 2s
    tick()
    interval = setInterval(tick, 2000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [isOpen, submission?.id])

  // Heartbeat — keeps the container alive while mentor is actively viewing the preview
  useEffect(() => {
    if (!isOpen || !submission?.id || effectiveStatus !== 'running') return
    const interval = setInterval(() => {
      fetch(`/heartbeat/${submission.id}`).catch(() => {})
    }, 10000)
    return () => clearInterval(interval)
  }, [isOpen, submission?.id, effectiveStatus])

  // Auto-stop container when mentor closes the preview modal
  useEffect(() => {
    if (!isOpen && submission?.id && effectiveStatus === 'running') {
      fetch(`/stop-preview/${submission.id}`, { method: 'POST' })
        .catch(() => {})
    }
  }, [isOpen, submission?.id, effectiveStatus])

  if (!isOpen || !submission) return null

  return (
    <>
    <AnimatePresence>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-[150] flex items-center justify-center p-4"
        onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="absolute inset-0 bg-black/80 backdrop-blur-md" />
        <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
          className="relative w-full max-w-6xl h-[85vh] bg-[#0a0a0a] border border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
          
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-white/[0.02] flex-shrink-0">
            <div className="flex items-center gap-4">
              <div className="relative w-12 h-12 flex-shrink-0">
                <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
                  <circle cx="60" cy="60" r="50" fill="#050505" stroke="rgba(255,255,255,0.05)" strokeWidth="8" />
                  <circle cx="60" cy="60" r="50" fill="none" stroke={colors.ring} strokeWidth="8" strokeLinecap="round"
                    strokeDasharray={2 * Math.PI * 50} strokeDashoffset={2 * Math.PI * 50 * (1 - (submission.score || 0) / 100)} />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className={`text-sm font-black ${colors.text}`}>{submission.score}</span>
                </div>
              </div>
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  {submission.users?.name || 'User'}'s Submission
                  <span className="px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 text-[10px] uppercase tracking-wider">Sandbox View</span>
                </h3>
                <p className="text-xs text-slate-500">Attempt {submission.attempt_number || 1} • {new Date(submission.created_at).toLocaleDateString()}</p>
              </div>
              {submission.is_winner && (
                <span className="px-3 py-1 rounded-full bg-amber-500/20 border border-amber-500/30 text-amber-400 text-xs font-bold flex items-center gap-1.5">🏆 Winner</span>
              )}
            </div>
            <div className="flex items-center gap-3">
              {/* Download Button */}
              {submission.is_winner && (
                <button onClick={() => onDownload(submission.id)}
                  className="px-4 py-2 rounded-xl bg-violet-500/20 hover:bg-violet-500/30 border border-violet-500/30 text-violet-400 font-semibold transition-all text-sm flex items-center gap-2">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                  Download Source (.zip)
                </button>
              )}
              {/* Confirm Code Button */}
              {onConfirmCode && submission.is_winner && submission.delivery_status !== 'approved' && (
                <button onClick={() => onConfirmCode(submission.id)} disabled={confirming}
                  className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white font-bold transition-all text-sm flex items-center gap-2 shadow-[0_0_15px_rgba(16,185,129,0.3)] disabled:opacity-50">
                  {confirming ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>}
                  Confirm Code & Release Payment
                </button>
              )}
              {submission.delivery_status === 'approved' && (
                <span className="px-4 py-2 rounded-xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 font-bold text-sm flex items-center gap-2">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                  Payment Released
                </span>
              )}
              <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-all">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 flex min-h-0 bg-[#0a0a0a]">
            {/* Main Content Area */}
            <div className="flex-1 flex flex-col min-w-0 border-r border-white/10">
              {/* Tabs */}
              <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-[#141414]">
                <div className="flex items-center gap-3">
                  <button onClick={() => setViewMode('preview')} className={`px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-2 ${viewMode === 'preview' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'text-slate-400 hover:text-slate-200'}`}>
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                    Live Preview
                  </button>
                  <button onClick={() => setViewMode('logs')} className={`px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-2 ${viewMode === 'logs' ? 'bg-violet-500/10 text-violet-400 border border-violet-500/20' : 'text-slate-400 hover:text-slate-200'}`}>
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
                    Build Logs
                  </button>
                </div>
                {effectivePreviewUrl && viewMode === 'preview' && (
                  <div className="flex items-center gap-2">
                    {effectiveStatus === 'running' && !startingSandbox && (
                      <button
                        onClick={() => onStartSandbox?.(submission)}
                        disabled={startingSandbox}
                        className="text-[10px] font-bold text-emerald-400 hover:text-emerald-300 flex items-center gap-1 transition-colors disabled:opacity-50"
                      >
                        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                        Reload Preview
                      </button>
                    )}
                    <a href={`/preview/${submission.id}`} target="_blank" rel="noreferrer" className="text-[10px] font-bold text-sky-400 hover:text-sky-300 flex items-center gap-1">
                      Open in new tab
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                    </a>
                  </div>
                )}
              </div>
              
              <div className="flex-1 relative bg-[#050505]">
                {viewMode === 'preview' && (
                  // ─── PRIORITY 1: If preview_url exists, ALWAYS render iframe ───
                  // Even if build_status is still 'building', the container may be healthy.
                  effectivePreviewUrl ? (
                    <iframe
                      key={`${submission.id}-${effectiveStatus}`}
                      src={`/preview/${submission.id}`}
                      className="w-full h-full border-none bg-white"
                      title="Preview"
                    />
                  ) : effectiveStatus === 'running' && !effectivePreviewUrl ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500 text-sm">
                      <div className="w-12 h-12 bg-white/5 rounded-2xl flex items-center justify-center mb-3">
                        <svg className="w-6 h-6 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                      </div>
                      <p className="font-bold text-white mb-1">Preview URL Missing</p>
                      <p className="text-xs">Backend reports running but no preview URL found.</p>
                      <p className="text-[10px] mt-2 opacity-50">Status: {effectiveStatus}</p>
                    </div>
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500 text-sm">
                      <div className="w-12 h-12 bg-white/5 rounded-2xl flex items-center justify-center mb-3">
                        <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
                      </div>
                      {['queued', 'building', 'starting'].includes(effectiveStatus) || startingSandbox ? (
                        <>
                          <p className="font-bold text-white mb-1">Starting sandbox...</p>
                          <p className="text-xs">Rebuilding preview from stored ZIP. This may take a moment.</p>
                          <p className="text-[10px] mt-2 opacity-50">Status: {effectiveStatus}</p>
                        </>
                      ) : (
                        <>
                          <p className="font-bold text-white mb-1">Sandbox Offline</p>
                          <p className="text-xs">Click below to rebuild the preview from stored files.</p>
                          <p className="text-[10px] mt-2 opacity-50">Status: {effectiveStatus}</p>
                          <button
                            onClick={() => onStartSandbox?.(submission)}
                            disabled={startingSandbox}
                            className="mt-4 px-4 py-2 rounded-xl bg-sky-500/20 hover:bg-sky-500/30 border border-sky-500/30 text-sky-400 text-xs font-bold disabled:opacity-50"
                          >
                            Start Sandbox
                          </button>
                        </>
                      )}
                    </div>
                  )
                )}
                {viewMode === 'logs' && (
                  <BuildLogDiagnosticsPanel
                    liveLogs={liveLogs}
                    fallbackText={submission.logs || 'No logs available.'}
                    errorCategory={submission.error_category}
                    errorSuggestion={submission.error_suggestion}
                    showRawLogs={showRawLogs}
                    onToggleRaw={() => setShowRawLogs(v => !v)}
                  />
                )}
              </div>
            </div>

            {/* AI Evaluation Sidebar */}
            <div className="w-72 bg-black/40 flex flex-col overflow-y-auto">
              <div className="px-4 py-3 border-b border-white/10">
                <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">AI Evaluation</span>
              </div>
              <div className="p-4 space-y-4">
                <div className="p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-xl mb-4 text-center">
                  <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest mb-1">Execution System</p>
                  <p className="text-xs text-indigo-300/80 leading-relaxed">Preview runs on server automatically — no local setup required.</p>
                </div>
                
                {ssArray.length > 0 && (
                  <div>
                    <h4 className="text-[10px] font-bold uppercase tracking-widest text-violet-400 mb-2 flex items-center gap-1.5">
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>
                      Output ({ssArray.length})
                    </h4>
                    <div className="space-y-2">
                      {ssArray.map((ss, idx) => (
                        <div key={idx} className="group relative rounded-xl border border-white/10 overflow-hidden bg-white shadow-lg cursor-pointer hover:border-violet-500/30 transition-all"
                          onClick={() => setFullscreenImage(ss)}>
                          <img src={ss} alt={`Output ${idx+1}`} className="w-full h-auto" />
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                            <div className="opacity-0 group-hover:opacity-100 transition-opacity w-8 h-8 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
                              <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="text-center py-4">
                  <div className={`text-4xl font-black ${colors.text}`}>{submission.score}<span className="text-lg text-slate-600">/100</span></div>
                  <div className={`text-xs font-bold mt-1 ${colors.text}`}>{colors.label}</div>
                </div>
                {fb.feedback && (
                  <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                    <p className="text-xs text-slate-300 leading-relaxed">{fb.feedback}</p>
                  </div>
                )}
                {fb.strengths && fb.strengths.length > 0 && (
                  <div>
                    <h4 className="text-[10px] font-bold uppercase tracking-widest text-emerald-400 mb-2">Strengths</h4>
                    <ul className="space-y-1.5">
                      {fb.strengths.map((s, i) => (
                        <li key={i} className="text-[11px] text-slate-400 bg-emerald-500/5 p-2 rounded-lg border border-emerald-500/10 flex items-start gap-1.5">
                          <span className="text-emerald-500 flex-shrink-0">✦</span> {s}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {fb.weaknesses && fb.weaknesses.length > 0 && (
                  <div>
                    <h4 className="text-[10px] font-bold uppercase tracking-widest text-rose-400 mb-2">Improvements</h4>
                    <ul className="space-y-1.5">
                      {fb.weaknesses.map((w, i) => (
                        <li key={i} className="text-[11px] text-slate-400 bg-rose-500/5 p-2 rounded-lg border border-rose-500/10 flex items-start gap-1.5">
                          <span className="text-rose-500 flex-shrink-0">✦</span> {w}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>

    {/* Fullscreen Image Viewer */}
    <AnimatePresence>
      {fullscreenImage && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[300] flex items-center justify-center p-8 cursor-zoom-out"
          onClick={() => setFullscreenImage(null)}>
          <div className="absolute inset-0 bg-black/90 backdrop-blur-lg" />
          <motion.img initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}
            src={fullscreenImage} alt="Fullscreen" className="relative max-w-full max-h-full rounded-2xl shadow-2xl border border-white/10 object-contain" />
        </motion.div>
      )}
    </AnimatePresence>
    </>
  )
}

/* ─── Main Page ─── */
export default function MentorTaskSubmissions() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const toast = useToast()

  const [task, setTask] = useState(null)
  const [submissions, setSubmissions] = useState([])
  const [reputations, setReputations] = useState({})
  const [loading, setLoading] = useState(true)
  const [viewSub, setViewSub] = useState(null) // for project viewer
  const [confirmSub, setConfirmSub] = useState(null) // for confirm modal
  const [activeChatParticipantId, setActiveChatParticipantId] = useState(null) // for chat modal
  const [selectingWinner, setSelectingWinner] = useState(false)
  const [approving, setApproving] = useState(false)
  const [startingSandbox, setStartingSandbox] = useState(false)
  const [pausingDelivery, setPausingDelivery] = useState(false)
  const [showPauseModal, setShowPauseModal] = useState(false)
  const [showApproveConfirmModal, setShowApproveConfirmModal] = useState(false)
  const [pendingApprovalId, setPendingApprovalId] = useState(null)
  const [pauseForm, setPauseForm] = useState({ reason: '', category: 'clarification_needed', durationHours: 24 })
  const [submissionRevisions, setSubmissionRevisions] = useState([])

  // ─── REVIEW QA SYSTEM STATE ───
  const [reviewSandboxStatus, setReviewSandboxStatus] = useState({ active: false, status: 'idle', revision: null, previewUrl: null })
  const [testingRevision, setTestingRevision] = useState(false)
  const [revisionNotes, setRevisionNotes] = useState({}) // revisionId → notes[]
  const [editingNoteFor, setEditingNoteFor] = useState(null) // revisionId currently adding note to
  const [noteText, setNoteText] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [showReviewPreview, setShowReviewPreview] = useState(false) // show review sandbox modal
  const [reviewModalLogs, setReviewModalLogs] = useState([])
  const [reviewModalTab, setReviewModalTab] = useState('preview') // 'preview' | 'logs'
  const [reviewLogShowRaw, setReviewLogShowRaw] = useState(false)
  const [mentorCorrectionDraft, setMentorCorrectionDraft] = useState('')
  const [savingMentorCorrection, setSavingMentorCorrection] = useState(false)

  const hasWinner = submissions.some(s => s.is_winner)
  const winningSub = submissions.find(s => s.is_winner)

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [taskRes, subRes] = await Promise.all([
      db.getTasks(),
      db.getSubmissionsByTask(id),
    ])
    const foundTask = taskRes.data?.find(t => t.id === id)
    if (foundTask) setTask(foundTask)
    
    // Deduplicate: only keep the latest attempt per user
    const allSubs = subRes.data || []
    const latestByUser = {}
    allSubs.forEach(sub => {
      const uid = sub.user_id
      if (!latestByUser[uid] || (sub.attempt_number || 1) > (latestByUser[uid].attempt_number || 1)) {
        latestByUser[uid] = sub
      }
    })
    const deduped = Object.values(latestByUser).sort((a, b) => (b.score || 0) - (a.score || 0))
    setSubmissions(deduped)

    // Fetch revisions for the winner via API (server uses service role — client RLS often hides rows the employee inserted)
    const winner = deduped.find(s => s.is_winner)
    let apiRows = []
    if (winner && profile?.id) {
      try {
        const res = await fetch(
          `/api/submissions/${winner.id}/revisions?mentorId=${encodeURIComponent(profile.id)}`
        )
        const json = await res.json()
        if (json.success && Array.isArray(json.revisions)) {
          apiRows = json.revisions
        } else if (json?.message) {
          console.warn('[Mentor revisions API]', json.message)
        }
      } catch (e) {
        console.warn('[Mentor revisions]', e)
      }
    }
    if (winner) {
      const merged = mergeSubmissionRevisionSources(
        winner.id,
        apiRows,
        winner.revision_delivery_log,
        winner
      )
      setSubmissionRevisions(merged)
    } else {
      setSubmissionRevisions([])
    }

    // Fetch reputations for these users
    const reps = {}
    await Promise.all(
      Object.keys(latestByUser).map(async (uid) => {
        const { data } = await db.getDeveloperReputation(uid)
        if (data) reps[uid] = data
      })
    )
    setReputations(reps)

    setLoading(false)
  }, [id, profile?.id])

  useEffect(() => { fetchData() }, [fetchData])

  useEffect(() => {
    if (!winningSub?.id) return
    setMentorCorrectionDraft(winningSub.mentor_latest_correction || winningSub.review_hold_reason || '')
  }, [winningSub?.id, winningSub?.mentor_latest_correction, winningSub?.review_hold_reason])

  // Realtime: re-fetch when submissions change
  useEffect(() => {
    const unsub = realtime.subscribeToSubmissions(id, () => fetchData())
    return unsub
  }, [id, fetchData])

  // Socket for new revisions
  useEffect(() => {
    const handleClarification = (data) => {
      if (submissions.some(s => s.id === data.submissionId)) {
        toast.info(`NEW REVISION AVAILABLE: Developer uploaded Revision v${data.revision}`)
        fetchData()
      }
    }
    socket.on('clarification_submitted', handleClarification)
    return () => socket.off('clarification_submitted', handleClarification)
  }, [submissions, fetchData])

  // Fallback Polling Loop for Delivery Status
  useEffect(() => {
    const winner = submissions.find(s => s.is_winner)
    if (!winner || winner.delivery_status === 'approved') return
    const interval = setInterval(async () => {
      const { data } = await supabase.from('submissions').select('delivery_status').eq('id', winner.id).single()
      if (data && data.delivery_status !== winner.delivery_status) {
        fetchData() // Refresh everything to get final files if submitted
      }
    }, 10000)
    return () => clearInterval(interval)
  }, [submissions, fetchData])

  const handleSelectWinner = async () => {
    if (!confirmSub) return
    setSelectingWinner(true)
    
    try {
      const res = await fetch('/announce-winner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: id,
          submissionId: confirmSub.id,
          mentorId: profile?.id
        })
      })
      
      const data = await res.json()
      
      if (!data.success) {
        toast.error(data.message || 'Failed to announce winner')
      } else {
        toast.success(`${confirmSub.users?.name || 'User'} announced as winner! Waiting for code delivery.`)
        await fetchData()
      }
    } catch (error) {
      toast.error('Network error during winner selection')
      console.error(error)
    }
    
    setSelectingWinner(false)
    setConfirmSub(null)
  }

  const handleApproveDelivery = async (submissionId) => {
    if (!submissionId) return
    setApproving(true)
    try {
      const res = await fetch('/approve-delivery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: id,
          submissionId: submissionId,
          mentorId: profile?.id
        })
      })
      const data = await res.json()
      if (data.success) {
        toast.success(data.message || 'Payment released successfully!')
        setShowApproveConfirmModal(false)
        setPendingApprovalId(null)
        await fetchData()
      } else {
        toast.error(data.message)
      }
    } catch (err) {
      toast.error('Network error while approving delivery.')
    } finally {
      setApproving(false)
    }
  }

  const handleDownload = async (submissionId) => {
    try {
      const res = await fetch(`/api/submissions/${submissionId}/download?userId=${profile?.id}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Download failed')
      }
      const anchor = document.createElement('a')
      anchor.href = data.url
      anchor.download = `project-${submissionId.slice(0, 6)}.zip`
      anchor.target = '_blank'
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
    } catch (error) {
      toast.error(error.message || 'Failed to download submission')
    }
  }

  const handleStartSandbox = async (submission) => {
    if (pendingSandboxRequests.has(submission.id)) {
      console.log(`[Frontend] Sandbox request already pending for ${submission.id}`)
      return
    }
    pendingSandboxRequests.add(submission.id)
    setStartingSandbox(true)
    try {
      const res = await fetch('/start-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          submissionId: submission.id,
          mentorId: profile?.id
        })
      })
      const data = await res.json()
      if (!data.success) {
        toast.error(data.message || 'Failed to start sandbox')
      } else {
        toast.success(data.message || 'Sandbox restart queued')
        await fetchData()
      }
    } catch {
      toast.error('Network error while starting sandbox')
    } finally {
      pendingSandboxRequests.delete(submission.id)
      setStartingSandbox(false)
    }
  }

  const handlePauseReview = async (submissionId) => {
    setPausingDelivery(true)
    try {
      const res = await fetch(`/api/submissions/${submissionId}/pause-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mentorId: profile?.id,
          reason: pauseForm.reason,
          category: pauseForm.category,
          durationHours: pauseForm.durationHours
        })
      })
      const data = await res.json()
      if (!data.success) {
        toast.error(data.message || 'Failed to pause review')
      } else {
        toast.success(`Review paused for ${pauseForm.durationHours} hours`)
        setShowPauseModal(false)
        setPauseForm({ reason: '', category: 'clarification_needed', durationHours: 24 })
        await fetchData()
      }
    } catch {
      toast.error('Network error while pausing review')
    } finally {
      setPausingDelivery(false)
    }
  }

  const handleSaveMentorCorrection = async () => {
    if (!winningSub?.id || !profile?.id) return
    const text = mentorCorrectionDraft.trim()
    if (!text) {
      toast.error('Enter correction or feedback text before saving.')
      return
    }
    setSavingMentorCorrection(true)
    try {
      const res = await fetch(`/api/submissions/${winningSub.id}/mentor-latest-correction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mentorId: profile.id, correction: text })
      })
      const data = await res.json()
      if (data.success) {
        toast.success('Correction saved — the developer will see it on their workspace.')
        await fetchData()
      } else {
        toast.error(data.message || 'Failed to save')
      }
    } catch {
      toast.error('Network error while saving correction')
    } finally {
      setSavingMentorCorrection(false)
    }
  }

  // ─── REVIEW QA HANDLERS ───

  const handleTestRevision = async (revisionNumber) => {
    if (!winningSub) return
    setTestingRevision(true)
    try {
      const res = await fetch(`/api/submissions/${winningSub.id}/test-revision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mentorId: profile?.id, revisionNumber })
      })
      const data = await res.json()
      if (!data.success) {
        toast.error(data.message || 'Failed to start revision test')
      } else {
        toast.success(data.message || 'Revision queued for sandbox testing')
        setReviewSandboxStatus({ active: true, status: 'queued', revision: data.revision, previewUrl: data.previewUrl })
        setReviewModalTab('preview')
        setReviewLogShowRaw(false)
        setShowReviewPreview(true)
      }
    } catch {
      toast.error('Network error while starting revision test')
    } finally {
      setTestingRevision(false)
    }
  }

  const handleStopReviewSandbox = async () => {
    if (!winningSub || !reviewSandboxStatus.revision) return
    try {
      await fetch(`/api/submissions/${winningSub.id}/stop-review-sandbox`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mentorId: profile?.id, revisionNumber: reviewSandboxStatus.revision })
      })
      setReviewSandboxStatus({ active: false, status: 'idle', revision: null, previewUrl: null })
      setShowReviewPreview(false)
      toast.success('Review sandbox stopped')
    } catch {
      toast.error('Failed to stop review sandbox')
    }
  }

  const handleSaveNote = async (revisionId) => {
    if (!noteText.trim()) return
    setSavingNote(true)
    try {
      const res = await fetch(`/api/revisions/${revisionId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mentorId: profile?.id, note: noteText, submissionId: winningSub?.id })
      })
      const data = await res.json()
      if (data.success) {
        // Refresh notes for this revision
        const notesRes = await fetch(`/api/revisions/${revisionId}/notes`)
        const notesData = await notesRes.json()
        setRevisionNotes(prev => ({ ...prev, [revisionId]: notesData.notes || [] }))
        setNoteText('')
        setEditingNoteFor(null)
        toast.success('Note saved')
      } else {
        toast.error(data.message || 'Failed to save note')
      }
    } catch {
      toast.error('Failed to save note')
    } finally {
      setSavingNote(false)
    }
  }

  // Poll isolated review build logs while preview modal is open
  useEffect(() => {
    if (!showReviewPreview || !winningSub?.id || reviewSandboxStatus.revision == null) return
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch(`/api/submissions/${winningSub.id}/review-logs/${reviewSandboxStatus.revision}`)
        const data = await res.json()
        if (!cancelled && data.success) setReviewModalLogs(data.logs || [])
      } catch { /* ignore */ }
    }
    load()
    const iv = setInterval(load, 2000)
    return () => { cancelled = true; clearInterval(iv) }
  }, [showReviewPreview, winningSub?.id, reviewSandboxStatus.revision])

  // Poll review sandbox status while active
  useEffect(() => {
    if (!winningSub) return
    const activeCheck = reviewSandboxStatus.active
    if (!activeCheck) return
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/submissions/${winningSub.id}/review-sandbox-status`)
        const data = await res.json()
        if (data.success) {
          setReviewSandboxStatus({
            active: data.active,
            status: data.status,
            revision: data.revision,
            previewUrl: data.previewUrl
          })
          if (!data.active) {
            fetchData()
            clearInterval(interval)
          }
        }
      } catch { /* ignore */ }
    }, 3000)
    return () => clearInterval(interval)
  }, [winningSub?.id, reviewSandboxStatus.active])

  // Fetch notes for all revisions on load
  useEffect(() => {
    if (submissionRevisions.length === 0) return
    const fetchNotes = async () => {
      const notesMap = {}
      for (const rev of submissionRevisions) {
        if (!isPersistedRevisionRowId(rev.id)) continue
        try {
          const res = await fetch(`/api/revisions/${rev.id}/notes`)
          const data = await res.json()
          if (data.success) notesMap[rev.id] = data.notes || []
        } catch { /* ignore */ }
      }
      setRevisionNotes(notesMap)
    }
    fetchNotes()
  }, [submissionRevisions])

  if (loading) {
    return (
      <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-[#131b2c] via-[#050505] to-black flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-white/10 border-t-ice-500 rounded-full animate-spin" />
          <p className="text-sm font-bold tracking-widest text-slate-500 uppercase">Loading submissions...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen w-full relative overflow-hidden bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-[#131b2c] via-[#050505] to-black">
      <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 brightness-100 contrast-150 pointer-events-none mix-blend-overlay" />
      <Navbar />

      <div className="relative max-w-7xl mx-auto px-6 py-12 flex gap-8">
        
        {/* Main Content Area */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex items-center justify-between mb-8">
            <div>
              <button onClick={() => navigate('/dashboard')} className="text-sm font-medium text-slate-400 hover:text-white transition-colors flex items-center gap-2 mb-4 group">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 group-hover:-translate-x-1 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
                Back to Dashboard
              </button>
              <h1 className="text-3xl font-black text-white tracking-tight flex items-center gap-3">
                Task Submissions
                {hasWinner && <span className="px-3 py-1 rounded-full bg-slate-800 border border-slate-700 text-slate-400 text-xs tracking-widest uppercase font-bold">Closed</span>}
              </h1>
              <p className="text-slate-400 mt-2 font-medium">{task?.title}</p>
            </div>
            <div className="flex flex-col items-end">
              <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-slate-500 mb-1">Total Submissions</span>
              <span className="text-3xl font-black text-white">{submissions.length}</span>
            </div>
          </div>

          {/* Winner Delivery Workflow Section */}
          {winningSub && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              className="w-full bg-slate-900/50 backdrop-blur-md border border-white/10 rounded-2xl p-6 mb-8 shadow-2xl relative overflow-hidden"
            >
              <div className="absolute -right-20 -top-20 w-64 h-64 bg-amber-500/10 blur-3xl rounded-full" />
              <div className="flex items-center justify-between relative z-10">
                <div className="flex items-center gap-5">
                  <div className="w-14 h-14 rounded-full bg-gradient-to-tr from-amber-500 to-amber-300 flex items-center justify-center text-black text-2xl shadow-[0_0_20px_rgba(245,158,11,0.4)]">
                    🏆
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-white flex items-center gap-2">
                      Winner: {winningSub.users?.name || 'Developer'}
                    </h3>
                    <p className="text-sm text-slate-400 mt-1">
                      {winningSub.delivery_status === 'pending' && "Waiting for developer to submit final code snapshot."}
                      {winningSub.delivery_status === 'submitted' && winningSub.review_hold_status !== 'paused' && "Final code submitted! Please review the frozen snapshot and approve to release funds."}
                      {winningSub.delivery_status === 'approved' && "Delivery Approved. Funds have been credited to the developer."}
                      {winningSub.review_hold_status === 'paused' && `Review paused${winningSub.review_hold_reason ? `: ${winningSub.review_hold_reason}` : '.'}`}
                    </p>
                    {(winningSub.review_hold_status === 'paused' || winningSub.review_hold_status === 'responded') && (
                      <div className="mt-2 flex items-center gap-2 flex-wrap">
                        {winningSub.review_hold_status === 'paused' && (
                          <span className="inline-flex px-2.5 py-1 rounded border border-amber-500/30 bg-amber-500/10 text-amber-400 text-[10px] font-bold uppercase tracking-wider">
                            ⏸ Review Hold Active
                          </span>
                        )}
                        {winningSub.review_hold_status === 'responded' && (
                          <span className="inline-flex px-2.5 py-1 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-[10px] font-bold uppercase tracking-wider">
                            ✓ Developer Responded
                          </span>
                        )}
                        {winningSub.review_hold_status === 'paused' && winningSub.review_hold_expires_at && (
                          <span className="text-[10px] text-slate-500">
                            Expires: {new Date(winningSub.review_hold_expires_at).toLocaleString()}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                
                <div className="flex items-center gap-3">
                  <button onClick={() => setActiveChatParticipantId(winningSub.user_id)} className="px-5 py-2.5 rounded-xl border border-white/10 hover:bg-white/5 text-white font-semibold transition-all text-sm flex items-center gap-2 group">
                    <svg className="w-4 h-4 text-slate-400 group-hover:text-emerald-400 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                    Chat
                  </button>

                  <button onClick={() => setViewSub(winningSub)} className="px-5 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white font-semibold transition-all text-sm flex items-center gap-2">
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    View Project
                  </button>

                  {['submitted', 'approved'].includes(winningSub.delivery_status) && (
                    <button 
                      onClick={() => handleDownload(winningSub.id)}
                      className="px-5 py-2.5 rounded-xl bg-violet-500/20 hover:bg-violet-500/30 border border-violet-500/30 text-violet-400 font-semibold transition-all text-sm flex items-center gap-2 group relative"
                    >
                      <svg className="w-4 h-4 group-hover:-translate-y-0.5 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                      Download Project
                      <span className="absolute -bottom-10 left-1/2 -translate-x-1/2 w-max bg-black text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">Download final submitted code</span>
                    </button>
                  )}

                  {winningSub.delivery_status === 'submitted' && (
                    <button 
                      onClick={() => {
                        setPendingApprovalId(winningSub.id)
                        setShowApproveConfirmModal(true)
                      }} 
                      disabled={approving}
                      className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white font-bold transition-all shadow-[0_0_15px_rgba(16,185,129,0.3)] text-sm flex items-center gap-2 disabled:opacity-50"
                    >
                      Confirm Code Received
                    </button>
                  )}
                  {['pending', 'submitted'].includes(winningSub.delivery_status) && (
                    <button
                      onClick={() => setShowPauseModal(true)}
                      disabled={pausingDelivery}
                      className="px-5 py-2.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 text-amber-400 font-semibold transition-all text-sm disabled:opacity-50"
                      title={'Pause to request clarification'}
                    >
                      {pausingDelivery ? 'Pausing...' : 'Pause Review'}
                    </button>
                  )}
                  {winningSub.delivery_status === 'approved' && (
                    <span className="px-5 py-2.5 rounded-xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 font-bold text-sm flex items-center gap-2">
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                      Payment Released
                    </span>
                  )}
                </div>
              </div>

              {winningSub.delivery_status !== 'approved' && (
                <div className="mt-6 border-t border-white/10 pt-6 relative z-10 space-y-3">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">Correction / feedback (shown to developer)</label>
                  <textarea
                    value={mentorCorrectionDraft}
                    onChange={e => setMentorCorrectionDraft(e.target.value)}
                    rows={3}
                    className="w-full px-4 py-3 rounded-xl bg-black/30 border border-white/10 text-white text-sm focus:outline-none focus:ring-1 focus:ring-amber-500/30 placeholder:text-slate-600"
                    placeholder="Update what the developer should fix or clarify..."
                  />
                  <button
                    type="button"
                    onClick={handleSaveMentorCorrection}
                    disabled={savingMentorCorrection}
                    className="px-4 py-2 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 text-xs font-bold uppercase tracking-wider disabled:opacity-50"
                  >
                    {savingMentorCorrection ? 'Saving...' : 'Save correction'}
                  </button>
                </div>
              )}

              {/* ═══ ENHANCED REVISION HISTORY & QA PANEL ═══ */}
              {winningSub.delivery_status !== 'approved' && (
                <div className="mt-6 border-t border-white/10 pt-6 relative z-10">
                  {/* Header with count + Test button */}
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                      Revision History
                      <span className="px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-400 text-[10px] font-bold ml-1">
                        {submissionRevisions.length + 1} files
                      </span>
                    </h4>
                    <div className="flex items-center gap-2">
                      {/* Review Sandbox Status Indicator */}
                      {reviewSandboxStatus.active && (
                        <span className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-wider ${
                          reviewSandboxStatus.status === 'running' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                          'bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse'
                        }`}>
                          {reviewSandboxStatus.status === 'running' ? '● Review Sandbox Live' : `⏳ ${reviewSandboxStatus.status}...`}
                        </span>
                      )}
                      {/* Test Latest in Sandbox */}
                      {submissionRevisions.some(r => r.artifact_url && r.artifact_url !== 'text-only-response') && (
                        <button
                          onClick={() => handleTestRevision()}
                          disabled={testingRevision || reviewSandboxStatus.active}
                          className="px-3 py-1.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/30 text-cyan-400 text-[11px] font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                          title={reviewSandboxStatus.active ? 'Sandbox already running' : 'Test latest revision in isolated sandbox'}
                        >
                          {testingRevision ? <div className="w-3 h-3 border-2 border-cyan-400/30 border-t-cyan-400 rounded-full animate-spin" /> : '🧪'}
                          {reviewSandboxStatus.active ? 'Sandbox Running...' : 'Test Latest in Sandbox'}
                        </button>
                      )}
                      {reviewSandboxStatus.active && reviewSandboxStatus.status === 'running' && (
                        <>
                          <button onClick={() => setShowReviewPreview(true)} className="px-3 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 text-emerald-400 text-[11px] font-bold transition-all flex items-center gap-1.5">
                            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                            View Preview
                          </button>
                          <button onClick={handleStopReviewSandbox} className="px-3 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/30 text-rose-400 text-[11px] font-bold transition-all flex items-center gap-1.5">
                            ■ Stop
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="space-y-3">
                    {/* Original Submission (v0) */}
                    <div className="flex items-start justify-between bg-black/40 p-4 rounded-xl border border-white/5 hover:border-white/10 transition-colors">
                      <div className="flex-1 pr-4">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="px-2 py-0.5 rounded bg-violet-500/20 text-violet-400 text-[10px] font-bold tracking-wider">📦 Original Submission</span>
                          <span className="text-xs text-slate-500">{winningSub.created_at ? new Date(winningSub.created_at).toLocaleString() : ''}</span>
                        </div>
                        <p className="text-xs text-slate-500 mt-1">Initial project submission — base version for review</p>
                      </div>
                      {(winningSub.source_zip_url || winningSub.zip_url) && (
                        <button onClick={() => handleDownload(winningSub.id)} className="flex-shrink-0 px-3 py-1.5 rounded-lg bg-violet-500/20 hover:bg-violet-500/30 border border-violet-500/30 text-violet-400 text-xs font-semibold flex items-center gap-2 transition-all">
                          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                          Download ZIP
                        </button>
                      )}
                    </div>

                    {/* Revision Cards */}
                    {submissionRevisions.map(rev => {
                      const hasArtifact = rev.artifact_url && rev.artifact_url !== 'text-only-response'
                      const notes = revisionNotes[rev.id] || []
                      const sandboxMeta = rev.sandbox_status || 'idle'
                      const rawMsg = (rev.clarification_message || rev.review_response_message || '').trim()
                      const autoZipOnlyMsg = 'Revised project ZIP uploaded.'
                      const showEmployeeMessage =
                        rawMsg.length > 0 && !(rawMsg === autoZipOnlyMsg && hasArtifact)

                      return (
                        <div key={rev.id} className="bg-black/40 p-4 rounded-xl border border-white/5 hover:border-white/10 transition-colors">
                          <div className="flex items-start justify-between">
                            <div className="flex-1 pr-4">
                              <div className="flex items-center gap-2 mb-2 flex-wrap">
                                <span className="px-2 py-0.5 rounded bg-sky-500/20 text-sky-400 text-[10px] font-bold tracking-wider">Revision v{rev.revision_number}</span>
                                <span className="text-xs text-slate-500">{new Date(rev.created_at).toLocaleString()}</span>
                                {/* Sandbox status badge */}
                                {sandboxMeta !== 'idle' && (
                                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${
                                    sandboxMeta === 'running' ? 'bg-emerald-500/10 text-emerald-400' :
                                    sandboxMeta === 'failed' ? 'bg-rose-500/10 text-rose-400' :
                                    sandboxMeta === 'expired' ? 'bg-slate-500/10 text-slate-400' :
                                    'bg-amber-500/10 text-amber-400'
                                  }`}>
                                    {sandboxMeta}
                                  </span>
                                )}
                                {!hasArtifact && <span className="px-1.5 py-0.5 rounded bg-slate-500/10 text-slate-500 text-[9px] font-bold">text only</span>}
                              </div>
                              {showEmployeeMessage && (
                                <div className="mb-3 mt-0.5">
                                  <p className="text-sm text-slate-200 whitespace-pre-wrap leading-relaxed">
                                    {rawMsg}
                                  </p>
                                </div>
                              )}
                              {/* Error diagnostics from build */}
                              {rev.error_category && (
                                <div className="mt-2 p-3 rounded-lg bg-rose-500/5 border border-rose-500/10">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-400 text-[9px] font-bold uppercase">{rev.error_category.replace('_', ' ')}</span>
                                  </div>
                                  {rev.error_suggestion && <p className="text-xs text-rose-300/80 mt-1">{rev.error_suggestion}</p>}
                                </div>
                              )}
                            </div>
                            <div className="flex flex-col gap-2 flex-shrink-0">
                              {hasArtifact && (
                                <>
                                  <a href={rev.artifact_url} target="_blank" rel="noreferrer" className="px-3 py-1.5 rounded-lg bg-sky-500/20 hover:bg-sky-500/30 border border-sky-500/30 text-sky-400 text-xs font-semibold flex items-center gap-2 transition-all">
                                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                                    📎 ZIP
                                  </a>
                                  <button
                                    onClick={() => handleTestRevision(rev.revision_number)}
                                    disabled={testingRevision || reviewSandboxStatus.active}
                                    className="px-3 py-1.5 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/20 text-cyan-400 text-xs font-semibold flex items-center gap-1.5 transition-all disabled:opacity-30"
                                    title="Test this specific revision in sandbox"
                                  >
                                    🧪 Test
                                  </button>
                                </>
                              )}
                              {isPersistedRevisionRowId(rev.id) && (
                                <button
                                  onClick={() => { setEditingNoteFor(editingNoteFor === rev.id ? null : rev.id); setNoteText('') }}
                                  className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 hover:text-white text-xs font-semibold flex items-center gap-1.5 transition-all"
                                >
                                  📝 {notes.length > 0 ? `Notes (${notes.length})` : 'Add Note'}
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Mentor Notes Section (only for real revision rows in DB) */}
                          {isPersistedRevisionRowId(rev.id) && (notes.length > 0 || editingNoteFor === rev.id) && (
                            <div className="mt-3 pt-3 border-t border-white/5">
                              {notes.length > 0 && (
                                <div className="space-y-2 mb-3">
                                  {notes.map(n => (
                                    <div key={n.id} className="flex items-start gap-2 bg-amber-500/5 p-2.5 rounded-lg border border-amber-500/10">
                                      <span className="text-amber-400 text-xs mt-0.5">📋</span>
                                      <div className="flex-1">
                                        <p className="text-xs text-slate-300">{n.note}</p>
                                        <p className="text-[10px] text-slate-600 mt-1">{new Date(n.created_at).toLocaleString()}</p>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                              {editingNoteFor === rev.id && (
                                <div className="flex gap-2 items-end">
                                  <textarea
                                    value={noteText}
                                    onChange={e => setNoteText(e.target.value)}
                                    rows={3}
                                    placeholder="Add QA observation..."
                                    className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-xs focus:outline-none focus:ring-1 focus:ring-amber-500/30 placeholder:text-slate-600 resize-y min-h-[4rem]"
                                  />
                                  <button
                                    onClick={() => handleSaveNote(rev.id)}
                                    disabled={savingNote || !noteText.trim()}
                                    className="px-3 py-2 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 text-amber-400 text-xs font-bold transition-all disabled:opacity-40"
                                  >
                                    {savingNote ? '...' : 'Save'}
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {/* Submissions List */}
          <div className="grid gap-4">
            <AnimatePresence>
              {submissions.length === 0 ? (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="py-20 text-center border border-dashed border-white/10 rounded-3xl bg-white/5">
                  <div className="text-4xl mb-4">👀</div>
                  <h3 className="text-lg font-bold text-white">No submissions yet</h3>
                  <p className="text-slate-500 text-sm mt-1">Waiting for developers to complete the task.</p>
                </motion.div>
              ) : (
                submissions.map((sub, index) => {
                  const colors = getScoreColor(sub.score || 0)
                  const rep = reputations[sub.user_id]
                  return (
                    <motion.div key={sub.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }}
                      className={`group relative overflow-hidden rounded-2xl border transition-all duration-300 flex flex-col
                        ${sub.is_winner ? 'bg-amber-500/5 border-amber-500/30 shadow-[0_0_30px_rgba(245,158,11,0.05)]' : 'bg-black/40 border-white/10 hover:bg-white/5 hover:border-white/20'}`}
                    >
                      <div className="p-6 flex items-center gap-6">
                        
                        {/* Score Circle */}
                        <div className="relative w-16 h-16 flex-shrink-0">
                          <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
                            <circle cx="60" cy="60" r="50" fill="#050505" stroke="rgba(255,255,255,0.05)" strokeWidth="8" />
                            <circle cx="60" cy="60" r="50" fill="none" stroke={colors.ring} strokeWidth="8" strokeLinecap="round" strokeDasharray={2 * Math.PI * 50} strokeDashoffset={2 * Math.PI * 50 * (1 - (sub.score || 0) / 100)} className="transition-all duration-1000 ease-out" />
                          </svg>
                          <div className="absolute inset-0 flex items-center justify-center flex-col">
                            <span className={`text-lg font-black leading-none ${colors.text}`}>{sub.score}</span>
                          </div>
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-3 mb-1">
                            <h3 className="text-lg font-bold text-white truncate">{sub.users?.name || 'Developer'}</h3>
                            <div className="flex items-center gap-2">
                              {(() => {
                                const statusMeta = getBuildStatusMeta(sub.build_status)
                                return (
                                  <span className={`px-2.5 py-0.5 rounded border text-[10px] font-bold uppercase tracking-wider ${statusMeta.cls}`}>
                                    {statusMeta.label}
                                  </span>
                                )
                              })()}
                              <span className="px-2.5 py-0.5 rounded bg-white/5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Attempt {sub.attempt_number || 1}</span>
                              <span className="px-2.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-[10px] font-bold text-amber-500 uppercase tracking-wider">Finalized 🔒</span>
                            </div>
                          </div>
                          
                          {/* Reputation */}
                          <div className="flex items-center gap-4 text-xs font-medium">
                            <div className="flex items-center gap-1.5 text-amber-400">
                              <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                              {rep && typeof rep.rating === 'number' ? rep.rating.toFixed(1) : 'No rating'}
                            </div>
                            <div className="flex items-center gap-1.5 text-emerald-400">
                              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                              {rep && typeof rep.tasks_completed === 'number' ? `${rep.tasks_completed} Tasks` : '0 Tasks'}
                            </div>
                            <div className="text-slate-500">•</div>
                            <div className="text-slate-400">{new Date(sub.created_at).toLocaleDateString()}</div>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-3 flex-shrink-0">
                          <button onClick={() => setActiveChatParticipantId(sub.user_id)} className="px-4 py-2.5 rounded-xl bg-white/5 hover:bg-emerald-500/20 border border-white/10 hover:border-emerald-500/30 text-emerald-400 font-semibold transition-all text-sm flex items-center gap-2">
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                            Chat
                          </button>

                          <button onClick={() => setViewSub(sub)} className="px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white font-semibold transition-all text-sm flex items-center gap-2">
                            <svg className="w-4 h-4 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                            View Project
                          </button>

                          {!hasWinner && (
                            <button onClick={() => setConfirmSub(sub)} className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-bold transition-all shadow-[0_0_15px_rgba(245,158,11,0.2)] hover:shadow-[0_0_20px_rgba(245,158,11,0.4)] text-sm flex items-center gap-2">
                              🏆 Announce Winner
                            </button>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  )
                })
              )}
            </AnimatePresence>
          </div>
        </div>

      </div>

      {/* Chat Slide-Over Modal */}
      <AnimatePresence>
        {activeChatParticipantId && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[200] flex justify-end bg-black/60 backdrop-blur-sm" onClick={(e) => e.target === e.currentTarget && setActiveChatParticipantId(null)}>
            <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', bounce: 0, duration: 0.4 }} className="w-[400px] h-full bg-white shadow-2xl flex flex-col relative">
              <button onClick={() => setActiveChatParticipantId(null)} className="absolute top-4 right-4 w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 z-50">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
              <div className="flex-1 overflow-hidden">
                <ChatPanel taskId={id} participantId={activeChatParticipantId} mentorId={task.mentor_id} />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <ProjectViewerModal
        isOpen={!!viewSub}
        onClose={() => setViewSub(null)}
        submission={viewSub}
        onConfirmCode={(subId) => { setPendingApprovalId(subId); setShowApproveConfirmModal(true); setViewSub(null) }}
        onDownload={handleDownload}
        onStartSandbox={handleStartSandbox}
        startingSandbox={startingSandbox}
        confirming={approving}
      />
      <ConfirmModal isOpen={!!confirmSub} onClose={() => setConfirmSub(null)} onConfirm={handleSelectWinner} userName={confirmSub?.users?.name} loading={selectingWinner} />

      {/* ─── Approve Delivery Confirmation Modal ─── */}
      <AnimatePresence>
        {showApproveConfirmModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[250] flex items-center justify-center p-4 shadow-2xl">
            <div className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={() => !approving && setShowApproveConfirmModal(false)} />
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              className="relative bg-[#0a0a0a] border border-white/10 rounded-2xl p-8 max-w-md w-full shadow-2xl overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1 bg-emerald-500" />
              <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto mb-6">
                <svg className="w-8 h-8 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
              </div>
              <h3 className="text-xl font-bold text-white text-center mb-2">Confirm Code Received?</h3>
              <p className="text-sm text-slate-400 text-center mb-6 leading-relaxed">
                By confirming, the payment will be <span className="text-emerald-400 font-bold text-lg">released immediately</span> to the developer.
              </p>
              
              <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4 mb-6">
                <p className="text-xs text-amber-200/80 leading-relaxed italic">
                  <strong>Tip:</strong> If you need any clarification or want bugs fixed first, use <strong>Pause Review</strong> instead.
                </p>
                <p className="text-[10px] text-slate-500 mt-2">
                  * Note: If you take no action, payment will release automatically 48h after submission.
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  disabled={approving}
                  onClick={() => setShowApproveConfirmModal(false)}
                  className="flex-1 py-3 rounded-xl bg-white/5 text-sm font-bold text-slate-400 hover:bg-white/10 border border-white/10 transition-all disabled:opacity-50"
                >
                  Go Back
                </button>
                <button
                  disabled={approving}
                  onClick={() => handleApproveDelivery(pendingApprovalId)}
                  className="flex-1 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white text-sm font-black shadow-lg shadow-emerald-500/20 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {approving ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : 'Confirm Release'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Pause Review Modal ─── */}
      <AnimatePresence>
        {showPauseModal && winningSub && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] flex items-center justify-center p-4"
            onClick={(e) => e.target === e.currentTarget && setShowPauseModal(false)}>
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              className="relative bg-[#0a0a0a] border border-white/10 rounded-2xl p-8 max-w-lg w-full shadow-2xl">
              <div className="w-14 h-14 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto mb-5">
                <span className="text-2xl">⏸</span>
              </div>
              <h3 className="text-xl font-bold text-white text-center mb-1">Pause Review</h3>
              <p className="text-sm text-slate-400 text-center mb-6">Request clarification from the developer. The 48h payment deadline will be paused.</p>

              <div className="space-y-4">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5 block">Category</label>
                  <select
                    value={pauseForm.category}
                    onChange={e => setPauseForm(f => ({ ...f, category: e.target.value }))}
                    className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500/50 transition-all"
                  >
                    <option className="bg-[#131b2c] text-white" value="clarification_needed">Clarification Needed</option>
                    <option className="bg-[#131b2c] text-white" value="code_quality">Code Quality Issue</option>
                    <option className="bg-[#131b2c] text-white" value="missing_feature">Missing Feature</option>
                    <option className="bg-[#131b2c] text-white" value="bug_found">Bug Found</option>
                    <option className="bg-[#131b2c] text-white" value="other">Other</option>
                  </select>
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5 block">
                    Hold Duration: {pauseForm.durationHours}h
                  </label>
                  <input
                    type="range" min="1" max="48" step="1"
                    value={pauseForm.durationHours}
                    onChange={e => setPauseForm(f => ({ ...f, durationHours: parseInt(e.target.value) }))}
                    className="w-full accent-amber-500"
                  />
                  <div className="flex justify-between text-[10px] text-slate-600 mt-1">
                    <span>1h</span><span>24h</span><span>48h</span>
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5 block">Reason</label>
                  <textarea
                    value={pauseForm.reason}
                    onChange={e => setPauseForm(f => ({ ...f, reason: e.target.value }))}
                    placeholder="Describe what the developer needs to fix or clarify..."
                    rows={3}
                    className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500/50 transition-all resize-none placeholder:text-slate-600"
                  />
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    onClick={() => setShowPauseModal(false)}
                    className="flex-1 py-3 rounded-xl bg-white/5 text-sm font-bold text-slate-400 hover:bg-white/10 border border-white/10 transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handlePauseReview(winningSub.id)}
                    disabled={pausingDelivery || !pauseForm.reason.trim()}
                    className="flex-1 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-black text-sm font-black shadow-lg shadow-amber-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {pausingDelivery ? <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" /> : 'Pause Review'}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ═══ REVIEW SANDBOX PREVIEW MODAL ═══ */}
      <AnimatePresence>
        {showReviewPreview && reviewSandboxStatus.active && winningSub && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[250] flex items-center justify-center p-4"
            onClick={(e) => e.target === e.currentTarget && setShowReviewPreview(false)}>
            <div className="absolute inset-0 bg-black/80 backdrop-blur-md" />
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="relative w-full max-w-5xl h-[80vh] bg-[#0a0a0a] border border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-white/[0.02] flex-shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-lg">🧪</div>
                  <div>
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                      Review Sandbox
                      <span className="px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-400 text-[10px] uppercase tracking-wider font-bold">
                        v{reviewSandboxStatus.revision} • {reviewSandboxStatus.status}
                      </span>
                    </h3>
                    <p className="text-xs text-slate-500">Isolated mentor testing environment — does not affect employee preview</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  <div className="flex rounded-lg border border-white/10 overflow-hidden mr-1">
                    <button type="button" onClick={() => setReviewModalTab('preview')} className={`px-3 py-1.5 text-[10px] font-bold uppercase ${reviewModalTab === 'preview' ? 'bg-cyan-500/20 text-cyan-300' : 'text-slate-500 hover:text-slate-300'}`}>Preview</button>
                    <button type="button" onClick={() => setReviewModalTab('logs')} className={`px-3 py-1.5 text-[10px] font-bold uppercase ${reviewModalTab === 'logs' ? 'bg-violet-500/20 text-violet-300' : 'text-slate-500 hover:text-slate-300'}`}>Build logs</button>
                  </div>
                  {reviewSandboxStatus.previewUrl && (
                    <a href={reviewSandboxStatus.previewUrl} target="_blank" rel="noreferrer" className="text-[10px] font-bold text-sky-400 hover:text-sky-300 flex items-center gap-1">
                      Open in tab
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                    </a>
                  )}
                  <button onClick={handleStopReviewSandbox} className="px-3 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/30 text-rose-400 text-[11px] font-bold transition-all">
                    ■ Stop Sandbox
                  </button>
                  <button onClick={() => setShowReviewPreview(false)} className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-all">
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                  </button>
                </div>
              </div>
              {/* Content */}
              <div className="flex-1 relative bg-[#050505] min-h-0">
                {reviewModalTab === 'preview' && reviewSandboxStatus.status === 'running' && reviewSandboxStatus.previewUrl ? (
                  <iframe
                    src={reviewSandboxStatus.previewUrl}
                    className="w-full h-full border-none bg-white"
                    title="Review Preview"
                  />
                ) : reviewModalTab === 'preview' ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500 text-sm">
                    <div className="w-12 h-12 bg-white/5 rounded-2xl flex items-center justify-center mb-3">
                      <div className="w-6 h-6 border-2 border-cyan-400/30 border-t-cyan-400 rounded-full animate-spin" />
                    </div>
                    <p className="font-bold text-white mb-1">Building revision v{reviewSandboxStatus.revision}...</p>
                    <p className="text-xs text-slate-400">Status: {reviewSandboxStatus.status}</p>
                    <p className="text-[10px] text-slate-600 mt-2">Switch to Build logs for live output. This sandbox is isolated from the employee preview.</p>
                  </div>
                ) : (
                  <BuildLogDiagnosticsPanel
                    liveLogs={reviewModalLogs}
                    fallbackText=""
                    errorCategory={submissionRevisions.find(r => r.revision_number === reviewSandboxStatus.revision)?.error_category}
                    errorSuggestion={submissionRevisions.find(r => r.revision_number === reviewSandboxStatus.revision)?.error_suggestion}
                    showRawLogs={reviewLogShowRaw}
                    onToggleRaw={() => setReviewLogShowRaw(v => !v)}
                  />
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
