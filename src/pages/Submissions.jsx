import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import Navbar from '../components/Navbar'
import { useAuth } from '../context/AuthContext'
import { db, realtime } from '../lib/supabase'
import { useToast } from '../components/Toast'

function getScoreColor(score) {
  if (score >= 80) return { ring: '#10b981', bg: 'from-emerald-500 to-emerald-400', glow: 'shadow-emerald-500/50', label: 'Excellent', text: 'text-emerald-400' }
  if (score >= 60) return { ring: '#38bdf8', bg: 'from-sky-500 to-sky-400', glow: 'shadow-sky-500/50', label: 'Good', text: 'text-sky-400' }
  if (score >= 40) return { ring: '#f59e0b', bg: 'from-amber-500 to-amber-400', glow: 'shadow-amber-500/50', label: 'Needs Work', text: 'text-amber-400' }
  return { ring: '#ef4444', bg: 'from-rose-500 to-rose-400', glow: 'shadow-rose-500/50', label: 'Critical Issues', text: 'text-rose-400' }
}

const fadeUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
}

export default function Submissions() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const toast = useToast()
  
  const [submissions, setSubmissions] = useState([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState(null)

  useEffect(() => {
    const fetchSubmissions = async () => {
      setLoading(true)
      try {
        if (profile?.id) {
          const { data, error } = await db.getSubmissionsByUser(profile.id)
          if (error) {
            console.error(error)
            toast.error('Failed to load submissions')
          } else {
            setSubmissions(data || [])
          }
        }
      } catch (err) {
        toast.error('Network error')
      } finally {
        setLoading(false)
      }
    }
    fetchSubmissions()
  }, [profile?.id])

  // Realtime: update when is_winner changes
  useEffect(() => {
    if (!profile?.id) return
    const unsub = realtime.subscribeToUserSubmissions(profile.id, (payload) => {
      setSubmissions(prev => prev.map(s => s.id === payload.new.id ? { ...s, ...payload.new } : s))
    })
    return unsub
  }, [profile?.id])

  return (
    <div className="min-h-screen w-full relative overflow-hidden bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-[#131b2c] via-[#050505] to-black">
      {/* Deep Mesh Background */}
      <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 brightness-100 contrast-150 pointer-events-none mix-blend-overlay" />
      <div className="blob animate-float w-[500px] h-[500px] -top-32 -right-24 fixed" style={{ background: 'radial-gradient(circle, rgba(14,165,233,0.1), transparent 70%)' }} />
      <div className="blob animate-float-delayed w-[400px] h-[400px] top-1/2 -left-20 fixed" style={{ background: 'radial-gradient(circle, rgba(16,185,129,0.05), transparent 70%)' }} />

      <Navbar isDark={true} />

      <main className="max-w-6xl mx-auto px-4 sm:px-8 pb-16 relative z-10 pt-8">
        <motion.section variants={fadeUp} initial="initial" animate="animate" transition={{ duration: 0.6 }} className="mb-10 flex items-center gap-4">
          <button onClick={() => navigate('/dashboard')} className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-all">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
          </button>
          <div>
            <h1 className="text-3xl font-extrabold text-white tracking-tight">
              My Submissions
            </h1>
            <p className="text-slate-400 mt-1 text-sm">
              Track your history, AI reviews, and task attempts
            </p>
          </div>
        </motion.section>

        {loading ? (
          <div className="flex flex-col items-center justify-center h-64 gap-4">
            <div className="w-10 h-10 border-2 border-white/10 border-t-ice-500 rounded-full animate-spin" />
            <p className="text-sm font-bold tracking-widest text-slate-500 uppercase">Loading history...</p>
          </div>
        ) : submissions.length === 0 ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-3xl p-12 text-center shadow-2xl">
            <div className="w-20 h-20 mx-auto bg-white/5 rounded-full flex items-center justify-center mb-6 border border-white/10">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
            </div>
            <h3 className="text-xl font-bold text-white mb-2">No submissions yet</h3>
            <p className="text-slate-400 mb-6">You haven't completed any tasks. Return to the dashboard to start one!</p>
            <button onClick={() => navigate('/dashboard')} className="btn-gradient px-6 py-3 rounded-xl text-white font-bold shadow-[0_0_20px_rgba(14,165,233,0.3)] hover:shadow-[0_0_30px_rgba(14,165,233,0.5)] transition-all">
              Browse Tasks
            </button>
          </motion.div>
        ) : (
          <div className="grid grid-cols-1 gap-6">
            {submissions.map((sub, i) => {
              const taskTitle = sub.tasks?.title || 'Unknown Task'
              const taskCategory = sub.tasks?.category || 'Task'
              const dateStr = new Date(sub.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
              const colors = getScoreColor(sub.score)
              const isExpanded = expandedId === sub.id
              const fb = sub.feedback || {}

              return (
                <motion.div 
                  key={sub.id} 
                  initial={{ opacity: 0, y: 20 }} 
                  animate={{ opacity: 1, y: 0 }} 
                  transition={{ delay: i * 0.05 }}
                  className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden shadow-2xl hover:border-white/20 transition-all group"
                >
                  <div className="p-6 flex flex-col md:flex-row items-center gap-6 cursor-pointer" onClick={() => setExpandedId(isExpanded ? null : sub.id)}>
                    {/* Score Ring */}
                    <div className="relative w-20 h-20 flex-shrink-0">
                      <div className={`absolute inset-0 rounded-full blur-[20px] opacity-20 bg-gradient-to-br ${colors.bg}`} />
                      <svg className="w-full h-full -rotate-90 relative z-10" viewBox="0 0 120 120">
                        <circle cx="60" cy="60" r="54" fill="#050505" stroke="rgba(255,255,255,0.05)" strokeWidth="8" />
                        <motion.circle
                          cx="60" cy="60" r="54" fill="none"
                          stroke={colors.ring}
                          strokeWidth="8" strokeLinecap="round"
                          strokeDasharray={2 * Math.PI * 54}
                          strokeDashoffset={2 * Math.PI * 54 * (1 - sub.score / 100)}
                        />
                      </svg>
                      <div className="absolute inset-0 flex items-center justify-center z-20">
                        <span className={`text-2xl font-black ${colors.text}`}>{sub.score}</span>
                      </div>
                    </div>

                    {/* Basic Info */}
                    <div className="flex-1 text-center md:text-left">
                      <div className="flex items-center justify-center md:justify-start gap-3 mb-2">
                        <span className="px-2.5 py-0.5 rounded-full bg-white/5 border border-white/10 text-[10px] font-bold text-ice-400 uppercase tracking-widest">
                          {taskCategory}
                        </span>
                        {sub.is_winner ? (
                          <span className="px-2.5 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/30 text-[10px] font-bold text-amber-400 uppercase tracking-widest flex items-center gap-1">🏆 Winner</span>
                        ) : (
                          <span className="px-2.5 py-0.5 rounded-full bg-slate-700/50 border border-slate-600/30 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Pending</span>
                        )}
                      </div>
                      <h3 className="text-xl font-bold text-white mb-1">{taskTitle}</h3>
                      <p className="text-xs text-slate-500 font-medium">{dateStr}</p>
                    </div>

                    {/* Expand indicator */}
                    <div className="flex items-center gap-4">
                       <button onClick={(e) => { e.stopPropagation(); navigate(`/task/${sub.task_id}`) }} className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-sm font-bold text-white transition-all shadow-lg hover:shadow-white/5">
                         View Task
                       </button>
                       <div className={`w-8 h-8 rounded-full bg-white/5 flex items-center justify-center transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}>
                         <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                       </div>
                    </div>
                  </div>

                  {/* Expanded Content */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div 
                        initial={{ height: 0, opacity: 0 }} 
                        animate={{ height: 'auto', opacity: 1 }} 
                        exit={{ height: 0, opacity: 0 }}
                        className="border-t border-white/10 bg-black/20"
                      >
                        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                           <div className="md:col-span-2">
                             <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                               <p className="text-sm text-slate-300 font-medium leading-relaxed">
                                 {fb.feedback || 'No feedback available.'}
                               </p>
                             </div>
                           </div>

                           {fb.strengths && fb.strengths.length > 0 && (
                             <div>
                               <h4 className="text-xs font-bold uppercase tracking-widest text-emerald-400 mb-3 flex items-center gap-2">
                                 <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"></polyline></svg> Strengths
                               </h4>
                               <ul className="space-y-2">
                                 {fb.strengths.map((s, idx) => (
                                   <li key={idx} className="flex items-start gap-2 text-xs text-slate-400 bg-emerald-500/5 p-2 rounded-lg border border-emerald-500/10">
                                     <span className="text-emerald-500">✦</span> {s}
                                   </li>
                                 ))}
                               </ul>
                             </div>
                           )}

                           {fb.weaknesses && fb.weaknesses.length > 0 && (
                             <div>
                               <h4 className="text-xs font-bold uppercase tracking-widest text-rose-400 mb-3 flex items-center gap-2">
                                 <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg> Improvements
                               </h4>
                               <ul className="space-y-2">
                                 {fb.weaknesses.map((w, idx) => (
                                   <li key={idx} className="flex items-start gap-2 text-xs text-slate-400 bg-rose-500/5 p-2 rounded-lg border border-rose-500/10">
                                     <span className="text-rose-500">✦</span> {w}
                                   </li>
                                 ))}
                               </ul>
                             </div>
                           )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
