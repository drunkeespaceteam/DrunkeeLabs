import { useEffect, useState, useCallback } from 'react'
import { motion } from 'framer-motion'

const FloatingBlob = ({ className, style, animClass }) => (
  <div className={`absolute rounded-full pointer-events-none blur-3xl mix-blend-multiply opacity-70 ${animClass} ${className}`} style={style} />
)

const pageVariants = {
  initial: {
    opacity: 0,
    y: 30,
    scale: 0.96,
  },
  animate: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      duration: 0.6,
      ease: [0.25, 0.46, 0.45, 0.94],
    },
  },
  exit: {
    opacity: 0,
    y: -20,
    scale: 0.98,
    transition: {
      duration: 0.3,
      ease: [0.25, 0.46, 0.45, 0.94],
    },
  },
}

export default function AuthLayout({ children }) {
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })

  const handleMouseMove = useCallback((e) => {
    const x = (e.clientX / window.innerWidth - 0.5) * 2
    const y = (e.clientY / window.innerHeight - 0.5) * 2
    setMousePos({ x, y })
  }, [])

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove)
    return () => window.removeEventListener('mousemove', handleMouseMove)
  }, [handleMouseMove])

  return (
    <div
      className="min-h-screen w-full flex items-center justify-center relative overflow-hidden"
      style={{
        background: 'linear-gradient(145deg, #ffffff 0%, #e0f2fe 30%, #bae6fd 60%, #f0f9ff 100%)',
      }}
    >
      {/* Floating background blobs with parallax */}
      <FloatingBlob
        className="w-[400px] h-[400px] -top-20 -left-20"
        style={{
          background: 'radial-gradient(circle, rgba(56, 189, 248, 0.3), transparent 70%)',
          transform: `translate(${mousePos.x * 15}px, ${mousePos.y * 15}px)`,
          transition: 'transform 0.3s ease-out',
        }}
        animClass="animate-float"
      />
      <FloatingBlob
        className="w-[350px] h-[350px] top-1/4 -right-16"
        style={{
          background: 'radial-gradient(circle, rgba(14, 165, 233, 0.25), transparent 70%)',
          transform: `translate(${mousePos.x * -12}px, ${mousePos.y * -12}px)`,
          transition: 'transform 0.3s ease-out',
        }}
        animClass="animate-float-delayed"
      />
      <FloatingBlob
        className="w-[300px] h-[300px] -bottom-10 left-1/3"
        style={{
          background: 'radial-gradient(circle, rgba(125, 211, 252, 0.3), transparent 70%)',
          transform: `translate(${mousePos.x * 10}px, ${mousePos.y * 10}px)`,
          transition: 'transform 0.3s ease-out',
        }}
        animClass="animate-float-slow"
      />
      <FloatingBlob
        className="w-[200px] h-[200px] top-10 left-1/2"
        style={{
          background: 'radial-gradient(circle, rgba(186, 230, 253, 0.4), transparent 70%)',
          transform: `translate(${mousePos.x * -8}px, ${mousePos.y * 8}px)`,
          transition: 'transform 0.3s ease-out',
        }}
        animClass="animate-float-delayed"
      />
      <FloatingBlob
        className="w-[250px] h-[250px] bottom-1/4 right-1/4"
        style={{
          background: 'radial-gradient(circle, rgba(56, 189, 248, 0.2), transparent 70%)',
          transform: `translate(${mousePos.x * 18}px, ${mousePos.y * -10}px)`,
          transition: 'transform 0.3s ease-out',
        }}
        animClass="animate-float"
      />

      {/* Subtle grid overlay */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.03]"
        style={{
          backgroundImage: `
            linear-gradient(rgba(14,165,233,1) 1px, transparent 1px),
            linear-gradient(90deg, rgba(14,165,233,1) 1px, transparent 1px)
          `,
          backgroundSize: '60px 60px',
        }}
      />

      {/* Main glass card */}
      <motion.div
        variants={pageVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        className="glass-card rounded-3xl p-8 sm:p-10 w-full max-w-md mx-4 relative z-10"
      >
        {children}
      </motion.div>

      {/* Bottom subtle branding */}
      <div className="absolute bottom-6 text-center w-full z-10">
        <p className="text-xs text-ice-500/50 font-medium tracking-widest uppercase">
          Secured by Nexus Auth
        </p>
      </div>
    </div>
  )
}
