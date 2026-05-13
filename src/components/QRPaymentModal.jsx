import React, { useEffect, useState, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { QRCode } from 'react-qr-code'
import { supabase } from '../lib/supabase'

export default function QRPaymentModal({ isOpen, onClose, shortUrl, paymentId, onSuccess }) {
  const [status, setStatus] = useState('waiting') // waiting, success, expired
  const [timeLeft, setTimeLeft] = useState(20 * 60)
  const successCalled = useRef(false)

  const handleSuccess = useCallback(() => {
    if (successCalled.current) return
    successCalled.current = true
    if (onSuccess) onSuccess()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isOpen || !paymentId) return
    
    // Reset state
    setStatus('waiting')
    setTimeLeft(20 * 60)
    successCalled.current = false

    // 1. Realtime Listener
    const channel = supabase.channel(`payment-${paymentId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'payments',
        filter: `razorpay_order_id=eq.${paymentId}`
      }, (payload) => {
        const newStatus = payload.new.status
        if (newStatus === 'locked' || newStatus === 'credited') {
          setStatus('success')
          setTimeout(() => handleSuccess(), 2000)
        } else if (newStatus === 'expired' || newStatus === 'failed') {
          setStatus('expired')
        }
      })
      .subscribe()

    // 2. Fallback Polling (every 5 seconds)
    const pollInterval = setInterval(async () => {
      try {
        const { data } = await supabase
          .from('payments')
          .select('status')
          .eq('razorpay_order_id', paymentId)
          .single()
        
        if (data?.status === 'locked' || data?.status === 'credited') {
          setStatus('success')
          setTimeout(() => handleSuccess(), 2000)
          clearInterval(pollInterval)
        } else if (data?.status === 'expired' || data?.status === 'failed') {
          setStatus('expired')
          clearInterval(pollInterval)
        }
      } catch { /* ignore poll errors */ }
    }, 5000)

    // 3. Countdown Timer
    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timer)
          setStatus('expired')
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => {
      supabase.removeChannel(channel)
      clearInterval(pollInterval)
      clearInterval(timer)
    }
  }, [isOpen, paymentId, handleSuccess])

  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  const handleCancel = async () => {
    try {
      await fetch('/cancel-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentId })
      })
    } catch { /* ignore */ }
    onClose()
  }

  if (!isOpen) return null

  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-[200] flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
        
        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
          className="relative bg-white border border-slate-200 rounded-3xl p-8 max-w-sm w-full shadow-2xl flex flex-col items-center text-center">
          
          <h3 className="text-xl font-bold text-slate-800 mb-2">Scan to Pay</h3>
          
          {status === 'waiting' && (
            <p className="text-sm text-slate-500 mb-6 flex items-center gap-2 justify-center">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              Waiting for payment... ({formatTime(timeLeft)})
            </p>
          )}

          {status === 'success' && (
            <p className="text-sm text-emerald-600 font-bold mb-6 flex items-center gap-2 justify-center">
              ✅ Payment Successful! Creating Task...
            </p>
          )}

          {status === 'expired' && (
            <p className="text-sm text-rose-600 font-bold mb-6 flex items-center gap-2 justify-center">
              ❌ Payment Failed or Expired
            </p>
          )}

          <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 shadow-inner mb-6 transition-all">
            {status === 'success' ? (
              <div className="w-48 h-48 flex items-center justify-center bg-emerald-50 rounded-xl">
                <span className="text-6xl">🎉</span>
              </div>
            ) : status === 'expired' ? (
              <div className="w-48 h-48 flex items-center justify-center bg-rose-50 rounded-xl">
                <span className="text-6xl">⚠️</span>
              </div>
            ) : shortUrl ? (
              <div style={{ background: 'white', padding: '8px' }}>
                <QRCode value={shortUrl} size={176} level="H" />
              </div>
            ) : (
              <div className="w-48 h-48 flex items-center justify-center">
                <div className="w-8 h-8 border-4 border-slate-200 border-t-sky-500 rounded-full animate-spin"></div>
              </div>
            )}
          </div>

          <p className="text-xs text-slate-400 mb-6 px-4">
            Open your UPI app (GPay, PhonePe, Paytm) and scan this QR code to securely lock funds.
          </p>

          <button 
            onClick={status === 'waiting' ? handleCancel : onClose}
            className={`w-full py-3 rounded-xl font-bold transition-all ${
              status === 'success' ? 'bg-emerald-500 text-white hover:bg-emerald-600' :
              'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {status === 'success' ? 'Continue' : status === 'expired' ? 'Close' : 'Cancel Payment'}
          </button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
