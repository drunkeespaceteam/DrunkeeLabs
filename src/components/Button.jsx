import { motion } from 'framer-motion'

export default function Button({
  children,
  loading = false,
  disabled = false,
  type = 'submit',
  onClick,
  className = '',
  id,
}) {
  return (
    <motion.button
      id={id}
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      whileHover={!disabled && !loading ? { scale: 1.02 } : {}}
      whileTap={!disabled && !loading ? { scale: 0.98 } : {}}
      className={`
        btn-gradient w-full py-3.5 rounded-xl text-white font-semibold text-sm
        tracking-wide flex items-center justify-center gap-2
        ${className}
      `}
    >
      {loading ? (
        <>
          <div className="spinner" />
          <span className="opacity-90">Please wait...</span>
        </>
      ) : (
        children
      )}
    </motion.button>
  )
}
