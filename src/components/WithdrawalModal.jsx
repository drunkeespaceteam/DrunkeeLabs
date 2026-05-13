import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { useToast } from './Toast'

export default function WithdrawalModal({ isOpen, onClose, walletBalance, userId, kycStatus, onWithdrawSuccess }) {
  const navigate = useNavigate()
  const [amount, setAmount] = useState('')
  const [bankDetails, setBankDetails] = useState({ accountName: '', accountNumber: '', ifsc: '' })
  const [loading, setLoading] = useState(false)
  const toast = useToast()

  if (!isOpen) return null

  const numAmount = Number(amount)
  const fee = Math.max(5, Math.ceil(numAmount * 0.02))
  const netReceivable = numAmount - fee

  const handleSubmit = async (e) => {
    e.preventDefault()
    
    if (numAmount < 100) {
      return toast.warning('Minimum withdrawal amount is ₹100')
    }
    if (numAmount > walletBalance) {
      return toast.error('Insufficient wallet balance')
    }
    if (!bankDetails.accountName || !bankDetails.accountNumber || !bankDetails.ifsc) {
      return toast.warning('Please fill in all bank details')
    }

    setLoading(true)
    try {
      const res = await fetch('/request-withdrawal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          amount: numAmount,
          bankDetails
        })
      })
      
      const data = await res.json()
      
      if (data.success) {
        toast.success(data.message || 'Withdrawal started — funds are being sent to your bank.')
        onWithdrawSuccess()
        onClose()
      } else {
        toast.error(data.message || 'Failed to request withdrawal')
      }
    } catch (error) {
      toast.error('Network error during withdrawal request')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-[200] flex items-center justify-center p-4"
        onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
          className="relative bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 max-w-md w-full shadow-2xl overflow-hidden">
          
          <div className="flex items-center justify-between mb-6 relative z-10">
            <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <span>💳</span> Withdraw to bank
            </h3>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>

          {kycStatus !== 'verified' ? (
            <div className="text-center py-6 relative z-10">
              <div className="w-20 h-20 bg-rose-50 rounded-full flex items-center justify-center mx-auto mb-4 border border-rose-100">
                <svg className="w-10 h-10 text-rose-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
              </div>
              <h4 className="text-lg font-bold text-slate-800 mb-2">KYC Verification Required</h4>
              <p className="text-sm text-slate-500 mb-6">
                To comply with banking regulations and ensure secure payouts, please complete the KYC verification process before withdrawing funds.
              </p>
              <button 
                onClick={() => { onClose(); navigate('/profile?tab=kyc') }}
                className="w-full py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold transition-all shadow-lg flex items-center justify-center gap-2"
              >
                Complete KYC Progress
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg>
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4 relative z-10">
            <p className="text-xs text-slate-500 leading-relaxed">
              Payouts are automatic via IMPS after checks. The account holder name, account number, and IFSC must match your verified KYC. If the bank rejects the transfer, the full debited amount is returned to your wallet.
            </p>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Amount to Withdraw (₹)</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">₹</span>
                <input 
                  type="number" 
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full pl-8 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition-all font-bold text-slate-800"
                  placeholder={`Max: ${walletBalance}`}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Account Holder Name</label>
                <input type="text" value={bankDetails.accountName} onChange={(e) => setBankDetails(p => ({ ...p, accountName: e.target.value }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition-all text-sm" placeholder="John Doe" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Account Number</label>
                <input type="text" value={bankDetails.accountNumber} onChange={(e) => setBankDetails(p => ({ ...p, accountNumber: e.target.value }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition-all text-sm" placeholder="1234567890" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">IFSC Code</label>
                <input type="text" value={bankDetails.ifsc} onChange={(e) => setBankDetails(p => ({ ...p, ifsc: e.target.value }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition-all text-sm uppercase" placeholder="HDFC0001234" />
              </div>
            </div>

            {numAmount > 0 && (
              <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4 mt-2">
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-emerald-600/70 font-medium">Withdrawal Amount:</span>
                  <span className="text-emerald-700 font-bold">₹{numAmount}</span>
                </div>
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-emerald-600/70 font-medium">Platform Fee (2%, min ₹5):</span>
                  <span className="text-rose-600 font-bold">-₹{fee}</span>
                </div>
                <div className="h-px bg-emerald-200/50 w-full mb-2"></div>
                <div className="flex justify-between text-base">
                  <span className="text-emerald-800 font-bold">Net Receivable:</span>
                  <span className="text-emerald-600 font-black">₹{netReceivable}</span>
                </div>
              </div>
            )}

            <button 
              type="submit" 
              disabled={loading || numAmount <= 0}
              className="w-full py-3.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-bold transition-all shadow-[0_0_20px_rgba(16,185,129,0.3)] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-4"
            >
              {loading ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : 'Confirm Withdrawal'}
            </button>
          </form>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
