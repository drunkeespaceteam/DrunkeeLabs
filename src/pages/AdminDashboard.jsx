import { useState, useEffect, useMemo, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { BarChart3, Activity, Users, Wallet, Server, ShieldCheck, Settings, FileBarChart2, ListChecks, AlertTriangle, FileCheck } from 'lucide-react'
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell, BarChart, Bar } from 'recharts'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../components/Toast'
import { normalizeRole } from '../utils/roles'
import Navbar from '../components/Navbar'
import AdminSandboxPanel from '../components/AdminSandboxPanel'

const tabs = [
  { id: 'overview', label: 'Overview', icon: Activity },
  { id: 'revenue', label: 'Revenue', icon: Wallet },
  { id: 'tasks', label: 'Tasks', icon: ListChecks },
  { id: 'users', label: 'Users', icon: Users },
  { id: 'kyc', label: 'KYC Review', icon: FileCheck },
  { id: 'withdrawals', label: 'Withdrawals', icon: ShieldCheck },
  { id: 'sandboxes', label: 'Sandboxes', icon: Server },
  { id: 'reports', label: 'Reports', icon: FileBarChart2 },
  { id: 'monitoring', label: 'System Monitoring', icon: AlertTriangle },
  { id: 'settings', label: 'Settings', icon: Settings }
]

export default function AdminDashboard() {
  const { user, role } = useAuth()
  const toast = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const tabFromQuery = searchParams.get('tab') || 'overview'
  const [activeTab, setActiveTab] = useState(tabFromQuery)
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({})
  const [allData, setAllData] = useState({ users: [], tasks: [], withdrawals: [], payments: [], kyc: [] })
  const [revenue, setRevenue] = useState({ total: 0, byType: {}, daily: [] })
  const [monitoring, setMonitoring] = useState({ queue: {}, containers: [], redisHealthy: false, dockerHealthy: false, uptimeSeconds: 0 })

  const fetchAdminData = useCallback(async () => {
    if (normalizeRole(role) !== 'admin' || !user?.id) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const headers = { 'x-admin-id': user.id }
      const [statsRes, allRes, revRes, monRes] = await Promise.all([
        fetch('/admin/stats', { headers }),
        fetch('/admin/all-data', { headers }),
        fetch('/admin/revenue', { headers }),
        fetch('/admin/system-monitoring', { headers })
      ])
      const [statsJson, allJson, revJson, monJson] = await Promise.all([statsRes.json(), allRes.json(), revRes.json(), monRes.json()])
      if (statsJson.success) setStats(statsJson.stats || {})
      if (allJson.success) {
        const asArr = (v) => (Array.isArray(v) ? v : [])
        setAllData({
          users: asArr(allJson.users),
          tasks: asArr(allJson.tasks),
          withdrawals: asArr(allJson.withdrawals),
          payments: asArr(allJson.payments),
          kyc: asArr(allJson.kyc)
        })
      }
      if (revJson.success) setRevenue({ total: revJson.total || 0, byType: revJson.byType || {}, daily: Array.isArray(revJson.daily) ? revJson.daily : [] })
      if (monJson.success) setMonitoring(monJson)
    } catch (err) {
      console.error('[AdminDashboard] fetchAdminData', err)
      toast.error('Failed to load admin data')
    } finally {
      setLoading(false)
    }
  }, [role, user?.id, toast])

  useEffect(() => { fetchAdminData() }, [fetchAdminData])
  useEffect(() => { setActiveTab(tabFromQuery) }, [tabFromQuery])

  const setTab = (id) => {
    setActiveTab(id)
    setSearchParams({ tab: id })
  }

  const adminPost = async (path, body, successMsg) => {
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-id': user.id },
        body: JSON.stringify({ ...body, adminId: user.id })
      })
      const json = await res.json()
      if (!json.success) return toast.error(json.message || 'Request failed')
      toast.success(successMsg || json.message)
      fetchAdminData()
    } catch {
      toast.error('Action failed')
    }
  }

  const pieData = useMemo(() => ([
    { name: 'Task Fees', value: revenue.byType.task_fee || 0 },
    { name: 'Withdrawal Fees', value: revenue.byType.withdrawal_fee || 0 },
    { name: 'Featured Fees', value: revenue.byType.featured_fee || 0 }
  ]), [revenue.byType])

  if (normalizeRole(role) !== 'admin') return <div className="min-h-screen bg-black text-white flex items-center justify-center">Access denied</div>

  return (
    <div className="min-h-screen bg-[#04070f] text-slate-200">
      <Navbar />
      <div className="max-w-[1400px] mx-auto px-6 py-8 flex gap-6">
        <aside className="w-64 shrink-0 rounded-2xl bg-slate-900/70 border border-white/10 p-3 h-fit sticky top-4">
          {tabs.map((tab) => {
            const Icon = tab.icon
            return (
              <button key={tab.id} onClick={() => setTab(tab.id)} className={`w-full text-left px-3 py-2.5 rounded-xl mb-1 text-sm flex items-center gap-2 ${activeTab === tab.id ? 'bg-sky-500 text-white' : 'text-slate-300 hover:bg-white/10'}`}>
                <Icon size={16} /> {tab.label}
              </button>
            )
          })}
        </aside>

        <main className="flex-1 space-y-6">
          {loading ? <div className="py-20 text-center text-slate-400">Loading admin platform...</div> : (
            <>
              {activeTab === 'overview' && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  {[
                    ['Total Revenue', `₹${Number(stats.totalRevenue || 0).toLocaleString()}`],
                    ['Revenue Today', `₹${Number((revenue.daily || []).slice(-1)[0]?.amount || 0).toLocaleString()}`],
                    ['Active Users', (Array.isArray(allData.users) ? allData.users : []).filter(u => !u.is_suspended).length],
                    ['Active Containers', stats.activeContainers || 0],
                    ['Total Tasks', stats.activeTasks || 0],
                    ['Pending KYC', stats.pendingKYC || 0],
                    ['Pending Withdrawals', stats.pendingWithdrawals || 0],
                    ['Running Sandboxes', stats.runningSandboxes || 0],
                    ['Failed Sandboxes', stats.failedSandboxes || 0]
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-2xl bg-slate-900/70 border border-white/10 p-4">
                      <div className="text-xs text-slate-400 uppercase tracking-wider">{label}</div>
                      <div className="text-2xl font-black mt-2">{value}</div>
                    </div>
                  ))}
                </div>
              )}

              {activeTab === 'revenue' && (
                <div className="grid lg:grid-cols-2 gap-4">
                  <div className="rounded-2xl bg-slate-900/70 border border-white/10 p-4 h-80">
                    <h3 className="font-bold mb-3">Daily Revenue</h3>
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={revenue.daily}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                        <XAxis dataKey="date" stroke="#94a3b8" />
                        <YAxis stroke="#94a3b8" />
                        <Tooltip />
                        <Area dataKey="amount" stroke="#38bdf8" fill="#0ea5e9" fillOpacity={0.25} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="rounded-2xl bg-slate-900/70 border border-white/10 p-4 h-80">
                    <h3 className="font-bold mb-3">Earnings by Type</h3>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={pieData} dataKey="value" nameKey="name" outerRadius={100}>
                          {pieData.map((_, i) => <Cell key={i} fill={['#38bdf8', '#22c55e', '#f59e0b'][i % 3]} />)}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {activeTab === 'tasks' && (
                <div className="rounded-2xl bg-slate-900/70 border border-white/10 p-4 overflow-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-slate-400"><th>Title</th><th>Reward</th><th>Featured</th><th>Status</th><th></th></tr></thead>
                    <tbody>
                      {allData.tasks.map((t) => (
                        <tr key={t.id} className="border-t border-white/5">
                          <td className="py-2">{t.title}</td>
                          <td>₹{t.reward}</td>
                          <td>{t.is_featured ? '⭐ Featured' : '-'}</td>
                          <td>{t.closed ? 'Closed' : 'Active'}</td>
                          <td className="text-right space-x-2">
                            <button onClick={() => adminPost('/admin/toggle-task-featured', { taskId: t.id, isFeatured: !t.is_featured }, t.is_featured ? 'Unfeatured' : 'Featured')} className="px-2 py-1 rounded bg-sky-600 text-white">{t.is_featured ? 'Unfeature' : 'Feature'}</button>
                            <button onClick={() => adminPost('/admin/remove-task', { taskId: t.id }, 'Task removed')} className="px-2 py-1 rounded bg-rose-600 text-white">Remove</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {activeTab === 'users' && (
                <div className="rounded-2xl bg-slate-900/70 border border-white/10 p-4 overflow-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-slate-400"><th>Name</th><th>Email</th><th>Role</th><th>KYC</th><th></th></tr></thead>
                    <tbody>
                      {allData.users.map((u) => (
                        <tr key={u.id} className="border-t border-white/5">
                          <td className="py-2">{u.name}</td><td>{u.email}</td><td>{u.role}</td><td>{u.kyc_status || '-'}</td>
                          <td className="text-right">
                            <button onClick={() => adminPost('/admin/toggle-user-status', { userId: u.id, isSuspended: !u.is_suspended }, u.is_suspended ? 'User activated' : 'User suspended')} className="px-2 py-1 rounded bg-rose-600 text-white">{u.is_suspended ? 'Unsuspend' : 'Suspend'}</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {activeTab === 'kyc' && (
                <div className="space-y-4">
                  <div className="rounded-2xl bg-slate-900/70 border border-white/10 p-4 overflow-auto">
                    <h3 className="font-bold mb-4 text-white">KYC Submissions ({Array.isArray(allData.kyc) ? allData.kyc.length : 0})</h3>
                    <table className="w-full text-sm">
                      <thead><tr className="text-left text-slate-400"><th>User</th><th>Name</th><th>PAN</th><th>Bank</th><th>ID Type</th><th>Status</th><th>Submitted</th><th></th></tr></thead>
                      <tbody>
                        {(Array.isArray(allData.kyc) ? allData.kyc : []).map((k) => {
                          if (!k || typeof k !== 'object') return null
                          const idType = String(k.government_id_type ?? 'aadhaar').replace(/_/g, ' ')
                          return (
                          <tr key={k.id || k.user_id} className="border-t border-white/5">
                            <td className="py-2">{k.users?.name || k.user_id}</td>
                            <td>{k.full_name ?? ''}</td>
                            <td>****{k.pan_last4 != null ? String(k.pan_last4) : '—'}</td>
                            <td>{k.bank_account ?? ''}</td>
                            <td className="capitalize">{idType}</td>
                            <td>
                              <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase ${
                                k.status === 'verified' ? 'bg-emerald-500/20 text-emerald-400' :
                                k.status === 'rejected' ? 'bg-rose-500/20 text-rose-400' :
                                'bg-amber-500/20 text-amber-400'
                              }`}>
                                {k.status}
                              </span>
                            </td>
                            <td>{k.submitted_at ? new Date(k.submitted_at).toLocaleDateString() : '-'}</td>
                            <td className="text-right space-x-2">
                              {k.government_proof_url && (
                                <a href={k.government_proof_url} target="_blank" rel="noopener noreferrer" className="px-2 py-1 rounded bg-sky-600 text-white text-xs inline-block">View Proof</a>
                              )}
                              {k.status === 'pending' && (
                                <>
                                  <button onClick={() => adminPost('/admin/approve-kyc', { targetUserId: k.user_id }, 'KYC approved')} className="px-2 py-1 rounded bg-emerald-600 text-white">Approve</button>
                                  <button onClick={() => {
                                    const reason = prompt('Enter rejection reason (optional):')
                                    if (reason !== null) {
                                      adminPost('/admin/reject-kyc', { targetUserId: k.user_id, reason }, 'KYC rejected')
                                    }
                                  }} className="px-2 py-1 rounded bg-rose-600 text-white">Reject</button>
                                </>
                              )}
                            </td>
                          </tr>
                          )
                        })}
                        {(!Array.isArray(allData.kyc) || allData.kyc.length === 0) && (
                          <tr><td colSpan={8} className="py-8 text-center text-slate-500">No KYC submissions found.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {activeTab === 'withdrawals' && (
                <div className="rounded-2xl bg-slate-900/70 border border-white/10 p-4 overflow-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-slate-400"><th>User</th><th>Requested</th><th>Fee</th><th>Final</th><th>Status</th><th></th></tr></thead>
                    <tbody>
                      {allData.withdrawals.map((w) => (
                        <tr key={w.id} className="border-t border-white/5">
                          <td className="py-2">{w.user_id}</td>
                          <td>₹{w.requested_amount ?? w.amount}</td>
                          <td>₹{w.fee_amount || 0}</td>
                          <td>₹{w.final_amount ?? w.amount}</td>
                          <td>{w.status}</td>
                          <td className="text-right space-x-2">
                            {w.status === 'pending' && (
                              <>
                                <button onClick={() => adminPost('/admin/approve-withdrawal', { withdrawalId: w.id, status: 'approved' }, 'Withdrawal approved')} className="px-2 py-1 rounded bg-emerald-600 text-white">Approve</button>
                                <button onClick={() => adminPost('/admin/approve-withdrawal', { withdrawalId: w.id, status: 'rejected' }, 'Withdrawal rejected')} className="px-2 py-1 rounded bg-rose-600 text-white">Reject</button>
                              </>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {activeTab === 'sandboxes' && (
                <AdminSandboxPanel adminId={user?.id} />
              )}

              {activeTab === 'monitoring' && (
                <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="rounded-2xl bg-slate-900/70 border border-white/10 p-4">Queue Waiting: {monitoring.queue?.waiting || 0}</div>
                  <div className="rounded-2xl bg-slate-900/70 border border-white/10 p-4">Queue Active: {monitoring.queue?.active || 0}</div>
                  <div className="rounded-2xl bg-slate-900/70 border border-white/10 p-4">Redis: {monitoring.redisHealthy ? 'Healthy' : 'Down'}</div>
                  <div className="rounded-2xl bg-slate-900/70 border border-white/10 p-4">Docker: {monitoring.dockerHealthy ? 'Healthy' : 'Down'}</div>
                </div>
              )}

              {activeTab === 'reports' && (
                <div className="rounded-2xl bg-slate-900/70 border border-white/10 p-4 h-80">
                  <h3 className="font-bold mb-3">Weekly/Monthly Revenue Projection</h3>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={revenue.daily.slice(-30)}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis dataKey="date" stroke="#94a3b8" />
                      <YAxis stroke="#94a3b8" />
                      <Tooltip />
                      <Bar dataKey="amount" fill="#22c55e" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {activeTab === 'settings' && (
                <div className="rounded-2xl bg-slate-900/70 border border-white/10 p-4 text-slate-300">
                  Platform settings are reserved for Phase 2 advanced controls.
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  )
}
