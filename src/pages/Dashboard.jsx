import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import Navbar from '../components/Navbar'
import TaskCard from '../components/TaskCard'
import ProgressCard from '../components/ProgressCard'
import { useAuth } from '../context/AuthContext'
import { db, supabase } from '../lib/supabase'
import { useToast } from '../components/Toast'
import WithdrawalModal from '../components/WithdrawalModal'
import ArenaModeCard from '../components/ArenaModeCard'

const fadeUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
}

const filters = ['All', 'Frontend', 'Backend', 'API', 'Design']

function TaskSkeleton() {
  return (
    <div className="glass-card rounded-2xl p-5 animate-pulse">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 rounded-xl bg-slate-200" />
        <div className="h-3 bg-slate-200 rounded w-16" />
      </div>
      <div className="h-4 bg-slate-200 rounded w-3/4 mb-2" />
      <div className="h-3 bg-slate-200 rounded w-full mb-1" />
      <div className="h-3 bg-slate-200 rounded w-2/3 mb-4" />
      <div className="flex justify-between items-center">
        <div className="h-3 bg-slate-200 rounded w-12" />
        <div className="h-8 bg-slate-200 rounded-lg w-20" />
      </div>
    </div>
  )
}

export default function Dashboard() {
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const toast = useToast()
  const [tasks, setTasks] = useState([])
  const [recentWorkspaces, setRecentWorkspaces] = useState([])
  const [earnings, setEarnings] = useState([])
  const [reputation, setReputation] = useState({ completedTasks: 0, winRate: 0 })
  const [walletBalance, setWalletBalance] = useState(0)
  const [submissionStatuses, setSubmissionStatuses] = useState({})
  const [isWithdrawModalOpen, setIsWithdrawModalOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [activeFilter, setActiveFilter] = useState('All')

  const fullName = profile?.name || user?.user_metadata?.name || 'Developer'
  const userName = fullName.split(' ')[0]

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true)
      try {
        const { data: tasksData, error: tasksError } = await db.getTasks()
        if (tasksError) {
          toast.error('Failed to load tasks')
          console.error(tasksError)
        } else {
          setTasks(tasksData || [])
        }

        if (profile?.id) {
          const [wsData, earnData, repData, walletData, statusData] = await Promise.all([
            db.getRecentWorkspaces(profile.id),
            db.getEmployeeEarnings(profile.id),
            db.getDeveloperReputation(profile.id),
            supabase.from('wallets').select('balance').eq('user_id', profile.id).single(),
            db.getUserSubmissionStatuses(profile.id)
          ])
          if (wsData.data) setRecentWorkspaces(wsData.data)
          if (earnData.data) setEarnings(earnData.data)
          if (repData.data) setReputation(repData.data)
          if (walletData.data) setWalletBalance(walletData.data.balance || 0)
          if (statusData.data) setSubmissionStatuses(statusData.data)
        }
      } catch {
        toast.error('Network error — could not fetch data')
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [profile?.id])

  const filteredTasks = useMemo(() => {
    if (activeFilter === 'All') return tasks
    return tasks.filter((t) => t.category === activeFilter)
  }, [tasks, activeFilter])

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  const totalEarnings = earnings.reduce((sum, p) => sum + p.amount, 0)

  return (
    <div className="min-h-screen w-full relative overflow-hidden"
      style={{ background: 'linear-gradient(145deg, #ffffff 0%, #e0f2fe 25%, #bae6fd 55%, #f0f9ff 100%)' }}>

      <div className="blob animate-float w-[500px] h-[500px] -top-32 -right-24 fixed" style={{ background: 'radial-gradient(circle, rgba(56,189,248,0.2), transparent 70%)' }} />
      <div className="blob animate-float-delayed w-[400px] h-[400px] top-1/2 -left-20 fixed" style={{ background: 'radial-gradient(circle, rgba(14,165,233,0.15), transparent 70%)' }} />
      <div className="blob animate-float w-[300px] h-[300px] bottom-10 right-1/4 fixed" style={{ background: 'radial-gradient(circle, rgba(56,189,248,0.1), transparent 70%)', animationDelay: '3s' }} />

      <div className="fixed inset-0 pointer-events-none opacity-[0.02]" style={{
        backgroundImage: 'linear-gradient(rgba(14,165,233,1) 1px, transparent 1px), linear-gradient(90deg, rgba(14,165,233,1) 1px, transparent 1px)',
        backgroundSize: '60px 60px',
      }} />

      <Navbar />

      <main className="max-w-6xl mx-auto px-4 sm:px-8 pb-16 relative z-10">
        {/* Welcome */}
        <motion.section variants={fadeUp} initial="initial" animate="animate" transition={{ duration: 0.6 }} className="pt-4 pb-8">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
            <div>
              <motion.p initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 }} className="text-sm font-semibold text-ice-500 mb-1 tracking-wide">
                {greeting} 👋
              </motion.p>
              <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-800 tracking-tight">
                Welcome back, <span className="text-transparent bg-clip-text bg-gradient-to-r from-ice-400 to-ice-600">{userName}</span>
              </h1>
              <p className="text-slate-500 mt-1.5 text-sm sm:text-base">
                {tasks.length > 0 ? `${tasks.length} tasks available in the marketplace` : 'Ready to take on new challenges?'}
              </p>
            </div>

            <div className="flex gap-2.5">
              <motion.button 
                whileHover={{ scale: 1.03, y: -1 }} whileTap={{ scale: 0.97 }}
                onClick={() => navigate('/marketplace')}
                className="btn-gradient px-5 py-2.5 rounded-xl text-white text-sm font-semibold flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                Start New Task
              </motion.button>
              <motion.button 
                whileHover={{ scale: 1.03, y: -1 }} whileTap={{ scale: 0.97 }}
                onClick={() => navigate('/submissions')}
                className="glass-card-subtle px-5 py-2.5 rounded-xl text-slate-600 text-sm font-semibold flex items-center gap-2 hover:shadow-md transition-shadow">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" /><polyline points="14 2 14 8 20 8" /></svg>
                View Submissions
              </motion.button>
            </div>
          </div>
        </motion.section>

        {/* Earnings & Rewards */}
        <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="mb-10">
          <h2 className="text-xl font-bold text-slate-800 mb-4 flex items-center gap-2">
            <span className="text-emerald-500">🏆</span> Reputation & Rewards
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-stretch">
            
            {/* Developer Reputation Highlight */}
            <div className="glass-card rounded-2xl p-6 relative overflow-hidden group col-span-1 border-indigo-500/20 shadow-lg shadow-indigo-500/5">
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity text-6xl">📈</div>
              <p className="text-sm font-bold text-slate-500 uppercase tracking-widest mb-1">Win Rate</p>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-br from-indigo-400 to-indigo-600">{reputation.winRate}%</span>
              </div>
              <p className="text-xs text-slate-400 mt-3 font-semibold">{reputation.completedTasks} wins across all submissions</p>
            </div>

            {/* Total Highlight */}
            <div className="glass-card rounded-2xl p-6 relative overflow-hidden group col-span-1 border-emerald-500/20 shadow-lg shadow-emerald-500/5 flex flex-col justify-between">
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity text-7xl">💰</div>
              <div>
                <p className="text-sm font-bold text-slate-500 uppercase tracking-widest mb-1">Total Earned</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-br from-emerald-400 to-emerald-600">₹{totalEarnings}</span>
                </div>
                <p className="text-xs text-slate-400 mt-3 font-semibold">From {earnings.length} completed tasks</p>
              </div>
            </div>

            {/* Wallet Balance Highlight */}
            <div className="glass-card rounded-2xl p-6 relative overflow-hidden group col-span-1 md:col-span-2 border-amber-500/20 shadow-lg shadow-amber-500/5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity text-7xl">💳</div>
              <div>
                <p className="text-sm font-bold text-amber-500 uppercase tracking-widest mb-1 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
                  Current Wallet Balance
                </p>
                <div className="flex items-baseline gap-2">
                  <span className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-br from-amber-400 to-amber-600">₹{walletBalance}</span>
                </div>
                <p className="text-xs text-slate-400 mt-2 font-semibold">Available for withdrawal</p>
              </div>
              <motion.button 
                whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                onClick={() => setIsWithdrawModalOpen(true)}
                className="px-6 py-3 bg-amber-500 hover:bg-amber-400 text-black text-sm font-bold rounded-xl shadow-[0_0_20px_rgba(245,158,11,0.3)] transition-all z-10"
              >
                Withdraw Funds
              </motion.button>
            </div>

            {/* List of Payments */}
            <div className="glass-card rounded-2xl p-4 col-span-1 md:col-span-2 min-h-[140px]">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3 px-2">Recent Payments</h3>
              {earnings.length === 0 ? (
                <div className="text-center py-6 px-4">
                  <p className="text-slate-400 text-sm">Complete tasks and get selected as a winner to earn rewards!</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {earnings.slice(0, 3).map((payment) => (
                    <div key={payment.id} className="bg-white/40 border border-white/50 rounded-xl p-3 flex items-center justify-between hover:bg-white/60 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-sm">₹</div>
                        <div>
                          <p className="text-sm font-bold text-slate-700">{payment.tasks?.title || 'Unknown Task'}</p>
                          <p className="text-[10px] text-slate-400">{new Date(payment.released_at).toLocaleDateString()}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="text-base font-black text-emerald-600">+₹{payment.amount}</span>
                      </div>
                    </div>
                  ))}
                  {earnings.length > 3 && (
                    <button className="w-full text-center text-xs font-bold text-ice-500 hover:text-ice-600 py-2">
                      View all {earnings.length} payments
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </motion.section>

        {/* Arena Mode Card (Phase 2) */}
        <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="mb-10">
          <ArenaModeCard />
        </motion.section>

        {/* Continue where you left off */}
        {recentWorkspaces.length > 0 && (
          <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.5 }} className="mb-10">
            <h2 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-ice-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
              Continue where you left off
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {recentWorkspaces.map(ws => (
                <div key={ws.task_id} className="glass-card rounded-2xl p-5 flex flex-col justify-between hover:shadow-lg transition-all group">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-ice-500 bg-ice-50 px-2 py-0.5 rounded-full">{ws.tasks?.category || 'Task'}</span>
                      <span className="text-xs text-slate-400 font-medium">{new Date(ws.updated_at).toLocaleDateString()}</span>
                    </div>
                    <h3 className="text-base font-bold text-slate-800 mb-1">{ws.tasks?.title || 'Unknown Task'}</h3>
                    <p className="text-xs text-slate-500">{Object.keys(ws.files).length} files saved</p>
                  </div>
                  <button 
                    onClick={() => navigate(`/task/${ws.task_id}`)}
                    className="mt-4 w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-semibold transition-colors flex items-center justify-center gap-2"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                    Resume Project
                  </button>
                </div>
              ))}
            </div>
          </motion.section>
        )}

        {/* Progress */}
        <motion.section initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, duration: 0.6 }} className="mb-10">
          <ProgressCard />
        </motion.section>

        {/* Task Marketplace */}
        <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25, duration: 0.5 }}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
            <div>
              <h2 className="text-xl font-bold text-slate-800">Task Marketplace</h2>
              <p className="text-sm text-slate-400 mt-0.5">Choose a task and start earning</p>
            </div>

            <div className="flex gap-1.5 flex-wrap">
              {filters.map((f) => (
                <button key={f} onClick={() => setActiveFilter(f)}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    activeFilter === f
                      ? 'bg-ice-500 text-white shadow-md shadow-ice-500/25'
                      : 'bg-white/50 text-slate-500 hover:bg-white/80 border border-slate-200/50'
                  }`}>
                  {f}
                </button>
              ))}
            </div>
          </div>

          {/* Loading skeletons */}
          {loading && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3, 4, 5, 6].map((i) => <TaskSkeleton key={i} />)}
            </div>
          )}

          {/* Empty state */}
          {!loading && filteredTasks.length === 0 && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="glass-card rounded-2xl p-12 text-center">
              <div className="text-4xl mb-3">📭</div>
              <h3 className="text-lg font-bold text-slate-700 mb-1">No tasks available</h3>
              <p className="text-sm text-slate-400">
                {activeFilter !== 'All' ? `No ${activeFilter} tasks found. Try another filter.` : 'Check back soon for new tasks!'}
              </p>
            </motion.div>
          )}

          {/* Task grid */}
          {!loading && filteredTasks.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredTasks.map((task, index) => (
                <motion.div key={task.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.05 + index * 0.04, duration: 0.4 }}>
                  <TaskCard task={task} submissionStatus={submissionStatuses[task.id]} onClick={() => navigate(`/task/${task.id}`)} />
                </motion.div>
              ))}
            </div>
          )}
        </motion.section>
      </main>

      <div className="text-center pb-8 relative z-10">
        <p className="text-xs text-ice-500/40 font-medium tracking-widest uppercase">Powered by NexusDev Platform</p>
      </div>

      <WithdrawalModal 
        isOpen={isWithdrawModalOpen} 
        onClose={() => setIsWithdrawModalOpen(false)} 
        walletBalance={walletBalance}
        userId={profile?.id}
        kycStatus={profile?.kyc_status}
        onWithdrawSuccess={() => {
          supabase.from('wallets').select('balance').eq('user_id', profile?.id).single().then(res => {
            if (res.data) setWalletBalance(res.data.balance || 0)
          })
        }}
      />
    </div>
  )
}
