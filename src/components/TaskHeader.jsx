import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'

export default function TaskHeader({ task, onSubmit, loading }) {
  const navigate = useNavigate()
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => setElapsed((p) => p + 1), 1000)
    return () => clearInterval(timer)
  }, [])

  const formatTime = (s) => {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  }

  return (
    <motion.header
      initial={{ y: -10, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="h-14 px-4 flex items-center justify-between border-b border-slate-200/60 bg-white/70 backdrop-blur-xl flex-shrink-0 z-30 relative"
    >
      {/* Left: Back + Title */}
      <div className="flex items-center gap-3 min-w-0">
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => navigate('/dashboard')}
          className="w-8 h-8 rounded-lg bg-slate-100/80 hover:bg-slate-200/80 flex items-center justify-center text-slate-500 hover:text-slate-700 transition-all flex-shrink-0"
          title="Back to Dashboard"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m12 19-7-7 7-7" /><path d="M19 12H5" />
          </svg>
        </motion.button>

        <div className="h-5 w-px bg-slate-200 flex-shrink-0" />

        <div className="min-w-0">
          <h1 className="text-sm font-bold text-slate-800 truncate">{task?.title || 'Loading...'}</h1>
          <div className="flex items-center gap-2">
            {task?.category && (
              <span className="text-[10px] font-bold text-ice-500 uppercase tracking-wider">{task.category}</span>
            )}
            {task?.difficulty && (
              <span className={`text-[10px] font-bold uppercase tracking-wider ${
                task.difficulty === 'Easy' ? 'text-emerald-500' :
                task.difficulty === 'Medium' ? 'text-amber-500' : 'text-rose-500'
              }`}>• {task.difficulty}</span>
            )}
          </div>
        </div>
      </div>

      {/* Center: Timer */}
      <div className="hidden sm:flex items-center gap-2 bg-slate-50/80 rounded-lg px-3 py-1.5 border border-slate-100">
        <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        <span className="text-xs font-mono font-bold text-slate-600 tabular-nums">
          {formatTime(elapsed)}
        </span>
      </div>

      {/* Right: Submit */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-slate-400 font-medium hidden md:block">
          {task?.reward && `${task.reward} pts`}
        </span>
        <motion.button
          whileHover={!loading ? { scale: 1.03 } : {}}
          whileTap={!loading ? { scale: 0.97 } : {}}
          onClick={onSubmit}
          disabled={loading}
          className="btn-gradient px-4 py-2 rounded-lg text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-60"
        >
          {loading ? (
            <>
              <div className="spinner !w-3.5 !h-3.5 !border-[2px]" />
              Submitting...
            </>
          ) : (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Submit Solution
            </>
          )}
        </motion.button>
      </div>
    </motion.header>
  )
}
