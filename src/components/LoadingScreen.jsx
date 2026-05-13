import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'

export default function LoadingScreen() {
  const [showRefresh, setShowRefresh] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => {
      setShowRefresh(true)
    }, 4000)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div
      className="min-h-screen w-full flex items-center justify-center"
      style={{ background: 'linear-gradient(145deg, #ffffff 0%, #e0f2fe 30%, #bae6fd 60%, #f0f9ff 100%)' }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex flex-col items-center gap-5"
      >
        {/* Animated logo */}
        <div className="relative">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-ice-400 to-ice-600 flex items-center justify-center shadow-xl shadow-ice-500/25">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-7 h-7 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 2 7 12 12 22 7 12 2" />
              <polyline points="2 17 12 22 22 17" />
              <polyline points="2 12 12 17 22 12" />
            </svg>
          </div>
          <div className="absolute inset-0 rounded-2xl bg-ice-400/20 blur-xl animate-glow-pulse" />
        </div>

        {/* Loading text */}
        <div className="text-center">
          <p className="text-sm font-semibold text-slate-600">Loading NexusDev</p>
          <div className="flex items-center justify-center gap-1 mt-2">
            {[0, 1, 2].map((i) => (
              <motion.div
                key={i}
                className="w-1.5 h-1.5 rounded-full bg-ice-400"
                animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1.2, 0.8] }}
                transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
              />
            ))}
          </div>
        </div>

        {showRefresh && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-6 text-center">
            <p className="text-xs text-slate-500 mb-2">Taking longer than expected...</p>
            <button 
              onClick={() => window.location.href = '/login'}
              className="px-4 py-2 bg-white/60 border border-slate-200 rounded-lg text-xs font-semibold text-slate-600 hover:bg-white"
            >
              Refresh Page
            </button>
          </motion.div>
        )}
      </motion.div>
    </div>
  )
}
