import { useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import AuthLayout from '../components/AuthLayout'
import InputField from '../components/InputField'
import Button from '../components/Button'
import { supabase } from '../lib/supabase'

const stagger = { animate: { transition: { staggerChildren: 0.08 } } }
const fadeUp = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] } },
}

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!email.trim()) return setError('Email is required')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setError('Enter a valid email')

    setLoading(true)
    try {
      const resetUrl = `${window.location.origin}/reset-password`
      const { error: authError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: resetUrl
      })
      if (authError) throw authError
      setSent(true)
    } catch (err) {
      setError(err.message || 'Failed to send reset email. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const mailIcon = (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
    </svg>
  )

  return (
    <AuthLayout>
      <motion.div variants={stagger} initial="initial" animate="animate" className="space-y-5">
        <motion.div variants={fadeUp} className="text-center space-y-2 mb-2">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-gradient-to-br from-ice-300 to-ice-500 flex items-center justify-center shadow-lg shadow-ice-500/20 mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Forgot password?</h1>
          <p className="text-sm text-slate-500">Enter your email and we'll send a reset link</p>
        </motion.div>

        {sent ? (
          <motion.div variants={fadeUp} className="space-y-5">
            <div className="p-5 rounded-2xl bg-emerald-50 border border-emerald-200 text-center space-y-2">
              <div className="w-12 h-12 mx-auto rounded-full bg-emerald-100 flex items-center justify-center mb-3">
                <svg className="w-6 h-6 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </div>
              <p className="text-sm font-bold text-emerald-800">Check your inbox</p>
              <p className="text-xs text-emerald-700 leading-relaxed">
                We sent a password reset link to <span className="font-semibold">{email}</span>.
                Check your spam folder if you don't see it within a few minutes.
              </p>
            </div>
            <Link to="/login">
              <Button variant="outline" className="w-full">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M19 12H5M12 19l-7-7 7-7"/>
                </svg>
                Back to Sign In
              </Button>
            </Link>
          </motion.div>
        ) : (
          <motion.form onSubmit={handleSubmit} variants={stagger} initial="initial" animate="animate" className="space-y-5">
            <motion.div variants={fadeUp}>
              <InputField
                id="forgot-email"
                label="Email Address"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError('') }}
                error={error}
                icon={mailIcon}
              />
            </motion.div>

            <motion.div variants={fadeUp} className="pt-1">
              <Button id="forgot-submit" loading={loading}>
                Send Reset Link
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>
                </svg>
              </Button>
            </motion.div>

            <motion.p variants={fadeUp} className="text-center text-sm text-slate-500">
              Remember your password?{' '}
              <Link to="/login" className="font-semibold text-ice-500 hover:text-ice-600 transition-colors underline underline-offset-2 decoration-ice-300">
                Sign in
              </Link>
            </motion.p>
          </motion.form>
        )}
      </motion.div>
    </AuthLayout>
  )
}
