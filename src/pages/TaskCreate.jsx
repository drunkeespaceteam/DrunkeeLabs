import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import Navbar from '../components/Navbar'
import InputField from '../components/InputField'
import Button from '../components/Button'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../components/Toast'
import QRPaymentModal from '../components/QRPaymentModal'
import PaymentMethodModal from '../components/PaymentMethodModal'

const categories = ['Frontend', 'Backend', 'API', 'Design']
const difficulties = ['Easy', 'Medium', 'Hard']

const fadeUp = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] } },
}

const loadScript = (src) => {
  return new Promise((resolve) => {
    const script = document.createElement('script')
    script.src = src
    script.onload = () => resolve(true)
    script.onerror = () => resolve(false)
    document.body.appendChild(script)
  })
}

export default function TaskCreate() {
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const toast = useToast()
  const [loading, setLoading] = useState(false)
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [showQrModal, setShowQrModal] = useState(false)
  const [qrData, setQrData] = useState({ shortUrl: null, paymentId: null })
  const [descriptionImages, setDescriptionImages] = useState([])
  const [form, setForm] = useState({
    title: '', description: '', category: 'Frontend', difficulty: 'Medium', reward: 200,
  })

  const handleImageUpload = (e) => {
    const files = Array.from(e.target.files)
    if (descriptionImages.length + files.length > 5) {
      toast.warning('Maximum 5 images allowed')
      return
    }
    files.forEach(file => {
      if (file.size > 2 * 1024 * 1024) {
        toast.warning(`${file.name} is too large (max 2MB)`)
        return
      }
      const reader = new FileReader()
      reader.onload = (ev) => {
        setDescriptionImages(prev => [...prev, { id: Date.now() + Math.random(), dataUrl: ev.target.result, name: file.name }])
      }
      reader.readAsDataURL(file)
    })
    e.target.value = ''
  }

  const removeImage = (id) => {
    setDescriptionImages(prev => prev.filter(img => img.id !== id))
  }

  const handleChange = (field) => (e) => {
    setForm((p) => ({ ...p, [field]: e.target.value }))
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!form.title.trim() || !form.description.trim()) {
      toast.warning('Please fill in all fields')
      return
    }
    if (form.description.trim().length < 50) {
      toast.warning('Description is too short. Please provide at least 50 characters to ensure clarity.')
      return
    }
    // Show payment method modal
    setShowPaymentModal(true)
  }

  const handleSelectPaymentMethod = async (method) => {
    setShowPaymentModal(false)
    setLoading(true)
    const mentorId = user?.id || profile?.id
    const reward = Number(form.reward)

    if (method === 'qr') {
      try {
        const res = await fetch('/create-qr-payment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskDetails: { ...form, description_images: descriptionImages.map(i => i.dataUrl) }, mentorId, reward })
        })
        const data = await res.json()
        if (!data.success) {
          toast.error(data.message || 'Failed to create QR payment')
          setLoading(false)
          return
        }
        setQrData({ shortUrl: data.data.shortUrl, paymentId: data.data.paymentId })
        setShowQrModal(true)
      } catch {
        toast.error('Network error — please try again')
      } finally {
        setLoading(false)
      }

    } else if (method === 'checkout') {
      try {
        // 1. Load Razorpay SDK
        const loaded = await loadScript('https://checkout.razorpay.com/v1/checkout.js')
        if (!loaded) {
          toast.error('Razorpay SDK failed to load. Are you online?')
          setLoading(false)
          return
        }

        // 2. Create checkout order
        const res = await fetch('/create-checkout-order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskDetails: { ...form, description_images: descriptionImages.map(i => i.dataUrl) }, mentorId, reward })
        })
        const data = await res.json()
        if (!data.success) {
          toast.error(data.message || 'Failed to create order')
          setLoading(false)
          return
        }

        // 3. Open Razorpay Checkout
        const options = {
          key: data.data.key,
          amount: data.data.amount,
          currency: 'INR',
          name: 'NexusDev Platform',
          description: `Task Escrow: ${form.title}`,
          order_id: data.data.orderId,
          handler: async function (response) {
            try {
              const verifyRes = await fetch('/verify-checkout-payment', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  razorpay_order_id: response.razorpay_order_id,
                  razorpay_payment_id: response.razorpay_payment_id,
                  razorpay_signature: response.razorpay_signature,
                  tempTaskId: data.data.tempTaskId
                })
              })
              const verifyData = await verifyRes.json()
              if (verifyData.success) {
                toast.success(`Task created! ₹${reward} secured and locked. 🔒`)
                navigate('/mentor/dashboard')
              } else {
                toast.error(verifyData.message || 'Payment verification failed')
              }
            } catch {
              toast.error('Network error during verification')
            } finally {
              setLoading(false)
            }
          },
          prefill: {
            name: profile?.name || 'Mentor',
            email: user?.email || '',
          },
          theme: { color: '#0ea5e9' },
          modal: {
            ondismiss: function () {
              toast.warning('Payment was cancelled by user')
              // Cancel payment in backend
              fetch('/cancel-payment', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ paymentId: data.data.orderId })
              }).catch(() => {})
              setLoading(false)
            }
          }
        }

        const paymentObject = new window.Razorpay(options)
        paymentObject.open()
      } catch {
        toast.error('Network error — please try again')
        setLoading(false)
      }
    }
  }

  return (
    <div className="min-h-screen w-full relative overflow-hidden"
      style={{ background: 'linear-gradient(145deg, #ffffff 0%, #e0f2fe 25%, #bae6fd 55%, #f0f9ff 100%)' }}>

      <div className="blob animate-float w-[350px] h-[350px] -top-16 -right-16 fixed" style={{ background: 'radial-gradient(circle, rgba(56,189,248,0.2), transparent 70%)' }} />
      <div className="blob animate-float-delayed w-[300px] h-[300px] bottom-20 -left-10 fixed" style={{ background: 'radial-gradient(circle, rgba(14,165,233,0.15), transparent 70%)' }} />

      <Navbar />

      <main className="max-w-2xl mx-auto px-4 sm:px-8 pb-16 relative z-10">
        <motion.button
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          onClick={() => navigate('/mentor/dashboard')}
          className="flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-ice-500 transition-colors mb-6 mt-2"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>
          Back to Dashboard
        </motion.button>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="glass-card rounded-2xl p-6 sm:p-8"
        >
          <div className="text-center mb-6">
            <div className="mx-auto w-12 h-12 rounded-2xl bg-gradient-to-br from-ice-300 to-ice-500 flex items-center justify-center shadow-lg shadow-ice-500/20 mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </div>
            <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Create New Task</h1>
            <p className="text-sm text-slate-500 mt-1">Define a challenge for developers</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <motion.div variants={fadeUp} initial="initial" animate="animate">
              <InputField id="task-title" label="Task Title" placeholder="e.g., Build a REST API" value={form.title} onChange={handleChange('title')} />
            </motion.div>

            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-600 pl-1">Description</label>
              <textarea
                value={form.description}
                onChange={handleChange('description')}
                placeholder="Describe the task requirements, expected output, and evaluation criteria... Write as much detail as you need."
                rows={8}
                className="input-glow w-full rounded-xl px-4 py-3 text-sm text-slate-700 placeholder:text-slate-400/70 outline-none resize-y min-h-[120px]"
              />
            </div>

            {/* Image Upload */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-600 pl-1">Reference Images (optional)</label>
              <div className="flex flex-wrap gap-3">
                {descriptionImages.map(img => (
                  <div key={img.id} className="relative group w-24 h-24 rounded-xl overflow-hidden border-2 border-slate-200 shadow-sm">
                    <img src={img.dataUrl} alt={img.name} className="w-full h-full object-cover" />
                    <button type="button" onClick={() => removeImage(img.id)} className="absolute top-1 right-1 w-5 h-5 rounded-full bg-rose-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-lg">
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  </div>
                ))}
                {descriptionImages.length < 5 && (
                  <label className="w-24 h-24 rounded-xl border-2 border-dashed border-slate-300 hover:border-ice-400 flex flex-col items-center justify-center cursor-pointer transition-colors bg-white/50 hover:bg-ice-50/50">
                    <svg className="w-6 h-6 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                    <span className="text-[10px] text-slate-400 mt-1 font-medium">Add Image</span>
                    <input type="file" accept="image/*" multiple onChange={handleImageUpload} className="hidden" />
                  </label>
                )}
              </div>
              {descriptionImages.length > 0 && <p className="text-[10px] text-slate-400">{descriptionImages.length}/5 images uploaded</p>}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-slate-600 pl-1">Category</label>
                <select
                  value={form.category}
                  onChange={handleChange('category')}
                  className="input-glow w-full rounded-xl px-4 py-3 text-sm text-slate-700 outline-none appearance-none bg-white/70 cursor-pointer"
                >
                  {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-slate-600 pl-1">Difficulty</label>
                <div className="flex gap-2">
                  {difficulties.map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setForm((p) => ({ ...p, difficulty: d }))}
                      className={`flex-1 py-2.5 rounded-lg text-xs font-bold transition-all ${
                        form.difficulty === d
                          ? d === 'Easy' ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/20'
                          : d === 'Medium' ? 'bg-amber-500 text-white shadow-md shadow-amber-500/20'
                          : 'bg-rose-500 text-white shadow-md shadow-rose-500/20'
                        : 'bg-white/50 text-slate-500 border border-slate-200/60 hover:bg-white/80'
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-600 pl-1">Reward (₹)</label>
              <input
                type="number"
                min="50"
                max="10000"
                step="50"
                value={form.reward}
                onChange={handleChange('reward')}
                className="input-glow w-full rounded-xl px-4 py-3 text-sm text-slate-700 outline-none"
              />
            </div>

            <div className="pt-2">
              <Button loading={loading}>
                Create Task
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
              </Button>
            </div>
          </form>
        </motion.div>
      </main>

      <PaymentMethodModal
        isOpen={showPaymentModal}
        onClose={() => setShowPaymentModal(false)}
        onSelectMethod={handleSelectPaymentMethod}
        reward={Number(form.reward)}
        loading={loading}
      />

      <QRPaymentModal
        isOpen={showQrModal}
        onClose={() => {
          setShowQrModal(false)
          toast.warning('Payment was cancelled by user')
        }}
        shortUrl={qrData.shortUrl}
        paymentId={qrData.paymentId}
        onSuccess={() => {
          setShowQrModal(false)
          toast.success(`Task created! ₹${form.reward} secured and locked. 🔒`)
          navigate('/mentor/dashboard')
        }}
      />
    </div>
  )
}
