import { motion } from 'framer-motion'

function getStrength(password) {
  if (!password) return { score: 0, label: '', color: '' }

  let score = 0
  if (password.length >= 6) score++
  if (password.length >= 10) score++
  if (/[A-Z]/.test(password)) score++
  if (/[0-9]/.test(password)) score++
  if (/[^A-Za-z0-9]/.test(password)) score++

  const levels = [
    { label: '', color: '' },
    { label: 'Very Weak', color: '#ef4444' },
    { label: 'Weak', color: '#f97316' },
    { label: 'Fair', color: '#eab308' },
    { label: 'Strong', color: '#22c55e' },
    { label: 'Very Strong', color: '#0ea5e9' },
  ]

  return { score, ...levels[score] }
}

export default function PasswordStrength({ password }) {
  const { score, label, color } = getStrength(password)

  if (!password) return null

  return (
    <div className="space-y-2 px-1">
      {/* Bars */}
      <div className="flex gap-1.5">
        {[1, 2, 3, 4, 5].map((level) => (
          <motion.div
            key={level}
            className="strength-bar flex-1"
            initial={{ scaleX: 0 }}
            animate={{
              scaleX: 1,
              backgroundColor: score >= level ? color : 'rgba(203, 213, 225, 0.4)',
            }}
            transition={{ duration: 0.4, delay: level * 0.05 }}
            style={{ transformOrigin: 'left' }}
          />
        ))}
      </div>

      {/* Label */}
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="text-xs font-medium"
        style={{ color }}
      >
        {label}
      </motion.p>
    </div>
  )
}
