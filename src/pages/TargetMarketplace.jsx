import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import Navbar from '../components/Navbar'
import TaskCard from '../components/TaskCard'
import { useAuth } from '../context/AuthContext'
import { db } from '../lib/supabase'
import { useToast } from '../components/Toast'

const fadeUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
}

const categories = ['All', 'Frontend', 'Backend', 'API', 'Design']
const sortOptions = [
  { label: 'Recent Tasks', value: 'recent' },
  { label: 'High Paying Tasks', value: 'high_paying' },
  { label: 'Winner Announced', value: 'winner_announced' },
]

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

export default function TargetMarketplace() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const toast = useToast()
  
  const [tasks, setTasks] = useState([])
  const [submissionStatuses, setSubmissionStatuses] = useState({})
  const [loading, setLoading] = useState(true)
  
  const [activeCategory, setActiveCategory] = useState('All')
  const [activeSort, setActiveSort] = useState('recent')

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true)
      try {
        const { data: tasksData, error: tasksError } = await db.getTasks()
        if (tasksError) {
          toast.error('Failed to load tasks')
        } else {
          setTasks(tasksData || [])
        }

        if (profile?.id) {
          const { data: statusData } = await db.getUserSubmissionStatuses(profile.id)
          if (statusData) setSubmissionStatuses(statusData)
        }
      } catch {
        toast.error('Network error — could not fetch data')
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [profile?.id, toast])

  const filteredAndSortedTasks = useMemo(() => {
    let result = [...tasks]
    const now = Date.now()
    result = result.map((t) => {
      const featuredActive = t.is_featured && (!t.featured_until || new Date(t.featured_until).getTime() > now)
      return { ...t, is_featured: featuredActive }
    })

    // 1. Filter by category
    if (activeCategory !== 'All') {
      result = result.filter(t => t.category === activeCategory)
    }

    // 2. Filter/Sort by selection
    if (activeSort === 'winner_announced') {
      result = result.filter(t => t.closed === true)
    } else if (activeSort === 'high_paying') {
      // Exclude closed ones optionally, or just sort them
      result = result.filter(t => !t.closed)
      result.sort((a, b) => b.reward - a.reward)
    } else {
      // recent (default)
      result = result.filter(t => !t.closed)
      result.sort((a, b) => {
        if (a.is_featured !== b.is_featured) return a.is_featured ? -1 : 1
        return new Date(b.created_at) - new Date(a.created_at)
      })
    }

    return result
  }, [tasks, activeCategory, activeSort])

  return (
    <div className="min-h-screen w-full relative overflow-hidden"
      style={{ background: 'linear-gradient(145deg, #ffffff 0%, #e0f2fe 25%, #bae6fd 55%, #f0f9ff 100%)' }}>

      <div className="blob animate-float w-[500px] h-[500px] -top-32 -right-24 fixed" style={{ background: 'radial-gradient(circle, rgba(56,189,248,0.2), transparent 70%)' }} />
      <div className="blob animate-float-delayed w-[400px] h-[400px] top-1/2 -left-20 fixed" style={{ background: 'radial-gradient(circle, rgba(14,165,233,0.15), transparent 70%)' }} />

      <div className="fixed inset-0 pointer-events-none opacity-[0.02]" style={{
        backgroundImage: 'linear-gradient(rgba(14,165,233,1) 1px, transparent 1px), linear-gradient(90deg, rgba(14,165,233,1) 1px, transparent 1px)',
        backgroundSize: '60px 60px',
      }} />

      <Navbar />

      <main className="max-w-6xl mx-auto px-4 sm:px-8 pb-16 relative z-10 pt-8">
        
        <motion.div variants={fadeUp} initial="initial" animate="animate" className="mb-8">
          <button 
            onClick={() => navigate('/dashboard')}
            className="flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-slate-800 transition-colors mb-6"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 18l-6-6 6-6"/></svg>
            Back to Dashboard
          </button>

          <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-800 tracking-tight mb-2">
            Target <span className="text-transparent bg-clip-text bg-gradient-to-r from-ice-400 to-ice-600">Marketplace</span>
          </h1>
          <p className="text-slate-500 text-sm sm:text-base">
            Discover modules created by mentors, find high-paying tasks, and start earning.
          </p>
        </motion.div>

        {/* Filters and Sorts */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-8 bg-white/40 p-4 rounded-2xl border border-white/50 backdrop-blur-md shadow-sm">
          
          <div className="flex items-center gap-2 overflow-x-auto pb-2 lg:pb-0 scrollbar-hide">
            <span className="text-xs font-black uppercase tracking-widest text-slate-400 mr-2 shrink-0">Category:</span>
            {categories.map((c) => (
              <button key={c} onClick={() => setActiveCategory(c)}
                className={`shrink-0 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  activeCategory === c
                    ? 'bg-ice-500 text-white shadow-md shadow-ice-500/25'
                    : 'bg-white/60 text-slate-500 hover:bg-white/90 border border-slate-200/50'
                }`}>
                {c}
              </button>
            ))}
          </div>

          <div className="w-px h-8 bg-slate-200 hidden lg:block"></div>

          <div className="flex items-center gap-2 overflow-x-auto pb-2 lg:pb-0 scrollbar-hide">
            <span className="text-xs font-black uppercase tracking-widest text-slate-400 mr-2 shrink-0">Sort By:</span>
            {sortOptions.map((opt) => (
              <button key={opt.value} onClick={() => setActiveSort(opt.value)}
                className={`shrink-0 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  activeSort === opt.value
                    ? 'bg-slate-800 text-white shadow-md shadow-slate-800/25'
                    : 'bg-white/60 text-slate-500 hover:bg-white/90 border border-slate-200/50'
                }`}>
                {opt.label}
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
        {!loading && filteredAndSortedTasks.length === 0 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="glass-card rounded-2xl p-12 text-center max-w-xl mx-auto mt-10">
            <div className="text-5xl mb-4">📭</div>
            <h3 className="text-xl font-bold text-slate-800 mb-2">No tasks found</h3>
            <p className="text-slate-500">
              Try adjusting your filters or sort options to find available tasks.
            </p>
          </motion.div>
        )}

        {/* Task grid */}
        {!loading && filteredAndSortedTasks.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredAndSortedTasks.map((task, index) => (
              <motion.div key={task.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05, duration: 0.4 }}>
                <TaskCard 
                  task={task} 
                  submissionStatus={submissionStatuses[task.id]} 
                  onClick={() => navigate(`/task/${task.id}`)} 
                />
              </motion.div>
            ))}
          </div>
        )}

      </main>
    </div>
  )
}
