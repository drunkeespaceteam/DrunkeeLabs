import { motion, useMotionValue, useTransform, animate } from 'framer-motion'
import { useEffect, useState } from 'react'

function AnimatedNumber({ value, duration = 1.5 }) {
  const [display, setDisplay] = useState(0)

  useEffect(() => {
    const controls = animate(0, value, {
      duration,
      ease: [0.25, 0.46, 0.45, 0.94],
      onUpdate: (v) => setDisplay(Math.round(v)),
    })
    return () => controls.stop()
  }, [value, duration])

  return <>{display}</>
}

export default function ProgressCard({ level = 7, xp = 2840, maxXp = 4000, tasksCompleted = 23, streak = 5 }) {
  const xpPercent = (xp / maxXp) * 100

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="glass-card rounded-2xl p-6 sm:p-8"
    >
      <div className="flex flex-col sm:flex-row gap-6 sm:gap-10 items-center">
        {/* Level ring */}
        <div className="relative flex-shrink-0">
          <div className="w-28 h-28 rounded-full bg-gradient-to-br from-ice-100 to-ice-200/50 flex items-center justify-center relative">
            {/* Animated ring */}
            <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 120 120">
              <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(186,230,253,0.3)" strokeWidth="6" />
              <motion.circle
                cx="60" cy="60" r="52" fill="none"
                stroke="url(#levelGrad)" strokeWidth="6"
                strokeLinecap="round"
                strokeDasharray={2 * Math.PI * 52}
                initial={{ strokeDashoffset: 2 * Math.PI * 52 }}
                animate={{ strokeDashoffset: 2 * Math.PI * 52 * (1 - xpPercent / 100) }}
                transition={{ duration: 1.5, delay: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
              />
              <defs>
                <linearGradient id="levelGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#38bdf8" />
                  <stop offset="100%" stopColor="#0284c7" />
                </linearGradient>
              </defs>
            </svg>
            <div className="text-center z-10">
              <p className="text-3xl font-extrabold text-slate-800 leading-none">
                <AnimatedNumber value={level} duration={1} />
              </p>
              <p className="text-[10px] font-bold text-ice-500 uppercase tracking-widest mt-0.5">Level</p>
            </div>
          </div>
          {/* Glow behind */}
          <div className="absolute inset-0 rounded-full bg-ice-400/10 blur-xl scale-110 animate-glow-pulse" />
        </div>

        {/* Stats */}
        <div className="flex-1 w-full space-y-5">
          {/* XP bar */}
          <div className="space-y-2">
            <div className="flex justify-between items-baseline">
              <h3 className="text-sm font-bold text-slate-700">Experience Points</h3>
              <span className="text-xs font-semibold text-slate-400">
                <AnimatedNumber value={xp} /> / {maxXp.toLocaleString()} XP
              </span>
            </div>
            <div className="w-full h-3 rounded-full bg-ice-100/60 overflow-hidden">
              <motion.div
                className="h-full rounded-full relative"
                style={{ background: 'linear-gradient(90deg, #38bdf8, #0284c7)' }}
                initial={{ width: 0 }}
                animate={{ width: `${xpPercent}%` }}
                transition={{ duration: 1.5, delay: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
              >
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer bg-[length:200%_100%]" />
              </motion.div>
            </div>
          </div>

          {/* Stat cards */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white/40 backdrop-blur-sm rounded-xl p-3 border border-white/50">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-6 h-6 rounded-lg bg-emerald-50 flex items-center justify-center">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Completed</span>
              </div>
              <p className="text-2xl font-extrabold text-slate-800">
                <AnimatedNumber value={tasksCompleted} />
              </p>
            </div>
            <div className="bg-white/40 backdrop-blur-sm rounded-xl p-3 border border-white/50">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-6 h-6 rounded-lg bg-orange-50 flex items-center justify-center">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-orange-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
                  </svg>
                </div>
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Streak</span>
              </div>
              <p className="text-2xl font-extrabold text-slate-800">
                <AnimatedNumber value={streak} /><span className="text-sm font-bold text-slate-400 ml-1">days</span>
              </p>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  )
}
