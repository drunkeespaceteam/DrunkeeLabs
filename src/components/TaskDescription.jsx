import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

export default function TaskDescription({ task }) {
  const [fullscreenImage, setFullscreenImage] = useState(null)

  if (!task) {
    return (
      <div className="flex items-center justify-center h-full text-slate-400 text-sm">
        Loading task...
      </div>
    )
  }

  const images = task.description_images || []

  return (
    <>
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.5, delay: 0.1, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="h-full overflow-y-auto p-5 space-y-6 custom-scrollbar"
    >
      {/* Problem Statement */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-6 h-6 rounded-lg bg-ice-50 flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-ice-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          </div>
          <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Problem Statement</h2>
        </div>
        <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">{task.details}</p>
      </section>

      {/* Mentor Reference Images */}
      {images.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-6 h-6 rounded-lg bg-pink-50 flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-pink-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <polyline points="21 15 16 10 5 21"/>
              </svg>
            </div>
            <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Reference Images</h2>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {images.map((imgUrl, i) => (
              <div 
                key={i} 
                className="rounded-xl overflow-hidden border border-slate-200 shadow-sm cursor-pointer hover:shadow-md hover:border-ice-300 transition-all group relative"
                onClick={() => setFullscreenImage(imgUrl)}
              >
                <img src={imgUrl} alt={`Reference ${i+1}`} className="w-full h-auto" />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity w-8 h-8 rounded-full bg-white/80 backdrop-blur-sm flex items-center justify-center shadow-lg">
                    <svg className="w-4 h-4 text-slate-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Requirements */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-6 h-6 rounded-lg bg-amber-50 flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2 2 7l10 5 10-5-10-5z" /><path d="m2 17 10 5 10-5" /><path d="m2 12 10 5 10-5" />
            </svg>
          </div>
          <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Requirements</h2>
        </div>
        <ul className="space-y-2">
          {(task.requirements || [
            'Clean, well-documented code',
            'Handle edge cases properly',
            'Optimize for performance',
            'Include error handling',
            'Follow best practices'
          ]).map((req, i) => (
            <li key={i} className="flex items-start gap-2.5 text-sm text-slate-600">
              <div className="w-5 h-5 rounded-md bg-slate-50 flex items-center justify-center flex-shrink-0 mt-0.5 border border-slate-100">
                <span className="text-[10px] font-bold text-slate-400">{i + 1}</span>
              </div>
              <span className="leading-relaxed">{req}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Example I/O */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-6 h-6 rounded-lg bg-emerald-50 flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="4 17 10 11 4 5" /><line x1="12" x2="20" y1="19" y2="19" />
            </svg>
          </div>
          <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Example</h2>
        </div>

        {(task.examples || [
          { input: task.exampleInput || '{ "users": [1, 2, 3] }', output: task.exampleOutput || '{ "count": 3, "status": "success" }' }
        ]).map((ex, i) => (
          <div key={i} className="space-y-2 mb-4">
            <div>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block">Input</span>
              <pre className="text-xs bg-slate-800 text-emerald-300 rounded-lg p-3 overflow-x-auto font-mono leading-relaxed">
                {ex.input}
              </pre>
            </div>
            <div>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block">Expected Output</span>
              <pre className="text-xs bg-slate-800 text-sky-300 rounded-lg p-3 overflow-x-auto font-mono leading-relaxed">
                {ex.output}
              </pre>
            </div>
          </div>
        ))}
      </section>

      {/* Hints */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-6 h-6 rounded-lg bg-violet-50 flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-violet-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><path d="M12 17h.01" />
            </svg>
          </div>
          <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Hints</h2>
        </div>
        <div className="bg-violet-50/50 rounded-xl p-3.5 border border-violet-100/50">
          <p className="text-xs text-violet-600 leading-relaxed">
            {task.hint || 'Think about breaking the problem into smaller functions. Consider edge cases like empty inputs, null values, and type mismatches. Start with a working solution, then optimize.'}
          </p>
        </div>
      </section>

      {/* Bottom padding for scroll */}
      <div className="h-4" />
    </motion.div>

    {/* Fullscreen Image Viewer */}
    <AnimatePresence>
      {fullscreenImage && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[300] flex items-center justify-center p-8 cursor-zoom-out"
          onClick={() => setFullscreenImage(null)}>
          <div className="absolute inset-0 bg-black/90 backdrop-blur-lg" />
          <motion.img initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}
            src={fullscreenImage} alt="Fullscreen" className="relative max-w-full max-h-full rounded-2xl shadow-2xl border border-white/10 object-contain" />
          <button onClick={() => setFullscreenImage(null)} className="absolute top-6 right-6 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 border border-white/10 flex items-center justify-center text-white transition-all z-10">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </motion.div>
      )}
    </AnimatePresence>
    </>
  )
}
