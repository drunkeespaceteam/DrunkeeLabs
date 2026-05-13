import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { db } from '../lib/supabase'

const difficultyConfig = {
  Easy: { bg: 'bg-emerald-50', text: 'text-emerald-600', border: 'border-emerald-200', dot: 'bg-emerald-400' },
  Medium: { bg: 'bg-amber-50', text: 'text-amber-600', border: 'border-amber-200', dot: 'bg-amber-400' },
  Hard: { bg: 'bg-rose-50', text: 'text-rose-600', border: 'border-rose-200', dot: 'bg-rose-400' },
}

const categoryIcons = {
  Frontend: (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
    </svg>
  ),
  Backend: (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="20" height="8" x="2" y="2" rx="2" ry="2" /><rect width="20" height="8" x="2" y="14" rx="2" ry="2" />
      <line x1="6" x2="6.01" y1="6" y2="6" /><line x1="6" x2="6.01" y1="18" y2="18" />
    </svg>
  ),
  API: (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m8 3 4 8 5-5 5 15H2L8 3z" />
    </svg>
  ),
  Design: (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="13.5" cy="6.5" r="0.5" fill="currentColor" /><circle cx="17.5" cy="10.5" r="0.5" fill="currentColor" />
      <circle cx="8.5" cy="7.5" r="0.5" fill="currentColor" /><circle cx="6.5" cy="12.5" r="0.5" fill="currentColor" />
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
    </svg>
  ),
}

export default function TaskCard({ task, submissionStatus, index }) {
  const navigate = useNavigate()
  const diff = difficultyConfig[task.difficulty] || difficultyConfig.Easy
  const icon = categoryIcons[task.category] || categoryIcons.Frontend
  const [rating, setRating] = useState(null)

  useEffect(() => {
    if (task?.mentor_id) {
      db.getMentorRating(task.mentor_id).then(({ data }) => {
        if (data) setRating(data)
      })
    }
  }, [task?.mentor_id])

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: index * 0.08, ease: [0.25, 0.46, 0.45, 0.94] }}
      whileHover={{ y: -4, transition: { duration: 0.25 } }}
      className={`glass-card rounded-2xl p-5 flex flex-col gap-4 group transition-shadow duration-300 ${task.closed || submissionStatus?.isClosed || submissionStatus?.isWinner ? 'cursor-not-allowed opacity-90' : 'cursor-pointer hover:shadow-xl hover:shadow-ice-200/30'}`}
      onClick={() => {
        if (!task.closed && !submissionStatus?.isClosed && !submissionStatus?.isWinner) {
          navigate(`/task/${task.id}`)
        }
      }}
    >
      {/* Top row: category + difficulty + status */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 text-ice-500">
            {icon}
            <span className="text-xs font-semibold uppercase tracking-wider">{task.category}</span>
          </div>
          {task.is_featured && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-300">
              ⭐ Featured
            </span>
          )}
          {task.closed ? (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">Completed 🏆</span>
          ) : (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span> Live
            </span>
          )}
        </div>
        <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full border ${diff.bg} ${diff.text} ${diff.border}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${diff.dot}`} />
          {task.difficulty}
        </span>
      </div>

      {/* Title + description */}
      <div className="flex-1">
        <h3 className="text-base font-bold text-slate-800 mb-1.5 group-hover:text-ice-600 transition-colors">
          {task.title}
        </h3>
        <p className="text-sm text-slate-500 leading-relaxed line-clamp-2 mb-3">
          {task.problem || task.description}
        </p>
        
        {/* Trust Badges */}
        <div className="flex items-center gap-2 flex-wrap">
          {!task.closed && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-50 text-emerald-600 border border-emerald-200/50 flex items-center gap-1 uppercase tracking-wider">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
              Reward Locked
            </span>
          )}
          {rating && rating.count > 0 && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-50 text-amber-600 border border-amber-200/50 flex items-center gap-1 uppercase tracking-wider">
              ⭐ {rating.average} ({rating.count})
            </span>
          )}
        </div>
      </div>

      {/* Bottom row: reward + button */}
      <div className="flex items-center justify-between pt-1 border-t border-slate-100/80">
        <div className="flex items-center gap-1.5">
          <span className="text-lg font-bold text-slate-800">₹{task.reward}</span>
          <span className="text-xs text-slate-400 font-medium">reward</span>
        </div>
        
        {submissionStatus?.isWinner ? (
          <motion.button
            disabled={true}
            className="px-4 py-2 rounded-xl text-white text-xs font-bold flex items-center gap-1.5 bg-gradient-to-r from-emerald-400 to-emerald-500 shadow-lg shadow-emerald-500/30 cursor-not-allowed opacity-90"
          >
            Winner 🏆
          </motion.button>
        ) : task.closed ? (
          <motion.button
            disabled={true}
            className="px-4 py-2 rounded-xl text-slate-500 text-xs font-bold flex items-center gap-1.5 bg-slate-100 border border-slate-200 cursor-not-allowed opacity-90"
          >
            Winner Announced 🏆
          </motion.button>
        ) : submissionStatus?.isClosed ? (
          <motion.button
            disabled={true}
            className="px-4 py-2 rounded-xl text-amber-600 text-xs font-bold flex items-center gap-1.5 bg-amber-50 border border-amber-200 cursor-not-allowed opacity-90"
          >
            Waiting for Result ⏳
          </motion.button>
        ) : submissionStatus && !submissionStatus.isClosed ? (
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={(e) => { e.stopPropagation(); navigate(`/task/${task.id}`) }}
            className="px-4 py-2 rounded-xl text-ice-600 text-xs font-bold flex items-center gap-1.5 bg-ice-50 border border-ice-200"
          >
            In Progress ✏️
          </motion.button>
        ) : (
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={(e) => { e.stopPropagation(); navigate(`/task/${task.id}`) }}
            className="btn-gradient px-4 py-2 rounded-xl text-white text-xs font-semibold flex items-center gap-1.5"
          >
            Start Task
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14" /><path d="m12 5 7 7-7 7" />
            </svg>
          </motion.button>
        )}
      </div>
    </motion.div>
  )
}
