import { motion, AnimatePresence } from 'framer-motion'

export default function PaymentMethodModal({ isOpen, onClose, onSelectMethod, reward, platformFee = 0, totalPaid = reward, loading }) {
  if (!isOpen) return null

  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-[200] flex items-center justify-center p-4"
        onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
        
        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
          className="relative bg-white border border-slate-200 rounded-3xl p-8 max-w-sm w-full shadow-2xl text-center">
          
          <div className="mb-6">
            <div className="mx-auto w-14 h-14 rounded-2xl bg-gradient-to-br from-sky-400 to-indigo-500 flex items-center justify-center shadow-lg shadow-sky-500/20 mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-7 h-7 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
            </div>
            <h3 className="text-xl font-bold text-slate-800">Secure Payment</h3>
            <p className="text-sm text-slate-500 mt-1">Reward ₹{reward} + Platform Fee ₹{platformFee}</p>
            <p className="text-sm font-bold text-slate-700 mt-1">Total Payable: ₹{totalPaid}</p>
          </div>

          <div className="space-y-3">
            <motion.button
              whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
              disabled={loading}
              onClick={() => onSelectMethod('checkout')}
              className="w-full py-4 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-500 text-white font-bold text-sm shadow-lg shadow-sky-500/30 hover:shadow-sky-500/50 transition-all flex items-center justify-center gap-3 disabled:opacity-60"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
                  Pay with Razorpay (UPI / Card / QR)
                </>
              )}
            </motion.button>
          </div>

          <p className="text-[10px] text-slate-400 mt-4">Razorpay handles QR codes, UPI, cards & netbanking automatically</p>

          <button
            onClick={onClose}
            className="mt-3 text-sm text-slate-400 hover:text-slate-600 font-medium transition-colors"
          >
            Cancel
          </button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
