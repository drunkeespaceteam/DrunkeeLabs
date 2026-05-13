import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import AuthLayout from '../components/AuthLayout'
import InputField from '../components/InputField'
import Button from '../components/Button'
import PasswordStrength from '../components/PasswordStrength'
import { supabase } from '../lib/supabase'

const stagger = { animate: { transition: { staggerChildren: 0.08 } } }
const fadeUp = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] } },
}

export default function ResetPassword() {
  const navigate = useNavigate()
  const [form, setForm] = useState({ password: '', confirm: '' })
  const [errors, setErrors] = useState({})
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [sessionReady, setSessionReady] = useState(false)
  const [sessionError, setSessionError] = useState(false)

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setSessionReady(true)
      }
    })

    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (session) setSessionReady(true)
      else {
        setTimeout(() => {
          supabase.auth.getSession().then(({ data: { session: s } }) => {
            if (s) setSessionReady(true)
            else setSessionError(true)
          })
        }, 2000)
      }
    }
    checkSession()

    return () => subscription.unsubscribe()
  }, [])

  const validate = () => {
    const errs = {}
    if (!form.password) errs.password = 'Password is required'
    else if (form.password.length < 8) errs.password = 'Password must be at least 8 characters'
    if (!form.confirm) errs.confirm = 'Please confirm your password'
    else if (form.password !== form.confirm) errs.confirm = 'Passwords do not match'
    return errs
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length) return setErrors(errs)

    setLoading(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: form.password })
      if (error) throw error
      setDone(true)
      setTimeout(() => navigate('/login'), 3000)
    } catch (err) {
      setErrors({ password: err.message || 'Failed to reset password. Please try again.' })
    } finally {
      setLoading(false)
    }
  }

  const lockIcon = (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
    </svg>
  )

  return (
    <AuthLayout>
      <motion.div variants={stagger} initial="initial" animate="animate" className="space-y-5">
        <motion.div variants={fadeUp} className="text-center space-y-2 mb-2">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-gradient-to-br from-ice-300 to-ice-500 flex items-center justify-center shadow-lg shadow-ice-500/20 mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Reset password</h1>
          <p className="text-sm text-slate-500">Choose a strong new password</p>
        </motion.div>

        {done ? (
          <motion.div variants={fadeUp} className="space-y-4">
            <div className="p-5 rounded-2xl bg-emerald-50 border border-emerald-200 text-center space-y-2">
              <div className="w-12 h-12 mx-auto rounded-full bg-emerald-100 flex items-center justify-center mb-3">
                <svg className="w-6 h-6 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </div>
              <p className="text-sm font-bold text-emerald-800">Password updated!</p>
              <p className="text-xs text-emerald-700">Redirecting you to sign in...</p>
            </div>
          </motion.div>
        ) : sessionError ? (
          <motion.div variants={fadeUp} className="space-y-4">
            <div className="p-5 rounded-2xl bg-rose-50 border border-rose-200 text-center space-y-2">
              <p className="text-sm font-bold text-rose-800">Link expired or invalid</p>
              <p className="text-xs text-rose-700">This reset link has expired. Please request a new one.</p>
            </div>
            <Button onClick={() => navigate('/forgot-password')} variant="outline">
              Request new reset link
            </Button>
          </motion.div>
        ) : !sessionReady ? (
          <motion.div variants={fadeUp} className="flex flex-col items-center gap-4 py-8">
            <div className="w-8 h-8 border-4 border-slate-200 border-t-ice-500 rounded-full animate-spin" />
            <p className="text-sm text-slate-500">Validating your reset link...</p>
          </motion.div>
        ) : (
          <motion.form onSubmit={handleSubmit} variants={stagger} initial="initial" animate="animate" className="space-y-5">
            <motion.div variants={fadeUp}>
              <InputField
                id="reset-password"
                label="New Password"
                type="password"
                placeholder="Min. 8 characters"
                value={form.password}
                onChange={(e) => { setForm(p => ({ ...p, password: e.target.value })); setErrors(p => ({ ...p, password: '' })) }}
                error={errors.password}
                icon={lockIcon}
              />
              {form.password && <PasswordStrength password={form.password} />}
            </motion.div>
            <motion.div variants={fadeUp}>
              <InputField
                id="reset-confirm"
                label="Confirm New Password"
                type="password"
                placeholder="Repeat your password"
                value={form.confirm}
                onChange={(e) => { setForm(p => ({ ...p, confirm: e.target.value })); setErrors(p => ({ ...p, confirm: '' })) }}
                error={errors.confirm}
                icon={lockIcon}
              />
            </motion.div>
            <motion.div variants={fadeUp} className="pt-1">
              <Button id="reset-submit" loading={loading}>
                Update Password
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>
                </svg>
              </Button>
            </motion.div>
          </motion.form>
        )}
      </motion.div>
    </AuthLayout>
  )
}
