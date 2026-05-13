import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import JSZip from 'jszip'
import Tabs from '../components/Tabs'
import TaskDetails from '../components/TaskDetails'
import TerminalLogs from '../components/TerminalLogs'
import ChatPanel from '../components/ChatPanel'
import Button from '../components/Button'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { useToast } from '../components/Toast'
import { io as socketIO } from 'socket.io-client'

const socket = socketIO('/', { path: '/socket.io', transports: ['websocket', 'polling'] })

/**
 * Resolves preview URL — always returns a relative path usable from the browser.
 * Stable format: /preview/:submissionId (proxied through backend).
 */
function resolvePreviewUrl(url) {
  if (!url) return null
  // Already a relative proxy path — use as-is
  if (url.startsWith('/preview/')) return url
  // Legacy format: http://localhost:PORT — strip host, use relative /preview/ path
  // This handles old DB records that stored raw localhost URLs
  const match = url.match(/\/preview\/([a-f0-9-]+)/)
  if (match) return `/preview/${match[1]}`
  // Raw localhost:PORT legacy — cannot be directly used from browser, return null
  // so the UI shows "no preview available" instead of a white screen
  if (url.startsWith('http://localhost')) return null
  return url
}

/* ─── Preview Iframe with Auto-Retry, Heartbeat & Reconnect ─── */
function PreviewIframe({ previewUrl, submissionId }) {
  const [retryKey, setRetryKey] = useState(0)
  const [iframeLoaded, setIframeLoaded] = useState(false)
  const [timedOut, setTimedOut] = useState(false)
  const [retryCount, setRetryCount] = useState(0)
  const resolvedUrl = resolvePreviewUrl(previewUrl)

  // Auto-retry every 5s for up to 90s while iframe hasn't loaded.
  // After 90s without a load event, show the reconnect prompt instead.
  useEffect(() => {
    if (iframeLoaded || timedOut) return
    const interval = setInterval(() => {
      setRetryKey(k => k + 1)
      setRetryCount(c => c + 1)
    }, 5000)
    const timeout = setTimeout(() => {
      clearInterval(interval)
      setTimedOut(true)
    }, 90000)
    return () => { clearInterval(interval); clearTimeout(timeout) }
  }, [iframeLoaded, timedOut])

  // Heartbeat — tells the backend the user is actively viewing so the
  // container's inactivity timer resets and it isn't cleaned up early.
  useEffect(() => {
    if (!submissionId) return
    const interval = setInterval(() => {
      fetch(`/heartbeat/${submissionId}`).catch(() => {})
    }, 10000)
    return () => clearInterval(interval)
  }, [submissionId])

  const handleManualReconnect = () => {
    setTimedOut(false)
    setIframeLoaded(false)
    setRetryCount(0)
    setRetryKey(k => k + 1)
  }

  if (!resolvedUrl) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#0a0a0a]">
        <p className="text-sm text-slate-400">No preview available. Please re-upload your project.</p>
      </div>
    )
  }

  return (
    <div className="flex-1 relative bg-white">
      {/* Loading overlay — auto-retry spinner */}
      {!iframeLoaded && !timedOut && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-[#0a0a0a]">
          <div className="w-10 h-10 border-4 border-slate-700 border-t-sky-500 rounded-full animate-spin mb-4" />
          <p className="text-xs font-medium text-slate-400">App is booting... please wait</p>
          <p className="text-[10px] text-slate-600 mt-1">
            Auto-retry every 5s{retryCount > 0 ? ` · Attempt ${retryCount + 1}` : ''}
          </p>
        </div>
      )}
      {/* Timeout overlay with manual reconnect button */}
      {timedOut && !iframeLoaded && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-[#0a0a0a] gap-4">
          <div className="w-14 h-14 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
            <svg className="w-7 h-7 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
            </svg>
          </div>
          <div className="text-center">
            <p className="text-sm font-bold text-white">Preview is taking longer than expected</p>
            <p className="text-xs text-slate-400 mt-1">The app may still be initializing</p>
          </div>
          <button
            onClick={handleManualReconnect}
            className="px-5 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-2 shadow-[0_0_20px_rgba(14,165,233,0.3)]"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
            </svg>
            Reconnect Preview
          </button>
        </div>
      )}
      <iframe
        key={retryKey}
        src={resolvedUrl}
        className="absolute inset-0 w-full h-full border-0"
        title="Sandbox Preview"
        onLoad={() => { setIframeLoaded(true); setTimedOut(false) }}
      />
    </div>
  )
}

export default function TaskWorkspace() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const toast = useToast()
  
  const [task, setTask] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showChat, setShowChat] = useState(false)
  const [activeTab, setActiveTab] = useState('description')
  
  // Submission & Sandbox State
  const [submission, setSubmission] = useState(null)
  const [logs, setLogs] = useState([])
  const [uploading, setUploading] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const fileInputRef = useRef(null)
  const logsEndRef = useRef(null)

  // Review Hold & Local Validation State
  const [localValidation, setLocalValidation] = useState(null)
  const [showClarificationModal, setShowClarificationModal] = useState(false)
  const [clarificationMessage, setClarificationMessage] = useState('')
  const [clarificationFile, setClarificationFile] = useState(null)
  const [isSubmittingClarification, setIsSubmittingClarification] = useState(false)
  const [countdownText, setCountdownText] = useState('')
  const [mentorPanelExpanded, setMentorPanelExpanded] = useState(false)
  const [correctionUnread, setCorrectionUnread] = useState(false)
  const mentorFeedbackRef = useRef(null)

  const fetchTaskAndSubmission = useCallback(async () => {
    const { data: taskData } = await supabase.from('tasks').select('*').eq('id', id).single()
    if (taskData) setTask(taskData)

    if (profile?.id) {
      const { data: subData } = await supabase
        .from('submissions')
        .select('*')
        .eq('task_id', id)
        .eq('user_id', profile.id)
        .order('created_at', { ascending: false })
        .limit(1)

      if (subData && subData.length > 0) {
        setSubmission(subData[0])
      }
    }
    setLoading(false)
  }, [id, profile?.id])

  useEffect(() => {
    fetchTaskAndSubmission()
  }, [fetchTaskAndSubmission])

  // Socket.IO Logs & Status Management
  useEffect(() => {
    if (!submission?.id) return

    // Join room for real-time logs
    socket.emit('join', submission.id)

    const handleLog = (data) => {
      if (data.submissionId === submission.id) {
        setLogs(prev => {
          // Deduplicate: skip if the last line is identical (prevents double-emit on reconnect)
          if (prev.length > 0 && prev[prev.length - 1] === data.message) return prev
          return [...prev, data.message]
        })
        logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
      }
    }

    const handleInitialLogs = (data) => {
      if (data.submissionId === submission.id) {
        setLogs(data.logs)
      }
    }

    socket.on('log', handleLog)
    socket.on('initial-logs', handleInitialLogs)

    // Polling for status updates (DB changes)
    const statusInterval = setInterval(async () => {
      const { data } = await supabase
        .from('submissions')
        .select('build_status, preview_url, runtime_type, is_final, is_winner, review_hold_status, review_hold_reason, review_hold_expires_at, delivery_status, payment_status, mentor_latest_correction, mentor_latest_correction_at, error_category, error_suggestion')
        .eq('id', submission.id)
        .single()
      
      if (data && (
        data.build_status !== submission.build_status ||
        data.preview_url !== submission.preview_url ||
        data.review_hold_status !== submission.review_hold_status ||
        data.error_category !== submission.error_category ||
        data.error_suggestion !== submission.error_suggestion ||
        data.mentor_latest_correction !== submission.mentor_latest_correction ||
        data.mentor_latest_correction_at !== submission.mentor_latest_correction_at ||
        data.delivery_status !== submission.delivery_status
      )) {
        setSubmission(prev => ({ ...prev, ...data }))
      }
    }, 2000)

    return () => {
      socket.off('log', handleLog)
      socket.off('initial-logs', handleInitialLogs)
      clearInterval(statusInterval)
    }
  }, [submission?.id, submission?.build_status, submission?.preview_url])

  // Refresh when mentor updates review / correction (socket from server)
  useEffect(() => {
    if (!submission?.id) return
    const onHold = (payload) => {
      if (payload?.submissionId === submission.id) fetchTaskAndSubmission()
    }
    socket.on('review_hold_updated', onHold)
    return () => socket.off('review_hold_updated', onHold)
  }, [submission?.id, fetchTaskAndSubmission])

  // Mentor posted / updated correction — show indicator on bottom bar until acknowledged
  useEffect(() => {
    if (!submission?.id || !submission?.mentor_latest_correction_at) {
      setCorrectionUnread(false)
      return
    }
    const key = `mentorCorrectionSeen:${submission.id}`
    const seen = localStorage.getItem(key)
    if (seen !== submission.mentor_latest_correction_at) {
      setCorrectionUnread(true)
    } else {
      setCorrectionUnread(false)
    }
  }, [submission?.id, submission?.mentor_latest_correction_at])

  const acknowledgeMentorCorrection = useCallback(() => {
    if (!submission?.id) return
    const key = `mentorCorrectionSeen:${submission.id}`
    const at = submission.mentor_latest_correction_at || ''
    if (at) localStorage.setItem(key, at)
    setCorrectionUnread(false)
  }, [submission?.id, submission?.mentor_latest_correction_at])

  // Timer for Review Hold
  useEffect(() => {
    if (!submission?.review_hold_expires_at || submission?.review_hold_status !== 'paused') {
      setCountdownText('')
      return
    }
    const tick = () => {
      const remaining = new Date(submission.review_hold_expires_at).getTime() - Date.now()
      if (remaining <= 0) { setCountdownText('Expired'); return }
      const h = Math.floor(remaining / 3600000)
      const m = Math.floor((remaining % 3600000) / 60000)
      const s = Math.floor((remaining % 60000) / 1000)
      setCountdownText(`${h}h ${m}m ${s}s`)
    }
    tick()
    const iv = setInterval(tick, 1000)
    return () => clearInterval(iv)
  }, [submission])

  const validateZipLocally = async (file) => {
    try {
      const zip = new JSZip()
      const content = await zip.loadAsync(file)
      const files = Object.keys(content.files)
      
      const report = {
        name: file.name,
        size: (file.size / (1024 * 1024)).toFixed(2) + 'MB',
        filesCount: files.length,
        hasPackageJson: files.includes('package.json'),
        hasNodeModules: files.some(f => f.includes('node_modules/')),
        hasGit: files.some(f => f.includes('.git/')),
        hasBuild: files.some(f => f.includes('dist/') || f.includes('build/')),
        framework: 'unknown',
        warnings: [],
        errors: []
      }

      if (report.hasPackageJson) {
        const pkgContent = await content.files['package.json'].async('string')
        const pkg = JSON.parse(pkgContent)
        const deps = { ...pkg.dependencies, ...pkg.devDependencies }
        
        if (deps.next) report.framework = 'Next.js'
        else if (deps.vite || files.includes('vite.config.js') || files.includes('vite.config.ts')) report.framework = 'Vite'
        else if (deps.react) report.framework = 'React'
        else report.framework = 'Node.js'
      } else if (files.includes('index.html')) {
        report.framework = 'Static HTML'
      }

      if (!report.hasPackageJson && report.framework !== 'Static HTML') {
        report.errors.push('Missing package.json (required for Node.js projects)')
      }
      if (report.hasNodeModules) report.warnings.push('node_modules detected. Please exclude to speed up upload.')
      if (report.hasGit) report.warnings.push('.git directory detected. Please exclude.')
      if (report.hasBuild) report.warnings.push('Build folder detected. This will be ignored.')

      return report
    } catch (err) {
      console.error('Local validation error:', err)
      return { errors: ['Failed to read ZIP archive'] }
    }
  }

  const handleDrag = (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true)
    else if (e.type === 'dragleave') setDragActive(false)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files[0])
    }
  }

  const handleFileUpload = async (file) => {
    const winnerCanUploadRevisions = Boolean(
      submission?.is_winner &&
      submission?.delivery_status === 'submitted'
    )

    if (submission?.is_final && !winnerCanUploadRevisions && submission?.review_hold_status !== 'paused') {
      toast.error('Project already finalized. Re-uploading is disabled.')
      return
    }
    if (!file.name.endsWith('.zip')) {
      toast.error('Please upload a valid .zip file')
      return
    }
    if (file.size > 50 * 1024 * 1024) {
      toast.error('File size exceeds 50MB limit')
      return
    }

    // ─── Local Validation ───
    const report = await validateZipLocally(file)
    setLocalValidation(report)
    if (report.errors.length > 0) {
      toast.error(`Validation Failed: ${report.errors[0]}`)
      return
    }

    setUploading(true)
    // Clear old failed submission immediately so stale errors disappear (skip during winner revision ZIP flow)
    if (submission?.review_hold_status !== 'paused' && !winnerCanUploadRevisions) {
      setSubmission({ build_status: 'uploading' })
    }
    setLogs(prev => [...prev, `[Local] Validated ZIP: ${report.framework} detected.`])
    setLogs(prev => [...prev, 'Uploading ZIP to secure server...'])

    const formData = new FormData()
    formData.append('project', file)
    formData.append('taskId', id)
    formData.append('userId', profile.id)

    try {
      if (winnerCanUploadRevisions) {
        const fd = new FormData()
        fd.append('userId', profile.id)
        fd.append('message', 'Revised project ZIP uploaded.')
        fd.append('project', file)
        const res = await fetch(`/api/submissions/${submission.id}/respond-review`, { method: 'POST', body: fd })
        const data = await res.json()
        if (!data.success) throw new Error(data.message || 'Revision upload failed')
        toast.success('Revision ZIP sent to your mentor. It appears in their revision history.')
        await fetchTaskAndSubmission()
        return
      }

      const res = await fetch('/upload-project', {
        method: 'POST',
        body: formData
      })
      const data = await res.json()
      
      if (!data.success) {
        throw new Error(data.message || 'Upload failed')
      }
      
      // Set the new submission ID so polling picks it up
      if (submission?.review_hold_status !== 'paused' && !winnerCanUploadRevisions) {
        setSubmission({ id: data.submissionId, build_status: 'building' })
      } else {
        toast.success('Updated code artifact uploaded for review hold.')
      }
    } catch (err) {
      toast.error(`Error: ${err.message}`)
      if (submission?.review_hold_status !== 'paused' && !winnerCanUploadRevisions) {
        setSubmission(null)
        setLogs([])
      }
    } finally {
      setUploading(false)
    }
  }

  const handleClarificationSubmit = async () => {
    if (!clarificationMessage.trim() && !clarificationFile) {
      toast.error('Add a message for the mentor and/or attach a revised ZIP.')
      return
    }

    setIsSubmittingClarification(true)
    try {
      const formData = new FormData()
      formData.append('userId', profile.id)
      if (clarificationMessage.trim()) {
        formData.append('message', clarificationMessage.trim())
      }
      if (clarificationFile) {
        formData.append('project', clarificationFile)
      }

      const res = await fetch(`/api/submissions/${submission.id}/respond-review`, {
        method: 'POST',
        body: formData
      })
      const data = await res.json()

      if (data.success) {
        toast.success('Response sent. You can upload more revisions until the mentor confirms payment.')
        setClarificationMessage('')
        setClarificationFile(null)
        await fetchTaskAndSubmission()
      } else {
        toast.error(data.message || 'Failed to submit clarification.')
      }
    } catch (err) {
      console.error('Clarification Error:', err)
      toast.error(`Network error: ${err.message}`)
    } finally {
      setIsSubmittingClarification(false)
    }
  }

  const finalizeSubmission = async () => {
    if (!submission?.id) return
    
    try {
      // Mark submission as final — this is the actual "submit" action
      const { error } = await supabase.from('submissions').update({
        is_final: true,
        delivery_status: 'submitted',
        delivery_deadline: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
      }).eq('id', submission.id)

      if (error) throw error

      toast.success('Project submitted successfully! Mentor has been notified.')
      navigate('/dashboard')
    } catch (err) {
      toast.error(`Failed to submit: ${err.message}`)
    }
  }

  if (loading) {
    return (
      <div className="h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-ice-500/30 border-t-ice-500 rounded-full animate-spin" />
      </div>
    )
  }

  const isFinalized = submission?.is_final
  /** Sandbox not building / not running (includes finalized tasks where we still read build_status). */
  const buildAtRest = !submission || ['idle', 'failed', 'failed_permanently', 'stopped', 'expired'].includes(submission.build_status)
  /** Pre-finalize upload screen only — finalized winners use preview + bottom dock instead. */
  const isIdle = buildAtRest && !isFinalized

  const winnerRespondOpen = Boolean(
    submission?.is_final &&
    submission?.is_winner &&
    submission?.delivery_status === 'submitted'
  )
  const winnerApprovedView = Boolean(
    submission?.is_final &&
    submission?.is_winner &&
    submission?.delivery_status === 'approved'
  )

  // Helper to reset and allow re-upload
  const handleReUpload = () => {
    setSubmission(null)
    setLogs([])
  }

  const handleRetryPreview = () => {
    // Simply incrementing the retry key in the iframe component is handled by its own state
    // but we can force a fresh state here if needed
    setSubmission(prev => ({ ...prev, _retryKey: Date.now() }))
    toast.success('Retrying preview connection...')
  }

  const getStatusBadge = () => {
    const status = submission?.build_status || 'idle'
    const runtime = submission?.runtime_type
    
    const configs = {
      uploading:          { color: 'bg-blue-500',    text: 'Uploading ZIP...',         pulse: true },
      queued:             { color: 'bg-indigo-500',  text: 'Waiting in Queue...',      pulse: true },
      extracting:         { color: 'bg-sky-400',     text: 'Extracting Files...',      pulse: true },
      validating:         { color: 'bg-cyan-500',    text: 'Validating Project...',    pulse: true },
      building:           { color: 'bg-amber-500',   text: 'Building Container...',    pulse: true },
      starting:           { color: 'bg-orange-500',  text: 'Starting Runtime...',      pulse: true },
      health_check:       { color: 'bg-yellow-500',  text: 'Checking Health...',       pulse: true },
      running:            { color: 'bg-emerald-500', text: 'Live Preview',             pulse: false, shadow: true },
      failed:             { color: 'bg-rose-500',    text: 'Build Failed',             pulse: false },
      failed_permanently: { color: 'bg-rose-600',    text: 'Build Failed',             pulse: false },
      stopped:            { color: 'bg-slate-500',   text: 'Session Ended',            pulse: false },
      expired:            { color: 'bg-slate-500',   text: 'Session Expired',          pulse: false }
    }

    if (submission?.review_hold_status === 'paused') {
      return (
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse shadow-[0_0_8px_rgba(245,158,11,0.5)]" />
            <span className="text-[11px] font-bold text-amber-400 uppercase tracking-wider">
              Review Paused
            </span>
          </span>
          {countdownText && (
            <span className="px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-[9px] font-bold text-amber-400 font-mono">
              {countdownText}
            </span>
          )}
        </div>
      )
    }

    const config = configs[status] || { color: 'bg-slate-400', text: status }

    return (
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${config.color} ${config.pulse ? 'animate-pulse' : ''} ${config.shadow ? 'shadow-[0_0_10px_rgba(16,185,129,0.5)]' : ''}`} />
          <span className="text-[11px] font-bold text-white uppercase tracking-wider">
            {config.text}
          </span>
        </span>
        {runtime && (
          <span className="px-2 py-0.5 rounded bg-white/10 text-[9px] font-bold text-slate-300 uppercase">
            {runtime}
          </span>
        )}
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col bg-slate-50 overflow-hidden font-sans">
      {/* Navbar */}
      <header className="h-14 bg-[#0a0a0a] border-b border-white/10 flex items-center px-6 justify-between flex-shrink-0 z-20">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/dashboard')} className="text-slate-400 hover:text-white transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          </button>
          <div>
            <h1 className="text-sm font-bold text-white uppercase tracking-wider">{task?.title || 'Loading Task...'}</h1>
            <p className="text-[10px] font-medium text-slate-400 tracking-wide uppercase mt-0.5">
              Production Sandbox
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setShowChat(!showChat)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-2 border ${showChat ? 'bg-indigo-500 text-white border-indigo-500 shadow-lg shadow-indigo-500/20' : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10'}`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
            Mentor Chat
          </button>
          
          <Button 
            disabled={!submission || submission.build_status !== 'running' || isFinalized}
            onClick={finalizeSubmission}
            className={`h-8 text-xs font-bold uppercase tracking-wider transition-all ${isFinalized ? 'bg-emerald-500/20 text-emerald-500 border-emerald-500/30' : 'shadow-[0_0_15px_rgba(52,211,153,0.3)]'} disabled:opacity-50 disabled:shadow-none`}
          >
            {isFinalized ? 'Project Finalized' : 'Submit Project'}
          </Button>
        </div>
      </header>

      {/* Main Workspace Area */}
      <div className="flex-1 flex overflow-hidden">
        
        <div
          className="flex-1 flex flex-col bg-[#0a0a0a] overflow-hidden relative min-h-0"
          onDragEnter={winnerRespondOpen ? handleDrag : undefined}
          onDragLeave={winnerRespondOpen ? handleDrag : undefined}
          onDragOver={winnerRespondOpen ? handleDrag : undefined}
          onDrop={winnerRespondOpen ? handleDrop : undefined}
        >
          {/* TABS HEADER */}
          <Tabs 
            tabs={[
              { id: 'description', label: 'Description' },
              { id: 'logs', label: 'Terminal Logs' },
              { id: 'preview', label: 'Preview & Run' }
            ]}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
          />

          {/* TAB CONTENT AREA */}
          <div className="flex-1 min-h-0 overflow-hidden relative bg-[#0a0a0a]">
            {winnerRespondOpen && activeTab !== 'preview' && (
              <div className="absolute top-0 left-0 right-0 z-10 px-4 py-2 bg-amber-500/15 border-b border-amber-500/25 text-center">
                <p className="text-[11px] font-bold text-amber-200">
                  Mentor revision open — use the <span className="text-white">Respond to mentor</span> bar at the bottom to send ZIPs or messages.
                </p>
              </div>
            )}
            
            {/* DESCRIPTION TAB */}
            {activeTab === 'description' && (
              <div className={`absolute inset-0 overflow-y-auto custom-scrollbar p-6 ${winnerRespondOpen ? 'pt-14' : ''}`}>
                <TaskDetails task={task} />
              </div>
            )}

            {/* LOGS TAB */}
            {activeTab === 'logs' && (
              <div className={`absolute inset-0 p-4 flex flex-col gap-3 min-h-0 ${winnerRespondOpen ? 'pt-14' : ''}`}>
                {['failed', 'failed_permanently'].includes(submission?.build_status) && (submission?.error_suggestion || submission?.error_category) && (
                  <details className="flex-shrink-0 rounded-xl border border-amber-500/25 bg-amber-500/5 overflow-hidden">
                    <summary className="cursor-pointer px-4 py-3 text-xs font-bold text-amber-200 uppercase tracking-wider list-none flex items-center justify-between">
                      Common fixes
                      <span className="text-[10px] text-amber-400/70">What to try next</span>
                    </summary>
                    <div className="px-4 pb-3 space-y-2">
                      {submission.error_category && (
                        <p className="text-[10px] font-black uppercase tracking-wide text-rose-300/90">
                          {(submission.error_category || '').replace(/_/g, ' ')}
                        </p>
                      )}
                      {submission.error_suggestion && (
                        <p className="text-xs text-slate-200 leading-relaxed">{submission.error_suggestion}</p>
                      )}
                    </div>
                  </details>
                )}
                <div className="flex-1 min-h-0">
                  <TerminalLogs logs={logs} />
                </div>
              </div>
            )}

            {/* PREVIEW TAB */}
            {activeTab === 'preview' && (
              <div className="absolute inset-0 flex flex-col min-h-0">
                {isIdle && !isFinalized && (
                  <div className="flex-1 flex flex-col items-center justify-center p-8 bg-slate-50 overflow-y-auto">
                    <div className="max-w-md w-full text-center space-y-6">
                      <div className="w-20 h-20 mx-auto bg-white rounded-2xl shadow-xl shadow-slate-200/50 flex items-center justify-center border border-slate-100">
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-10 h-10 text-sky-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                      </div>
                      <div>
                        <h2 className="text-xl font-bold text-slate-800">Deploy to Sandbox</h2>
                        <p className="text-sm text-slate-500 mt-2 leading-relaxed">
                          Develop locally using your favorite IDE, then upload your project. We&apos;ll automatically build and run it in a secure Docker container.
                        </p>
                      </div>

                      <div 
                        className={`border-2 border-dashed rounded-3xl p-10 transition-all ${dragActive ? 'border-sky-500 bg-sky-50' : 'border-slate-300 hover:border-slate-400 bg-white'}`}
                        onDragEnter={handleDrag} onDragLeave={handleDrag} onDragOver={handleDrag} onDrop={handleDrop}
                      >
                        <input type="file" ref={fileInputRef} onChange={(e) => {
                          if (e.target.files) {
                            handleFileUpload(e.target.files[0])
                            setActiveTab('logs')
                          }
                        }} accept=".zip" className="hidden" />
                        <div className="flex flex-col items-center gap-4">
                          <div className="p-4 bg-slate-50 rounded-full">
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
                          </div>
                          <div>
                            <p className="text-sm font-bold text-slate-700">Drag & Drop your .zip here</p>
                            <p className="text-xs text-slate-400 mt-1">Supports Node.js, Next.js, Vite, and Static HTML</p>
                          </div>
                          <Button onClick={() => fileInputRef.current?.click()} loading={uploading} variant="outline" className="mt-2">
                            Browse Files
                          </Button>
                        </div>
                      </div>

                      {localValidation && (
                        <div className="p-5 rounded-2xl bg-white border border-slate-200 text-left shadow-sm">
                          <div className="flex items-center justify-between mb-3">
                            <h3 className="text-sm font-bold text-slate-800">Compatibility Report</h3>
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${localValidation.errors.length > 0 ? 'bg-rose-100 text-rose-600' : 'bg-emerald-100 text-emerald-600'}`}>
                              {localValidation.errors.length > 0 ? 'Incompatible' : 'Ready'}
                            </span>
                          </div>
                          <div className="grid grid-cols-2 gap-4 mb-4">
                            <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Detected Runtime</p>
                              <p className="text-sm font-black text-slate-800 mt-1">{localValidation.framework}</p>
                            </div>
                            <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Bundle Size</p>
                              <p className="text-sm font-black text-slate-800 mt-1">{localValidation.size}</p>
                            </div>
                          </div>
                          {localValidation.warnings.length > 0 && (
                            <div className="space-y-2">
                              {localValidation.warnings.map((w, i) => (
                                <p key={i} className="text-[11px] text-amber-600 flex items-start gap-2">
                                  <span className="mt-0.5">⚠</span> {w}
                                </p>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {submission?.build_status === 'failed' && (
                        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-left">
                          <p className="text-sm font-bold text-rose-700 flex items-center gap-2">
                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                            Build Failed
                          </p>
                          <p className="text-xs text-rose-600 mt-1">Check the Terminal Logs tab for more details.</p>
                        </div>
                      )}
                      
                      {submission?.build_status === 'stopped' && (
                        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-left">
                          <p className="text-sm font-bold text-amber-700 flex items-center gap-2">
                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                            Session Timeout
                          </p>
                          <p className="text-xs text-amber-600 mt-1">The sandbox session automatically stopped to conserve resources. Please re-upload to preview again.</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {winnerApprovedView && (
                  <div className="flex-1 flex flex-col items-center justify-center p-8 bg-slate-50 overflow-y-auto">
                    <div className="max-w-md w-full text-center space-y-6">
                      <div className="w-20 h-20 mx-auto bg-emerald-50 rounded-2xl shadow-xl shadow-emerald-200/50 flex items-center justify-center border border-emerald-100">
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-10 h-10 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                      </div>
                      <div>
                        <h2 className="text-xl font-bold text-slate-800">Congratulations, you&apos;re the winner!</h2>
                        <p className="text-sm text-slate-500 mt-2 leading-relaxed">
                          Your submission was approved and payment has been released to your wallet.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {!winnerApprovedView && !buildAtRest && (
                  <div className="flex-1 flex flex-col min-h-0">
                    <div className="h-10 bg-[#141414] border-b border-white/5 flex items-center justify-between px-4 flex-shrink-0">
                      {getStatusBadge()}
                      <div className="flex items-center gap-2">
                        {submission?.build_status === 'running' && (
                          <>
                            <a 
                              href={resolvePreviewUrl(submission.preview_url)} 
                              target="_blank" 
                              rel="noreferrer"
                              className="text-[10px] font-bold text-sky-400 hover:text-sky-300 flex items-center gap-1.5 bg-sky-500/10 px-2 py-1 rounded transition-colors"
                            >
                              Open in New Tab
                              <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                            </a>
                            <button
                              type="button"
                              onClick={handleRetryPreview}
                              className="text-[10px] font-bold text-sky-400 hover:text-sky-300 flex items-center gap-1.5 bg-sky-500/10 px-2 py-1 rounded transition-colors"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                              Retry Preview
                            </button>
                          </>
                        )}
                        {!isFinalized && (
                          <button
                            type="button"
                            onClick={handleReUpload}
                            className="text-[10px] font-bold text-amber-400 hover:text-amber-300 flex items-center gap-1.5 bg-amber-500/10 px-2 py-1 rounded transition-colors"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                            Re-upload
                          </button>
                        )}
                      </div>
                    </div>

                    {submission?.build_status === 'running' ? (
                      <PreviewIframe previewUrl={submission?.preview_url} submissionId={submission?.id} />
                    ) : (
                      <div className="flex-1 flex items-center justify-center bg-[#0a0a0a] min-h-0">
                        <div className="text-center space-y-4 px-4">
                          <div className="w-12 h-12 mx-auto border-4 border-slate-700 border-t-sky-500 rounded-full animate-spin" />
                          <p className="text-xs font-medium text-slate-400">
                            {submission?.build_status === 'queued' ? 'Waiting in job queue...' :
                             submission?.build_status === 'extracting' ? 'Extracting your ZIP archive...' :
                             submission?.build_status === 'validating' ? 'Detecting project runtime...' :
                             submission?.build_status === 'building' ? 'Building Docker container...' :
                             submission?.build_status === 'starting' ? 'Starting secure sandbox engine...' :
                             submission?.build_status === 'health_check' ? 'Running health check...' :
                             'Compiling project environment...'}
                          </p>
                          <p className="text-[10px] text-slate-600">
                            You can check the Terminal Logs tab to view the live build progress.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {winnerRespondOpen && !winnerApprovedView && buildAtRest && (
                  <div className="flex-1 flex flex-col items-center justify-center bg-[#0a0a0a] p-8 min-h-0">
                    <div className="text-center max-w-md space-y-3">
                      <p className="text-sm text-slate-300">
                        Sandbox preview is not running right now.
                      </p>
                      <p className="text-xs text-slate-500">
                        Expand <span className="text-amber-400 font-bold">Respond to mentor</span> at the bottom to upload a revision ZIP (you can also drop a ZIP anywhere on this page).
                      </p>
                    </div>
                  </div>
                )}

                {isFinalized && !winnerRespondOpen && !winnerApprovedView && (
                  <div className="flex-1 flex items-center justify-center bg-slate-50 p-8">
                    <p className="text-sm text-slate-600 text-center">Your project is finalized.</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Bottom dock: mentor revisions (winner, before payment released) */}
          {winnerRespondOpen && (
            <div className="flex-shrink-0 border-t border-white/10 bg-[#111118] shadow-[0_-12px_40px_rgba(0,0,0,0.45)] z-30">
              <div className="flex items-center gap-2 px-3 py-2.5">
                <button
                  type="button"
                  onClick={() => {
                    const next = !mentorPanelExpanded
                    setMentorPanelExpanded(next)
                    if (next) acknowledgeMentorCorrection()
                  }}
                  className="flex items-center gap-2 p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
                  aria-expanded={mentorPanelExpanded}
                  title={mentorPanelExpanded ? 'Collapse' : 'Expand'}
                >
                  <svg className={`w-4 h-4 transition-transform ${mentorPanelExpanded ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>
                </button>
                <div className="flex-1 min-w-0 text-left">
                  <p className="text-[11px] font-black text-white uppercase tracking-wider truncate">Respond to mentor</p>
                  <p className="text-[10px] text-slate-500 truncate">
                    {submission?.review_hold_status === 'paused' && countdownText
                      ? `Review paused · ${countdownText}`
                      : 'ZIP & message · expand to edit'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setMentorPanelExpanded(true)
                    acknowledgeMentorCorrection()
                    setTimeout(() => mentorFeedbackRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150)
                  }}
                  className="relative p-2.5 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-300 hover:bg-amber-500/25 transition-colors"
                  title="Mentor feedback"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                  {correctionUnread && (
                    <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500 ring-2 ring-[#111118]" />
                    </span>
                  )}
                </button>
              </div>

              <AnimatePresence initial={false}>
                {mentorPanelExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.22 }}
                    className="overflow-hidden border-t border-white/5"
                  >
                    <div className="max-h-[42vh] overflow-y-auto custom-scrollbar px-4 py-4 space-y-4 bg-[#0c0c12]">
                      {submission?.review_hold_status === 'paused' && (
                        <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/25">
                          <p className="text-[10px] font-bold text-amber-400 uppercase tracking-wider mb-1">Review paused</p>
                          {submission.review_hold_reason && (
                            <p className="text-sm text-amber-100/90 whitespace-pre-wrap">{submission.review_hold_reason}</p>
                          )}
                          {countdownText && <p className="text-[10px] text-amber-200/70 mt-2 font-mono">⏱ {countdownText}</p>}
                        </div>
                      )}

                      <div ref={mentorFeedbackRef} className="p-4 rounded-xl bg-slate-800/80 border border-white/10">
                        <p className="text-[10px] font-bold text-sky-400 uppercase tracking-wider mb-1">
                          {submission?.mentor_latest_correction ? 'Latest correction from mentor' : 'Mentor feedback'}
                        </p>
                        <p className="text-sm text-slate-200 whitespace-pre-wrap leading-relaxed">
                          {submission?.mentor_latest_correction || submission?.review_hold_reason || 'No written correction yet. Your mentor may send one here — you will see a message icon on the bar when it updates.'}
                        </p>
                        {submission?.mentor_latest_correction_at && (
                          <p className="text-[10px] text-slate-500 mt-2">Updated {new Date(submission.mentor_latest_correction_at).toLocaleString()}</p>
                        )}
                      </div>

                      <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5 block">Message (optional if you attach ZIP)</label>
                        <textarea
                          value={clarificationMessage}
                          onChange={e => setClarificationMessage(e.target.value)}
                          placeholder="Explain what changed, or leave blank if you are only uploading a ZIP..."
                          rows={3}
                          className="w-full px-3 py-2.5 rounded-xl bg-black/40 border border-white/10 text-white text-sm focus:outline-none focus:ring-1 focus:ring-amber-500/40 placeholder:text-slate-600 resize-none"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5 block">Revised ZIP (optional)</label>
                        <input
                          type="file"
                          id="winner-revision-zip-dock"
                          onChange={e => setClarificationFile(e.target.files?.[0] || null)}
                          className="hidden"
                          accept=".zip"
                        />
                        <label
                          htmlFor="winner-revision-zip-dock"
                          className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-black/40 border border-white/10 cursor-pointer hover:bg-white/5 transition-colors"
                        >
                          <span className="text-xs text-slate-400 truncate">
                            {clarificationFile ? clarificationFile.name : 'Select .zip (optional)'}
                          </span>
                          <span className="text-[10px] font-bold text-amber-400">Browse</span>
                        </label>
                      </div>

                      <button
                        type="button"
                        onClick={handleClarificationSubmit}
                        disabled={isSubmittingClarification || (!clarificationMessage.trim() && !clarificationFile)}
                        className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-black text-sm font-black transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                      >
                        {isSubmittingClarification ? <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" /> : null}
                        Send to mentor
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>

        {/* Right Panel: Chat */}
        <AnimatePresence>
          {showChat && (
            <motion.div 
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 320, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              className="border-l border-slate-200 z-20 shadow-[-10px_0_20px_rgba(0,0,0,0.05)] bg-white"
            >
              <ChatPanel taskId={id} participantId={profile?.id} mentorId={task?.mentor_id} />
            </motion.div>
          )}
        </AnimatePresence>

      </div>

      {/* ─── Clarification Modal ─── */}
      <AnimatePresence>
        {showClarificationModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] flex items-center justify-center p-4"
            onClick={(e) => e.target === e.currentTarget && setShowClarificationModal(false)}>
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              className="relative bg-white rounded-2xl p-8 max-w-lg w-full shadow-2xl">
              <div className="w-14 h-14 rounded-full bg-amber-500/10 flex items-center justify-center mx-auto mb-5">
                <svg className="w-7 h-7 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              </div>
              <h3 className="text-xl font-bold text-slate-800 text-center mb-1">Respond to Mentor</h3>
              <p className="text-sm text-slate-500 text-center mb-6">Address the mentor's clarification request. You can optionally upload a revised project ZIP.</p>

              <div className="space-y-4">
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block">Your Message</label>
                  <textarea 
                    value={clarificationMessage}
                    onChange={e => setClarificationMessage(e.target.value)}
                    placeholder="Explain the changes or provide clarification..."
                    rows={4}
                    className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-all resize-none"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block">Revised ZIP (Optional)</label>
                  <div className="relative">
                    <input 
                      type="file" 
                      id="clarification-file"
                      onChange={e => setClarificationFile(e.target.files?.[0])}
                      className="hidden"
                      accept=".zip"
                    />
                    <label 
                      htmlFor="clarification-file"
                      className="flex items-center justify-between px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer hover:bg-slate-100 transition-colors"
                    >
                      <span className="text-sm text-slate-600 truncate">
                        {clarificationFile ? clarificationFile.name : 'Select updated .zip file'}
                      </span>
                      <svg className="w-4 h-4 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                    </label>
                  </div>
                </div>

                <div className="flex gap-3 pt-2">
                  <button 
                    onClick={() => setShowClarificationModal(false)}
                    className="flex-1 py-3 rounded-xl bg-slate-100 text-sm font-bold text-slate-600 hover:bg-slate-200 transition-all"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={handleClarificationSubmit}
                    disabled={isSubmittingClarification || (!clarificationMessage.trim() && !clarificationFile)}
                    className="flex-1 py-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-black shadow-lg shadow-amber-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {isSubmittingClarification ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : 'Send Response'}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
