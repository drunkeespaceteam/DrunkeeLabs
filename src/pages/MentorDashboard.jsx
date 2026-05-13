import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import Navbar from '../components/Navbar'
import { useAuth } from '../context/AuthContext'
import { db } from '../lib/supabase'
import { useToast } from '../components/Toast'

const diffColors = {
  Easy: 'bg-emerald-50 text-emerald-600 border-emerald-200',
  Medium: 'bg-amber-50 text-amber-600 border-amber-200',
  Hard: 'bg-rose-50 text-rose-600 border-rose-200',
}

function TaskRowSkeleton() {
  return (
    <div className="glass-card rounded-2xl p-5 animate-pulse flex items-center gap-4">
      <div className="flex-1"><div className="h-3 bg-slate-200 rounded w-20 mb-2" /><div className="h-4 bg-slate-200 rounded w-48 mb-2" /><div className="h-3 bg-slate-200 rounded w-32" /></div>
      <div className="h-8 bg-slate-200 rounded-lg w-16" />
    </div>
  )
}

export default function MentorDashboard() {
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const toast = useToast()
  const [tasks, setTasks] = useState([])
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(true)
  const [showFundsModal, setShowFundsModal] = useState(false)
  const [expandedFundTask, setExpandedFundTask] = useState(null)

  const fullName = profile?.name || user?.user_metadata?.name || 'Mentor'
  const userName = fullName.split(' ')[0]

  useEffect(() => {
    const fetchTasks = async () => {
      if (!profile?.id) { setLoading(false); return }
      setLoading(true)
      try {
        const [taskRes, payRes] = await Promise.all([
          db.getTasksByMentor(profile.id),
          db.getMentorPayments(profile.id)
        ])
        if (taskRes.error) { toast.error('Failed to load tasks'); console.error(taskRes.error) }
        else setTasks(taskRes.data)
        
        if (payRes.error) console.error(payRes.error)
        else setPayments(payRes.data)
      } catch { toast.error('Network error') }
      finally { setLoading(false) }
    }
    fetchTasks()
  }, [profile?.id])

  const totalSubs = tasks.reduce((s, t) => s + (t.submissions_count || 0), 0)
  
  const totalSpent = payments.filter(p => p.status === 'credited').reduce((s, p) => s + p.amount, 0)
  const lockedFunds = payments.filter(p => p.status === 'locked').reduce((s, p) => s + p.amount, 0)

  return (
    <div className="min-h-screen w-full relative overflow-hidden"
      style={{ background: 'linear-gradient(145deg, #ffffff 0%, #e0f2fe 25%, #bae6fd 55%, #f0f9ff 100%)' }}>
      <div className="blob animate-float w-[400px] h-[400px] -top-20 -right-20 fixed" style={{ background: 'radial-gradient(circle, rgba(56,189,248,0.2), transparent 70%)' }} />
      <div className="blob animate-float-delayed w-[350px] h-[350px] top-1/3 -left-16 fixed" style={{ background: 'radial-gradient(circle, rgba(14,165,233,0.15), transparent 70%)' }} />
      <div className="fixed inset-0 pointer-events-none opacity-[0.02]" style={{ backgroundImage: 'linear-gradient(rgba(14,165,233,1) 1px, transparent 1px), linear-gradient(90deg, rgba(14,165,233,1) 1px, transparent 1px)', backgroundSize: '60px 60px' }} />

      <Navbar />

      <main className="max-w-6xl mx-auto px-4 sm:px-8 pb-16 relative z-10">
        {/* Welcome */}
        <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} className="pt-4 pb-8">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
            <div>
              <motion.p initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 }} className="text-sm font-semibold text-ice-500 mb-1 tracking-wide">Mentor Dashboard 🎯</motion.p>
              <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-800 tracking-tight">
                Welcome, <span className="text-transparent bg-clip-text bg-gradient-to-r from-ice-400 to-ice-600">{userName}</span>
              </h1>
              <p className="text-slate-500 mt-1.5 text-sm">Manage your tasks and review submissions</p>
            </div>
            <motion.button whileHover={{ scale: 1.03, y: -1 }} whileTap={{ scale: 0.97 }} onClick={() => navigate('/mentor/create-task')}
              className="btn-gradient px-5 py-2.5 rounded-xl text-white text-sm font-semibold flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              Create New Task
            </motion.button>
          </div>
        </motion.section>

        {/* Stats */}
        <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          {[
            { label: 'Tasks Created', value: tasks.length, icon: '📋' },
            { label: 'Total Submissions', value: totalSubs, icon: '📥' },
            { label: 'Active Tasks', value: tasks.filter(t => !t.closed).length, icon: '🟢' },
          ].map((s, i) => (
            <div key={i} className="glass-card rounded-2xl p-5 flex items-center gap-4">
              <div className="text-2xl">{s.icon}</div>
              <div><p className="text-2xl font-extrabold text-slate-800">{s.value}</p><p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{s.label}</p></div>
            </div>
          ))}
        </motion.section>

        {/* Payment Tracking */}
        <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="mb-8">
          <h2 className="text-xl font-bold text-slate-800 mb-4">Payment Tracking</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="glass-card rounded-2xl p-6 relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity text-6xl">💸</div>
              <p className="text-sm font-bold text-slate-500 uppercase tracking-widest mb-2">Total Released</p>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-black text-emerald-500">₹{totalSpent}</span>
                <span className="text-xs font-semibold text-emerald-600/70">paid to winners</span>
              </div>
            </div>
            
            <div className="glass-card rounded-2xl p-6 relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity text-6xl">🔒</div>
              <p className="text-sm font-bold text-slate-500 uppercase tracking-widest mb-2">Locked Funds</p>
              <div className="flex items-baseline gap-2 mb-4">
                <span className="text-4xl font-black text-amber-500">₹{lockedFunds}</span>
                <span className="text-xs font-semibold text-amber-600/70">in escrow</span>
              </div>
              <button 
                onClick={() => setShowFundsModal(true)}
                className="text-xs font-bold text-amber-600 hover:text-amber-700 uppercase tracking-wider flex items-center gap-1 transition-colors"
              >
                View full fund tasks
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="9 18 15 12 9 6"></polyline></svg>
              </button>
            </div>
          </div>
        </motion.section>

        {/* Task List */}
        <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}>
          <h2 className="text-xl font-bold text-slate-800 mb-1">Your Tasks</h2>
          <p className="text-sm text-slate-400 mb-5">Manage and review submissions</p>

          {loading && <div className="space-y-3">{[1,2,3].map(i => <TaskRowSkeleton key={i} />)}</div>}

          {!loading && tasks.length === 0 && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass-card rounded-2xl p-12 text-center">
              <div className="text-4xl mb-3">📝</div>
              <h3 className="text-lg font-bold text-slate-700 mb-1">No tasks created yet</h3>
              <p className="text-sm text-slate-400 mb-4">Create your first task to get started.</p>
              <button onClick={() => navigate('/mentor/create-task')} className="btn-gradient px-5 py-2.5 rounded-xl text-white text-sm font-semibold">Create Task</button>
            </motion.div>
          )}

          {!loading && tasks.length > 0 && (
            <div className="space-y-3">
              {tasks.map((task, idx) => (
                <motion.div key={task.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.06 }}
                  whileHover={{ y: -2, transition: { duration: 0.2 } }}
                  className="glass-card rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 group hover:shadow-xl hover:shadow-ice-200/30 transition-shadow">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      {task.closed ? (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">Completed (Winner Announced) 🏆</span>
                      ) : (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span> Live
                        </span>
                      )}
                      <span className="text-xs font-bold text-ice-500 uppercase tracking-wider">{task.category}</span>
                      {task.difficulty && <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${diffColors[task.difficulty] || ''}`}>{task.difficulty}</span>}
                    </div>
                    <h3 className="text-base font-bold text-slate-800 group-hover:text-ice-600 transition-colors truncate">{task.title}</h3>
                    <p className="text-xs text-slate-400 mt-1">Created {new Date(task.created_at).toLocaleDateString()} • <span className="font-semibold text-slate-500">{task.reward} pts</span></p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-center px-3"><p className="text-lg font-extrabold text-slate-800">{task.submissions_count || 0}</p><p className="text-[10px] font-semibold text-slate-400 uppercase">Submissions</p></div>
                    <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                      onClick={() => navigate(`/mentor/task/${task.id}/submissions`)}
                      className="px-4 py-2 rounded-xl bg-white/60 backdrop-blur-sm border border-white/70 text-xs font-semibold text-slate-600 hover:bg-white/80 transition-all flex items-center gap-1.5">
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                      View
                    </motion.button>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </motion.section>
      </main>
      <div className="text-center pb-8 relative z-10"><p className="text-xs text-ice-500/40 font-medium tracking-widest uppercase">Powered by NexusDev Platform</p></div>

      {/* Locked Funds Modal */}
      <AnimatePresence>
        {showFundsModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-8"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setShowFundsModal(false);
                setExpandedFundTask(null);
              }
            }}>
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <motion.div initial={{ scale: 0.95, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="relative bg-white border border-slate-200 rounded-3xl w-full max-w-2xl max-h-[85vh] shadow-2xl flex flex-col overflow-hidden">
              
              <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-amber-50/50">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center text-amber-600 text-xl">🔒</div>
                  <div>
                    <h3 className="text-xl font-bold text-slate-800">Escrow Tasks</h3>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{payments.filter(p => p.status === 'locked').length} tasks with locked funds</p>
                  </div>
                </div>
                <button onClick={() => { setShowFundsModal(false); setExpandedFundTask(null); }} className="p-2 rounded-full hover:bg-slate-200 transition-colors text-slate-500">
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-3">
                {payments.filter(p => p.status === 'locked').length === 0 ? (
                  <div className="text-center py-12">
                    <p className="text-slate-500 font-medium">No locked funds at the moment.</p>
                  </div>
                ) : (
                  payments.filter(p => p.status === 'locked').map(payment => {
                    const tTask = tasks.find(t => t.id === payment.task_id) || {};
                    const isExpanded = expandedFundTask === payment.id;
                    return (
                      <div key={payment.id} className="border border-slate-200 rounded-2xl overflow-hidden transition-all bg-white hover:border-amber-300">
                        <div 
                          className="p-4 flex items-center justify-between cursor-pointer"
                          onClick={() => setExpandedFundTask(isExpanded ? null : payment.id)}
                        >
                          <div>
                            <h4 className="text-sm font-bold text-slate-800">{tTask.title || 'Unknown Task'}</h4>
                            <p className="text-xs text-slate-400 mt-1">Locked on: {new Date(payment.created_at).toLocaleDateString()}</p>
                          </div>
                          <div className="flex items-center gap-4">
                            <span className="text-lg font-black text-amber-500">₹{payment.amount}</span>
                            <svg className={`w-4 h-4 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>
                          </div>
                        </div>
                        
                        <AnimatePresence>
                          {isExpanded && (
                            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                              <div className="p-4 pt-0 border-t border-slate-100 bg-slate-50/50 space-y-4">
                                <div className="grid grid-cols-2 gap-4 mt-4">
                                  <div>
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Category</p>
                                    <p className="text-sm font-semibold text-slate-700">{tTask.category || 'N/A'}</p>
                                  </div>
                                  <div>
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Difficulty</p>
                                    <p className="text-sm font-semibold text-slate-700">{tTask.difficulty || 'N/A'}</p>
                                  </div>
                                </div>
                                <div>
                                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Task Link</p>
                                  <button onClick={() => { setShowFundsModal(false); navigate(`/mentor/task/${tTask.id}/submissions`); }} className="text-xs font-bold text-ice-500 hover:text-ice-600 flex items-center gap-1.5 transition-colors">
                                    Manage Submissions <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                                  </button>
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    )
                  })
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
