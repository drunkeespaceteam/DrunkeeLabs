import { useParams, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import Navbar from '../components/Navbar'

const tasks = {
  1: { title: 'Build a REST API', description: 'Create a RESTful API with authentication, rate limiting, and proper error handling using Node.js and Express.', reward: 250, difficulty: 'Medium', category: 'Backend', details: 'Build a production-ready REST API that includes JWT authentication, input validation, rate limiting middleware, and comprehensive error handling. The API should follow REST best practices with proper HTTP status codes and response formats.' },
  2: { title: 'Landing Page Redesign', description: 'Redesign a SaaS landing page with modern UI patterns.', reward: 180, difficulty: 'Easy', category: 'Frontend', details: 'Create a stunning landing page with hero section, feature highlights, pricing table, testimonials, and a call-to-action. Use modern design patterns including glassmorphism, gradient accents, and smooth scroll animations.' },
  3: { title: 'Real-time Chat System', description: 'Implement a WebSocket-based chat with typing indicators.', reward: 400, difficulty: 'Hard', category: 'Backend', details: 'Build a real-time chat application using WebSockets. Include features like typing indicators, read receipts, message persistence, and online status. Support both private and group conversations.' },
  4: { title: 'Design System Components', description: 'Build a reusable component library.', reward: 300, difficulty: 'Medium', category: 'Design', details: 'Create a comprehensive design system with buttons, inputs, modals, tooltips, dropdowns, and cards. Each component should be fully accessible, themeable, and documented with usage examples.' },
  5: { title: 'Payment Gateway Integration', description: 'Integrate Stripe payment processing.', reward: 350, difficulty: 'Hard', category: 'API', details: 'Integrate Stripe for payment processing including one-time payments, subscription management, and webhook handling for payment events. Implement proper error handling and idempotency.' },
  6: { title: 'Dashboard Analytics UI', description: 'Create interactive charts and data visualizations.', reward: 220, difficulty: 'Medium', category: 'Frontend', details: 'Build an analytics dashboard with interactive charts (line, bar, pie), real-time data updates, date range filters, and export functionality. Use a charting library like Recharts or Chart.js.' },
}

const diffColors = { Easy: 'text-emerald-500 bg-emerald-50 border-emerald-200', Medium: 'text-amber-500 bg-amber-50 border-amber-200', Hard: 'text-rose-500 bg-rose-50 border-rose-200' }

export default function TaskDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const task = tasks[id]

  if (!task) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'linear-gradient(145deg, #ffffff 0%, #e0f2fe 30%, #bae6fd 60%, #f0f9ff 100%)' }}>
        <div className="glass-card rounded-2xl p-8 text-center">
          <h2 className="text-xl font-bold text-slate-800 mb-2">Task not found</h2>
          <button onClick={() => navigate('/dashboard')} className="btn-gradient px-5 py-2 rounded-xl text-white text-sm font-semibold mt-4">Back to Dashboard</button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen w-full relative overflow-hidden" style={{ background: 'linear-gradient(145deg, #ffffff 0%, #e0f2fe 25%, #bae6fd 55%, #f0f9ff 100%)' }}>
      <div className="blob animate-float w-[350px] h-[350px] -top-16 -right-16 fixed" style={{ background: 'radial-gradient(circle, rgba(56,189,248,0.2), transparent 70%)' }} />
      <div className="blob animate-float-delayed w-[300px] h-[300px] bottom-20 -left-10 fixed" style={{ background: 'radial-gradient(circle, rgba(14,165,233,0.15), transparent 70%)' }} />

      <Navbar />

      <main className="max-w-3xl mx-auto px-4 sm:px-8 pb-16 relative z-10">
        {/* Back button */}
        <motion.button
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          onClick={() => navigate('/dashboard')}
          className="flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-ice-500 transition-colors mb-6 mt-2"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m12 19-7-7 7-7" /><path d="M19 12H5" />
          </svg>
          Back to Dashboard
        </motion.button>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="glass-card rounded-2xl p-6 sm:p-8 space-y-6"
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-bold text-ice-500 uppercase tracking-wider">{task.category}</span>
                <span className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full border ${diffColors[task.difficulty]}`}>{task.difficulty}</span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-800 tracking-tight">{task.title}</h1>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-2xl font-extrabold text-slate-800">{task.reward}</p>
              <p className="text-xs text-slate-400 font-medium">rupees (₹)</p>
            </div>
          </div>

          {/* Description */}
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Description</h3>
            <p className="text-sm text-slate-600 leading-relaxed">{task.details}</p>
          </div>

          {/* Requirements */}
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Requirements</h3>
            <ul className="space-y-2">
              {['Clean, well-documented code', 'Proper error handling', 'Unit tests coverage > 80%', 'README with setup instructions'].map((req, i) => (
                <li key={i} className="flex items-center gap-2.5 text-sm text-slate-600">
                  <div className="w-5 h-5 rounded-md bg-ice-50 flex items-center justify-center flex-shrink-0">
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3 text-ice-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                  {req}
                </li>
              ))}
            </ul>
          </div>

          {/* Action buttons */}
          <div className="flex gap-3 pt-2">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="btn-gradient flex-1 py-3 rounded-xl text-white font-semibold text-sm flex items-center justify-center gap-2"
            >
              Accept & Start Task
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="px-5 py-3 rounded-xl bg-white/60 backdrop-blur-sm border border-white/70 text-sm font-semibold text-slate-500 hover:bg-white/80 transition-all"
            >
              Save for Later
            </motion.button>
          </div>
        </motion.div>
      </main>
    </div>
  )
}
