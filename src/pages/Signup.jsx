import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import AuthLayout from '../components/AuthLayout'
import InputField from '../components/InputField'
import Button from '../components/Button'
import PasswordStrength from '../components/PasswordStrength'
import { useAuth } from '../context/AuthContext'
import { normalizeRole } from '../utils/roles'
import { useToast } from '../components/Toast'

const stagger = { animate: { transition: { staggerChildren: 0.08 } } }
const fadeUp = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] } },
}

const roles = [
  {
    id: 'employee',
    title: 'Employee',
    subtitle: 'Developer',
    description: 'Solve tasks, earn points, and level up',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
      </svg>
    ),
  },
  {
    id: 'mentor',
    title: 'Mentor',
    subtitle: 'Task Creator',
    description: 'Create tasks and guide developers',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2 2 7l10 5 10-5-10-5z" /><path d="m2 17 10 5 10-5" /><path d="m2 12 10 5 10-5" />
      </svg>
    ),
  },
]

export default function Signup() {
  const navigate = useNavigate()
  const { signUp } = useAuth()
  const toast = useToast()
  const [form, setForm] = useState({ name: '', email: '', password: '', role: '' })
  const [errors, setErrors] = useState({})
  const [loading, setLoading] = useState(false)

  const validate = () => {
    const errs = {}
    if (!form.role) errs.role = 'Please select a role'
    if (!form.name.trim()) errs.name = 'Name is required'
    if (!form.email.trim()) errs.email = 'Email is required'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errs.email = 'Enter a valid email'
    if (!form.password) errs.password = 'Password is required'
    else if (form.password.length < 6) errs.password = 'Minimum 6 characters'
    return errs
  }

  const handleChange = (field) => (e) => {
    setForm((p) => ({ ...p, [field]: e.target.value }))
    if (errors[field]) setErrors((p) => ({ ...p, [field]: '' }))
  }

  const handleRoleSelect = (roleId) => {
    setForm((p) => ({ ...p, role: roleId }))
    if (errors.role) setErrors((p) => ({ ...p, role: '' }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length) return setErrors(errs)

    setLoading(true)
    try {
      const { error, role } = await signUp({
        email: form.email,
        password: form.password,
        name: form.name,
        role: form.role,
      })

      if (error) {
        toast.error(error)
        setErrors({ email: error })
      } else {
        toast.success('Account created successfully!')
        const r = normalizeRole(role)
        const redirect = r === 'admin' ? '/admin' : r === 'mentor' ? '/mentor/dashboard' : '/dashboard'
        navigate(redirect)
      }
    } catch (err) {
      toast.error('Network error — please try again')
    } finally {
      setLoading(false)
    }
  }

  const userIcon = <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
  const mailIcon = <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
  const lockIcon = <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>

  return (
    <AuthLayout>
      <motion.form onSubmit={handleSubmit} variants={stagger} initial="initial" animate="animate" className="space-y-5">
        <motion.div variants={fadeUp} className="text-center space-y-2 mb-2">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-gradient-to-br from-ice-300 to-ice-500 flex items-center justify-center shadow-lg shadow-ice-500/20 mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
          </div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Create your account</h1>
          <p className="text-sm text-slate-500">Join thousands building the future</p>
        </motion.div>

        {/* Role Selection */}
        <motion.div variants={fadeUp} className="space-y-2">
          <label className="block text-sm font-medium text-slate-600 pl-1">Choose your role</label>
          <div className="grid grid-cols-2 gap-3">
            {roles.map((role) => {
              const selected = form.role === role.id
              return (
                <motion.button
                  key={role.id}
                  type="button"
                  onClick={() => handleRoleSelect(role.id)}
                  whileHover={{ y: -2, transition: { duration: 0.2 } }}
                  whileTap={{ scale: 0.97 }}
                  className={`relative rounded-xl p-4 text-left transition-all duration-300 cursor-pointer border-2 ${
                    selected
                      ? 'border-ice-400 bg-ice-50/60 shadow-lg shadow-ice-400/15'
                      : 'border-transparent bg-white/50 hover:bg-white/70 hover:shadow-md'
                  }`}
                  style={{
                    boxShadow: selected
                      ? '0 0 0 1px rgba(56, 189, 248, 0.2), 0 4px 20px rgba(56, 189, 248, 0.12), 0 0 30px rgba(56, 189, 248, 0.06)'
                      : undefined,
                  }}
                >
                  {selected && (
                    <motion.div
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                      className="absolute top-2.5 right-2.5 w-5 h-5 rounded-full bg-gradient-to-br from-ice-400 to-ice-500 flex items-center justify-center shadow-md shadow-ice-500/30"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                    </motion.div>
                  )}
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-2.5 transition-all duration-300 ${
                    selected ? 'bg-gradient-to-br from-ice-400 to-ice-500 text-white shadow-md shadow-ice-500/20' : 'bg-slate-100/80 text-slate-400'
                  }`}>{role.icon}</div>
                  <p className={`text-sm font-bold transition-colors duration-300 ${selected ? 'text-ice-600' : 'text-slate-700'}`}>{role.title}</p>
                  <p className={`text-[11px] font-semibold mb-1 transition-colors duration-300 ${selected ? 'text-ice-500' : 'text-slate-400'}`}>{role.subtitle}</p>
                  <p className="text-[10px] text-slate-400 leading-relaxed">{role.description}</p>
                </motion.button>
              )
            })}
          </div>
          {errors.role && (
            <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="text-xs text-red-500 pl-1 font-medium">{errors.role}</motion.p>
          )}
        </motion.div>

        <motion.div variants={fadeUp}>
          <InputField id="signup-name" label="Full Name" placeholder="John Doe" value={form.name} onChange={handleChange('name')} error={errors.name} icon={userIcon} />
        </motion.div>
        <motion.div variants={fadeUp}>
          <InputField id="signup-email" label="Email Address" type="email" placeholder="you@example.com" value={form.email} onChange={handleChange('email')} error={errors.email} icon={mailIcon} />
        </motion.div>
        <motion.div variants={fadeUp} className="space-y-2">
          <InputField id="signup-password" label="Password" type="password" placeholder="••••••••" value={form.password} onChange={handleChange('password')} error={errors.password} icon={lockIcon} />
          <PasswordStrength password={form.password} />
        </motion.div>

        <motion.div variants={fadeUp} className="pt-1">
          <Button id="signup-submit" loading={loading}>
            Create Account
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
          </Button>
        </motion.div>

        <motion.p variants={fadeUp} className="text-center text-sm text-slate-500 pt-1">
          Already have an account?{' '}
          <Link to="/login" className="font-semibold text-ice-500 hover:text-ice-600 transition-colors underline underline-offset-2 decoration-ice-300">Sign in</Link>
        </motion.p>
      </motion.form>
    </AuthLayout>
  )
}
