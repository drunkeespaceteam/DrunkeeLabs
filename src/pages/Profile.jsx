import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { normalizeRole } from '../utils/roles'
import { db, supabase } from '../lib/supabase'
import Navbar from '../components/Navbar'
import { useToast } from '../components/Toast'
import KYCModal from '../components/KYCModal'
import WithdrawalModal from '../components/WithdrawalModal'
import StarRating from '../components/StarRating'

const EXPERIENCE_LABEL = {
  beginner: 'Beginner',
  junior: 'Junior',
  mid: 'Mid-Level',
  senior: 'Senior',
  lead: 'Lead / Principal',
}

export default function Profile() {
  const { profile, user, role, signOut } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()

  const [loading, setLoading] = useState(true)
  const [walletBalance, setWalletBalance] = useState(0)
  const [reputation, setReputation] = useState({ rating: 0, tasks_completed: 0 })
  const [stats, setStats] = useState({ winRate: 0, totalSubmissions: 0, earnings: 0, totalSpent: 0 })
  const [activity, setActivity] = useState([])
  const [kycStatus, setKycStatus] = useState('none')
  const [userMeta, setUserMeta] = useState({ bio: '', skills: [], experience: '', github_url: '', linkedin_url: '', portfolio_url: '', avatar_url: '' })
  const [reviews, setReviews] = useState([])
  const [avgRating, setAvgRating] = useState(0)

  const [showWithdraw, setShowWithdraw] = useState(false)
  const [showKYC, setShowKYC] = useState(false)

  const isMentor = normalizeRole(role) === 'mentor'

  const fetchProfileData = useCallback(async (silent = false) => {
    if (!profile?.id) return
    if (!silent) setLoading(true)
    try {
      const [walletRes, userRes, repRes, reviewsRes] = await Promise.all([
        supabase.from('wallets').select('balance').eq('user_id', profile.id).single(),
        supabase.from('users').select('kyc_status, bio, skills, experience, github_url, linkedin_url, portfolio_url, avatar_url').eq('id', profile.id).single(),
        db.getDeveloperReputation(profile.id),
        supabase.from('reviews').select('*, reviewer:reviewer_id(name, avatar_url)').eq('target_user_id', profile.id).order('created_at', { ascending: false }).limit(20)
      ])

      if (walletRes.data) setWalletBalance(walletRes.data.balance)

      if (userRes.data) {
        setKycStatus(userRes.data.kyc_status || 'none')
        setUserMeta({
          bio: userRes.data.bio || '',
          skills: userRes.data.skills || [],
          experience: userRes.data.experience || '',
          github_url: userRes.data.github_url || '',
          linkedin_url: userRes.data.linkedin_url || '',
          portfolio_url: userRes.data.portfolio_url || '',
          avatar_url: userRes.data.avatar_url || '',
        })
      }

      if (repRes.data) setReputation(repRes.data)

      if (reviewsRes.data && reviewsRes.data.length > 0) {
        setReviews(reviewsRes.data)
        const avg = reviewsRes.data.reduce((acc, r) => acc + r.rating, 0) / reviewsRes.data.length
        setAvgRating(Math.round(avg * 10) / 10)
      }

      if (isMentor) {
        const [tasksRes, paymentsRes] = await Promise.all([
          supabase.from('tasks').select('*').eq('mentor_id', profile.id).order('created_at', { ascending: false }).limit(10),
          supabase.from('payments').select('amount').eq('mentor_id', profile.id).in('status', ['locked', 'credited'])
        ])
        if (tasksRes.data) setActivity(tasksRes.data)
        const totalSpent = paymentsRes.data ? paymentsRes.data.reduce((acc, p) => acc + p.amount, 0) : 0
        setStats({ earnings: 0, totalSpent })
      } else {
        const { data: subs } = await supabase.from('submissions').select('*, tasks(title, reward)').eq('user_id', profile.id).order('created_at', { ascending: false }).limit(10)
        if (subs) setActivity(subs)
        const totalSubs = subs?.length || 0
        const wins = subs?.filter(s => s.is_winner)?.length || 0
        const winRate = totalSubs > 0 ? Math.round((wins / totalSubs) * 100) : 0
        setStats({ winRate, totalSubmissions: totalSubs, earnings: walletRes.data?.balance || 0 })
      }
    } catch (err) {
      console.error('Data fetch error:', err)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [profile?.id, isMentor])

  useEffect(() => { fetchProfileData() }, [fetchProfileData])

  const handleLogout = async () => {
    await signOut()
    navigate('/login')
  }

  const initials = (profile?.name || 'U').split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)

  if (loading) {
    return (
      <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-[#131b2c] via-[#050505] to-black flex items-center justify-center">
        <div className="w-10 h-10 border-2 border-white/10 border-t-ice-500 rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen w-full relative overflow-y-auto bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-[#131b2c] via-[#050505] to-black pb-20">
      <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 brightness-100 contrast-150 pointer-events-none mix-blend-overlay" />
      <Navbar />

      <div className="max-w-5xl mx-auto px-6 mt-12 space-y-8 relative z-10">

        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="relative bg-slate-900/50 backdrop-blur-xl border border-white/10 rounded-3xl p-8 shadow-2xl overflow-hidden">
          <div className="absolute -right-20 -top-20 w-64 h-64 bg-ice-500/10 blur-3xl rounded-full" />

          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-8 relative z-10">
            <div className="relative flex-shrink-0">
              <div className="w-32 h-32 rounded-2xl bg-gradient-to-br from-ice-400 to-blue-600 p-0.5 shadow-[0_0_30px_rgba(14,165,233,0.3)]">
                <div className="w-full h-full bg-black rounded-2xl overflow-hidden flex items-center justify-center">
                  {userMeta.avatar_url ? (
                    <img src={userMeta.avatar_url} alt={profile?.name} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-4xl font-black text-white">{initials}</span>
                  )}
                </div>
              </div>
              {kycStatus === 'verified' && (
                <div className="absolute -bottom-1.5 -right-1.5 w-8 h-8 bg-emerald-500 rounded-xl border-2 border-black flex items-center justify-center">
                  <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
              )}
            </div>

            <div className="flex-1 text-center sm:text-left space-y-4">
              <div>
                <h1 className="text-3xl font-black text-white">{profile?.name || 'Developer'}</h1>
                <p className="text-slate-400 font-medium text-sm">{profile?.email}</p>
                {userMeta.experience && (
                  <p className="text-xs text-ice-400/70 font-semibold mt-0.5">{EXPERIENCE_LABEL[userMeta.experience] || userMeta.experience}</p>
                )}
              </div>

              {userMeta.bio && (
                <p className="text-slate-300 text-sm leading-relaxed max-w-xl">{userMeta.bio}</p>
              )}

              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3">
                <span className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider border ${isMentor ? 'bg-violet-500/10 text-violet-400 border-violet-500/20' : 'bg-ice-500/10 text-ice-400 border-ice-500/20'}`}>
                  {isMentor ? 'Mentor' : 'Employee'}
                </span>

                {kycStatus === 'verified' ? (
                  <span className="px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-bold uppercase flex items-center gap-1.5">
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                    KYC Verified
                  </span>
                ) : kycStatus === 'pending' ? (
                  <span className="px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs font-bold uppercase flex items-center gap-1.5 cursor-default" title="We are reviewing your documents">
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                    Pending KYC
                  </span>
                ) : (
                  <button onClick={() => setShowKYC(true)} className="px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-bold uppercase flex items-center gap-1.5 hover:bg-amber-500/20 transition-colors">
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    {kycStatus === 'rejected' ? 'Resubmit KYC' : 'Verify KYC'}
                  </button>
                )}

                {avgRating > 0 && (
                  <span className="px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-bold flex items-center gap-1.5">
                    <svg className="w-3.5 h-3.5 fill-amber-400" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                    {avgRating} ({reviews.length} {reviews.length === 1 ? 'review' : 'reviews'})
                  </span>
                )}

                {userMeta.github_url && (
                  <a href={userMeta.github_url} target="_blank" rel="noopener noreferrer" className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-colors">
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg>
                  </a>
                )}
                {userMeta.linkedin_url && (
                  <a href={userMeta.linkedin_url} target="_blank" rel="noopener noreferrer" className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-blue-400 transition-colors">
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                  </a>
                )}
                {userMeta.portfolio_url && (
                  <a href={userMeta.portfolio_url} target="_blank" rel="noopener noreferrer" className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-ice-400 transition-colors">
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                  </a>
                )}
              </div>

              {userMeta.skills.length > 0 && (
                <div className="flex flex-wrap justify-center sm:justify-start gap-1.5">
                  {userMeta.skills.slice(0, 10).map(skill => (
                    <span key={skill} className="px-2.5 py-1 bg-white/5 border border-white/10 rounded-lg text-xs font-medium text-slate-300">
                      {skill}
                    </span>
                  ))}
                  {userMeta.skills.length > 10 && (
                    <span className="px-2.5 py-1 bg-white/5 border border-white/10 rounded-lg text-xs font-medium text-slate-500">+{userMeta.skills.length - 10} more</span>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-3 w-full sm:w-auto flex-shrink-0">
              <button
                onClick={() => navigate('/settings/profile')}
                className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white font-semibold transition-all text-sm flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                Edit Profile
              </button>
              <button onClick={handleLogout} className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 font-semibold transition-all text-sm flex items-center justify-center gap-2">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                Sign Out
              </button>
            </div>
          </div>
        </motion.div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="col-span-1 md:col-span-2 grid grid-cols-1 sm:grid-cols-3 gap-6">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="bg-white/5 border border-white/10 rounded-3xl p-6 shadow-xl backdrop-blur-md">
              <div className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-2">Total Earnings</div>
              <div className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-teal-400">
                ₹{walletBalance.toLocaleString()}
              </div>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="bg-white/5 border border-white/10 rounded-3xl p-6 shadow-xl backdrop-blur-md">
              <div className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-2">{isMentor ? 'Tasks Created' : 'Completed Tasks'}</div>
              <div className="text-4xl font-black text-white">{reputation.tasks_completed || 0}</div>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="bg-white/5 border border-white/10 rounded-3xl p-6 shadow-xl backdrop-blur-md">
              <div className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-2">{isMentor ? 'Total Spent' : 'Win Rate'}</div>
              <div className="text-4xl font-black text-ice-400">
                {isMentor ? `₹${stats.totalSpent?.toLocaleString() || 0}` : `${stats.winRate}%`}
              </div>
            </motion.div>
          </div>

          {/* Wallet */}
          <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 }} className="col-span-1 bg-gradient-to-br from-slate-900 to-black border border-white/10 rounded-3xl p-6 shadow-2xl relative overflow-hidden flex flex-col justify-between">
            <div className="absolute -right-10 -bottom-10 w-40 h-40 bg-emerald-500/10 blur-3xl rounded-full" />
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Wallet Balance</h3>
                <svg className="w-5 h-5 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
              </div>
              <div className="text-4xl font-black text-white mb-1">₹{walletBalance.toLocaleString()}</div>
              <p className="text-xs text-slate-500 font-medium">Available to withdraw</p>
            </div>
            <div className="mt-6">
              <button
                onClick={() => {
                  if (kycStatus === 'verified') setShowWithdraw(true)
                  else if (kycStatus === 'pending') toast.info('KYC is under review. You can withdraw after it is approved.')
                  else setShowKYC(true)
                }}
                disabled={walletBalance < 100}
                className="w-full py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white font-bold transition-all shadow-[0_0_15px_rgba(16,185,129,0.3)] disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-widest text-xs"
              >
                Withdraw Funds
              </button>
            </div>
          </motion.div>
        </div>

        {/* Reviews Section */}
        {reviews.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }} className="bg-slate-900/50 backdrop-blur-xl border border-white/10 rounded-3xl p-8 shadow-2xl">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-black text-white uppercase tracking-wider">Reviews</h2>
              <div className="flex items-center gap-3">
                <StarRating value={Math.round(avgRating)} readOnly size="sm" />
                <span className="text-2xl font-black text-amber-400">{avgRating}</span>
                <span className="text-sm text-slate-500">({reviews.length})</span>
              </div>
            </div>
            <div className="space-y-4">
              {reviews.map(review => (
                <div key={review.id} className="p-5 rounded-2xl bg-white/5 border border-white/10">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-ice-400 to-blue-600 flex items-center justify-center text-white text-sm font-black">
                        {(review.reviewer?.name || 'U').charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="text-sm font-bold text-white">{review.reviewer?.name || 'Anonymous'}</div>
                        <div className="text-xs text-slate-500">{new Date(review.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
                      </div>
                    </div>
                    <StarRating value={review.rating} readOnly size="sm" />
                  </div>
                  {review.review && <p className="text-sm text-slate-300 leading-relaxed">{review.review}</p>}
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* Activity */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="bg-slate-900/50 backdrop-blur-xl border border-white/10 rounded-3xl p-8 shadow-2xl">
          <h2 className="text-lg font-black text-white mb-6 uppercase tracking-wider">Recent Activity</h2>
          <div className="space-y-4">
            {activity.length === 0 ? (
              <div className="text-center py-10 text-slate-500 text-sm font-medium">No recent activity found.</div>
            ) : (
              activity.map((item, i) => (
                <div key={item.id || i} className="flex items-center justify-between p-4 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors">
                  <div className="flex items-center gap-4">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg ${isMentor ? 'bg-violet-500/20 text-violet-400' : (item.is_winner ? 'bg-amber-500/20 text-amber-400' : 'bg-ice-500/20 text-ice-400')}`}>
                      {isMentor ? '📝' : (item.is_winner ? '🏆' : '💻')}
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-white">{isMentor ? item.title : (item.tasks?.title || 'Task Submission')}</h4>
                      <p className="text-xs text-slate-400">{new Date(item.created_at).toLocaleDateString()}</p>
                    </div>
                  </div>
                  {!isMentor && (
                    <div className="text-right">
                      <div className={`text-sm font-black ${item.is_winner ? 'text-amber-400' : 'text-slate-300'}`}>
                        {item.is_winner ? `Won ₹${item.tasks?.reward}` : `Score: ${item.score || '—'}`}
                      </div>
                      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mt-0.5">{item.delivery_status}</div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </motion.div>

      </div>

      <WithdrawalModal isOpen={showWithdraw} onClose={() => setShowWithdraw(false)} walletBalance={walletBalance} userId={profile?.id || user?.id} onWithdrawSuccess={() => fetchProfileData(true)} />
      <KYCModal isOpen={showKYC} onClose={() => setShowKYC(false)} currentStatus={kycStatus} userId={profile?.id || user?.id} onKycSuccess={() => fetchProfileData(true)} />
    </div>
  )
}
