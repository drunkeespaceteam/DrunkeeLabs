import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useToast } from './Toast'

export default function KYCModal({ isOpen, onClose, currentStatus, userId, onKycSuccess }) {
  const [formData, setFormData] = useState({
    fullName: '',
    panNumber: '',
    bankAccount: '',
    ifscCode: '',
    governmentIdType: 'aadhaar'
  })
  const [governmentProof, setGovernmentProof] = useState(null)
  const [loading, setLoading] = useState(false)
  const toast = useToast()

  if (!isOpen) return null

  const isPending = currentStatus === 'pending'
  const isRejected = currentStatus === 'rejected'

  const handleFileChange = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const maxSize = 5 * 1024 * 1024 // 5MB
    if (file.size > maxSize) {
      return toast.warning('File size must be less than 5MB')
    }
    const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf']
    if (!allowedTypes.includes(file.type)) {
      return toast.warning('Only JPG, PNG, or PDF files are allowed')
    }
    setGovernmentProof(file)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!userId) {
      return toast.error('Your session is not ready. Please wait a moment or refresh the page, then try again.')
    }
    if (!formData.fullName || !formData.panNumber || !formData.bankAccount || !formData.ifscCode) {
      return toast.warning('Please fill in all fields')
    }
    if (!governmentProof) {
      return toast.warning('Please upload a government ID proof document')
    }

    setLoading(true)
    try {
      const submitData = new FormData()
      submitData.append('userId', userId)
      submitData.append('fullName', formData.fullName)
      submitData.append('panNumber', formData.panNumber)
      submitData.append('bankAccount', formData.bankAccount)
      submitData.append('ifscCode', formData.ifscCode)
      submitData.append('governmentIdType', formData.governmentIdType)
      submitData.append('governmentProof', governmentProof)

      const res = await fetch('/submit-kyc', {
        method: 'POST',
        body: submitData
      })
      let data
      try {
        data = await res.json()
      } catch {
        toast.error('Invalid response from server. Please try again.')
        return
      }
      if (data.success) {
        toast.success('KYC submitted successfully')
        await onKycSuccess?.()
        onClose()
      } else {
        toast.error(data.message)
      }
    } catch (error) {
      toast.error('Network error during KYC submission')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-[200] flex items-center justify-center p-4"
        onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="absolute inset-0 bg-black/80 backdrop-blur-md" />
        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
          className="relative bg-slate-900 border border-white/10 rounded-3xl p-8 max-w-md w-full shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto">
          
          <div className="absolute -right-20 -top-20 w-40 h-40 bg-ice-500/10 blur-3xl rounded-full" />

          <div className="flex items-center justify-between mb-8 relative z-10">
            <div>
              <h3 className="text-xl font-black text-white flex items-center gap-2">
                🛡️ KYC Verification
              </h3>
              <p className="text-xs text-slate-500 font-bold uppercase tracking-widest mt-1">Status: {currentStatus}</p>
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-all">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>

          {isPending ? (
            <div className="text-center py-8 space-y-4">
              <div className="w-16 h-16 bg-amber-500/10 rounded-full flex items-center justify-center mx-auto">
                <svg className="w-8 h-8 text-amber-500 animate-pulse" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              </div>
              <h4 className="text-lg font-bold text-white">Verification Pending</h4>
              <p className="text-sm text-slate-400">Your KYC submission is currently under review by our team. This usually takes 24-48 hours. You will receive a notification once approved.</p>
              <button onClick={onClose} className="w-full py-3 rounded-xl bg-white/5 hover:bg-white/10 text-white font-bold transition-all">Got it</button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5 relative z-10">
              {isRejected && (
                <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-bold text-center">
                  Previous submission was rejected. Please check your details and re-submit.
                </div>
              )}
              
              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 ml-1">Full Legal Name</label>
                  <input type="text" value={formData.fullName} onChange={e => setFormData(p => ({ ...p, fullName: e.target.value }))} className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-ice-500/50 transition-all" placeholder="As per PAN card" />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 ml-1">PAN Card Number</label>
                  <input type="text" value={formData.panNumber} onChange={e => setFormData(p => ({ ...p, panNumber: e.target.value }))} className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-ice-500/50 transition-all uppercase" placeholder="ABCDE1234F" />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 ml-1">Government ID Type</label>
                  <select value={formData.governmentIdType} onChange={e => setFormData(p => ({ ...p, governmentIdType: e.target.value }))} className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-ice-500/50 transition-all">
                    <option value="aadhaar">Aadhaar Card</option>
                    <option value="passport">Passport</option>
                    <option value="driving_license">Driving License</option>
                    <option value="voter_id">Voter ID</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 ml-1">Government ID Proof</label>
                  <div className="relative">
                    <input type="file" id="gov-proof" accept=".jpg,.jpeg,.png,.pdf" onChange={handleFileChange} className="hidden" />
                    <label htmlFor="gov-proof" className="flex items-center justify-center w-full bg-black/50 border border-white/10 border-dashed rounded-xl px-4 py-4 cursor-pointer hover:bg-white/5 transition-all">
                      <div className="text-center">
                        {governmentProof ? (
                          <span className="text-emerald-400 text-sm font-bold">{governmentProof.name}</span>
                        ) : (
                          <>
                            <span className="text-slate-400 text-sm">Click to upload ID proof</span>
                            <p className="text-[10px] text-slate-500 mt-1">JPG, PNG or PDF (max 5MB)</p>
                          </>
                        )}
                      </div>
                    </label>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 ml-1">Bank Account Number</label>
                    <input type="text" value={formData.bankAccount} onChange={e => setFormData(p => ({ ...p, bankAccount: e.target.value }))} className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-ice-500/50 transition-all" placeholder="1234567890" />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 ml-1">IFSC Code</label>
                    <input type="text" value={formData.ifscCode} onChange={e => setFormData(p => ({ ...p, ifscCode: e.target.value }))} className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-ice-500/50 transition-all uppercase" placeholder="HDFC0001234" />
                  </div>
                </div>
              </div>

              <div className="pt-2">
                <button type="submit" disabled={loading} className="w-full py-4 rounded-2xl bg-gradient-to-r from-ice-600 to-blue-600 hover:from-ice-500 hover:to-blue-500 text-white font-black text-sm uppercase tracking-widest transition-all shadow-xl shadow-ice-500/20 disabled:opacity-50">
                  {loading ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin mx-auto" /> : 'Submit for Review'}
                </button>
                <p className="text-[10px] text-slate-500 text-center mt-4 px-4 font-medium">By submitting, you agree to our verification process and Terms of Service.</p>
              </div>
            </form>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
