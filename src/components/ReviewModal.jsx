import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import StarRating from './StarRating'
import { useToast } from './Toast'

export default function ReviewModal({ isOpen, onClose, targetUser, taskId, submissionId, reviewerId, onSuccess }) {
  const [rating, setRating] = useState(0)
  const [reviewText, setReviewText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const toast = useToast()

  if (!isOpen) return null

  const handleSubmit = async () => {
    if (rating === 0) return toast.error('Please select a star rating')
    if (reviewText.trim().length < 10) return toast.error('Review must be at least 10 characters')

    setSubmitting(true)
    try {
      const res = await fetch('/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reviewerId,
          targetUserId: targetUser?.id,
          taskId,
          submissionId,
          rating,
          review: reviewText.trim()
        })
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.message)
      toast.success('Review submitted successfully!')
      onSuccess?.()
      onClose()
    } catch (err) {
      toast.error(err.message || 'Failed to submit review')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[200] flex items-center justify-center p-4"
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
        <motion.div
          initial={{ scale: 0.9, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.9, opacity: 0 }}
          className="relative bg-[#0a0a0a] border border-white/10 rounded-2xl p-8 max-w-md w-full shadow-2xl"
        >
          <button onClick={onClose} className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-all">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>

          <div className="text-center mb-6">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-amber-400/20 to-amber-600/20 border border-amber-500/20 flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl">⭐</span>
            </div>
            <h3 className="text-xl font-bold text-white">Rate {targetUser?.name || 'User'}</h3>
            <p className="text-sm text-slate-400 mt-1">Share your experience working together</p>
          </div>

          <div className="space-y-5">
            <div className="flex flex-col items-center gap-3">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Your Rating</p>
              <StarRating value={rating} onChange={setRating} size="lg" />
              {rating > 0 && (
                <p className="text-sm font-medium text-amber-400">
                  {['', 'Poor', 'Below Average', 'Good', 'Very Good', 'Excellent'][rating]}
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Your Review</label>
              <textarea
                value={reviewText}
                onChange={(e) => setReviewText(e.target.value)}
                rows={4}
                maxLength={500}
                placeholder="Share your experience working with this person..."
                className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/50 resize-none"
              />
              <div className="text-right text-xs text-slate-600 mt-1">{reviewText.length}/500</div>
            </div>

            <div className="flex gap-3">
              <button onClick={onClose} disabled={submitting} className="flex-1 py-3 rounded-xl bg-white/5 border border-white/10 text-sm font-bold text-white hover:bg-white/10 transition-all">
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting || rating === 0}
                className="flex-1 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-black text-sm font-bold transition-all shadow-[0_0_20px_rgba(245,158,11,0.3)] disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {submitting ? <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" /> : '⭐'}
                Submit Review
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
