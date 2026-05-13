import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { normalizeRole } from '../utils/roles'

export default function Navbar() {
  const navigate = useNavigate()
  const location = useLocation()
  const isAdminShell = location.pathname.startsWith('/admin')
  const { user, profile, role, signOut, isAuthenticated } = useAuth()

  const userName = profile?.name || user?.user_metadata?.name || 'User'
  const initials = userName.split(' ').map(n => n[0]).join('').toUpperCase()
  const r = normalizeRole(role)
  const isAdmin = r === 'admin'
  const isMentor = r === 'mentor'
  const dashboardPath = isAdmin ? '/admin' : isMentor ? '/mentor/dashboard' : '/dashboard'
  const adminLinks = [
    { label: 'Admin Dashboard', path: '/admin' },
    { label: 'Revenue', path: '/admin?tab=revenue' },
    { label: 'KYC Review', path: '/admin?tab=kyc' },
    { label: 'Users', path: '/admin?tab=users' },
    { label: 'Tasks', path: '/admin?tab=tasks' },
    { label: 'Sandboxes', path: '/admin?tab=sandboxes' },
    { label: 'Monitoring', path: '/admin?tab=monitoring' },
    { label: 'Reports', path: '/admin?tab=reports' }
  ]

  const [notifications, setNotifications] = useState([])
  const [showNotifications, setShowNotifications] = useState(false)
  const [showProfileMenu, setShowProfileMenu] = useState(false)
  
  const notifRef = useRef(null)
  const profileRef = useRef(null)

  useEffect(() => {
    if (!profile?.id) return

    const fetchNotifications = async () => {
      const { data } = await supabase.from('notifications').select('*').eq('user_id', profile.id).order('created_at', { ascending: false }).limit(20)
      if (data) setNotifications(data)
    }

    fetchNotifications()

    const subscription = supabase.channel('notifications_channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${profile.id}` }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setNotifications((prev) => [payload.new, ...prev])
        } else if (payload.eventType === 'UPDATE') {
          setNotifications((prev) => {
            const others = prev.filter(n => n.id !== payload.new.id)
            return [payload.new, ...others].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
          })
        }
      })
      .subscribe()

    return () => {
      supabase.removeChannel(subscription)
    }
  }, [profile?.id])

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (notifRef.current && !notifRef.current.contains(event.target)) setShowNotifications(false)
      if (profileRef.current && !profileRef.current.contains(event.target)) setShowProfileMenu(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const unreadCount = notifications.filter((n) => !n.is_read).length

  const handleMarkAsRead = async () => {
    if (unreadCount === 0) return
    setNotifications(notifications.map(n => ({ ...n, is_read: true })))
    await fetch('/mark-notifications-read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: profile?.id })
    })
  }

  const handleNotificationClick = () => {
    setShowNotifications(!showNotifications)
    if (!showNotifications) handleMarkAsRead()
  }

  const handleLogout = async () => {
    await signOut()
    navigate('/login')
  }

  return (
    <motion.nav
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
      className={`w-full px-4 sm:px-8 py-4 flex items-center justify-between relative z-20 ${
        isAdminShell ? 'bg-slate-950/90 border-b border-white/10 backdrop-blur-md text-slate-100' : ''
      }`}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 cursor-pointer" onClick={() => navigate(dashboardPath)}>
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-ice-400 to-ice-600 flex items-center justify-center shadow-lg shadow-ice-500/25">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 2 7 12 12 22 7 12 2" />
            <polyline points="2 17 12 22 22 17" />
            <polyline points="2 12 12 17 22 12" />
          </svg>
        </div>
        <span className={`text-lg font-bold tracking-tight hidden sm:block ${isAdminShell ? 'text-white' : 'text-slate-800'}`}>
          Nexus<span className="text-ice-400">Dev</span>
        </span>
      </div>

      {/* Right side */}
      <div className="flex items-center gap-3 sm:gap-4">
        {/* Role badge */}
        {isAuthenticated && (
          <div className={`hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider border ${
            isMentor
              ? 'bg-violet-50/80 text-violet-600 border-violet-200/60'
              : isAdmin
                ? isAdminShell
                  ? 'bg-rose-500/25 text-rose-100 border-rose-400/40'
                  : 'bg-rose-50/80 text-rose-600 border-rose-200/60'
                : 'bg-ice-50/80 text-ice-600 border-ice-200/60'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isMentor ? 'bg-violet-400' : isAdmin ? 'bg-rose-400' : 'bg-ice-400'}`} />
            {isAdmin ? 'Admin Mode' : isMentor ? 'Mentor Mode' : 'User Mode'}
          </div>
        )}

        {/* Notification bell */}
        <div className="relative" ref={notifRef}>
          <button onClick={handleNotificationClick} className={`relative w-9 h-9 rounded-xl flex items-center justify-center transition-all hover:shadow-sm ${
            isAdminShell
              ? 'bg-white/10 border border-white/15 text-slate-200 hover:text-white hover:bg-white/15'
              : 'bg-white/50 backdrop-blur-sm border border-white/60 text-slate-500 hover:text-ice-500 hover:bg-white/70'
          }`}>
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
              <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
            </svg>
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full border-2 border-white text-[9px] font-bold text-white flex items-center justify-center shadow-sm">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          <AnimatePresence>
            {showNotifications && (
              <motion.div initial={{ opacity: 0, y: 10, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.95 }} transition={{ duration: 0.2 }} className="absolute right-0 mt-3 w-80 bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden z-50">
                <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                  <h3 className="font-bold text-slate-800 text-sm">Notifications</h3>
                  {unreadCount > 0 && <span className="text-xs text-ice-500 font-semibold cursor-pointer hover:text-ice-600" onClick={handleMarkAsRead}>Mark all read</span>}
                </div>
                <div className="max-h-80 overflow-y-auto">
                  {notifications.length === 0 ? (
                    <div className="p-6 text-center text-slate-400 text-sm">No notifications yet</div>
                  ) : (
                    notifications.map((notif) => (
                      <div key={notif.id} onClick={() => { if (notif.link) { navigate(notif.link); setShowNotifications(false) } }} className={`p-4 border-b border-slate-50 last:border-0 hover:bg-slate-50 cursor-pointer transition-colors ${!notif.is_read ? 'bg-ice-50/30' : ''}`}>
                        <div className="flex gap-3">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                            notif.type === 'winner' ? 'bg-amber-100 text-amber-600' :
                            notif.type === 'payment' ? 'bg-emerald-100 text-emerald-600' :
                            notif.type === 'message' ? 'bg-blue-100 text-blue-600' :
                            notif.type === 'submission' ? 'bg-violet-100 text-violet-600' :
                            notif.type === 'task' ? 'bg-sky-100 text-sky-600' :
                            notif.type === 'kyc' ? 'bg-teal-100 text-teal-600' :
                            notif.type === 'withdrawal' ? 'bg-orange-100 text-orange-600' :
                            notif.type === 'info' ? 'bg-slate-100 text-slate-600' :
                            'bg-slate-100 text-slate-600'
                          }`}>
                            {notif.type === 'winner' ? '🏆' :
                             notif.type === 'payment' ? '💰' :
                             notif.type === 'message' ? '💬' :
                             notif.type === 'submission' ? '📦' :
                             notif.type === 'task' ? '🚀' :
                             notif.type === 'kyc' ? '🛡️' :
                             notif.type === 'withdrawal' ? '🏦' :
                             notif.type === 'info' ? 'ℹ️' : '🔔'}
                          </div>
                          <div>
                            <p className={`text-sm text-slate-700 ${!notif.is_read ? 'font-semibold' : ''}`}>{notif.message}</p>
                            <p className="text-[10px] text-slate-400 mt-1 font-medium">{new Date(notif.created_at).toLocaleDateString()} at {new Date(notif.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* User Profile Dropdown */}
        <div className="relative" ref={profileRef}>
          <div onClick={() => setShowProfileMenu(!showProfileMenu)} className={`flex items-center gap-2.5 rounded-2xl pl-2 pr-3 py-1.5 cursor-pointer transition-colors ${
            isAdminShell
              ? 'bg-white/10 border border-white/15 hover:bg-white/15'
              : 'glass-card-subtle hover:bg-white/60'
          }`}>
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-ice-300 to-ice-500 flex items-center justify-center text-white text-xs font-bold shadow-md shadow-ice-400/20">
              {initials}
            </div>
            <span className={`text-sm font-semibold hidden sm:block ${isAdminShell ? 'text-slate-100' : 'text-slate-700'}`}>{userName}</span>
            <svg className={`w-3 h-3 ml-1 hidden sm:block ${isAdminShell ? 'text-slate-400' : 'text-slate-400'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>
          </div>

          <AnimatePresence>
            {showProfileMenu && (
              <motion.div initial={{ opacity: 0, y: 10, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.95 }} transition={{ duration: 0.2 }} className="absolute right-0 mt-3 w-48 bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden z-50 py-1">
                <button onClick={() => { navigate('/profile'); setShowProfileMenu(false); }} className="w-full text-left px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 hover:text-ice-600 flex items-center gap-2 transition-colors">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                  My Profile
                </button>
                {isAdmin && (
                  <>
                    <div className="h-px bg-slate-100 my-1" />
                    {adminLinks.map((link) => (
                      <button
                        key={link.path}
                        onClick={() => { navigate(link.path); setShowProfileMenu(false) }}
                        className="w-full text-left px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 hover:text-rose-600 flex items-center gap-2 transition-colors"
                      >
                        {link.label}
                      </button>
                    ))}
                  </>
                )}
                <div className="h-px bg-slate-100 my-1" />
                <button onClick={handleLogout} className="w-full text-left px-4 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50 flex items-center gap-2 transition-colors">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                  Sign Out
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.nav>
  )
}
