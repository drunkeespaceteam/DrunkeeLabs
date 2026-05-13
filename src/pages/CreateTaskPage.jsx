import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import QRPaymentModal from '../components/QRPaymentModal';
import PaymentMethodModal from '../components/PaymentMethodModal';

// SVG Icons
const Icons = {
  Plus: () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>,
  Trash: () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>,
  Check: () => <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
};

const Card = ({ title, children }) => (
  <div className="bg-[#111827] rounded-2xl p-5 shadow-lg border border-white/5">
    {title && <h2 className="text-xl font-semibold text-white mb-4">{title}</h2>}
    {children}
  </div>
);

const Label = ({ children }) => (
  <label className="block text-sm font-medium text-gray-400 mb-1.5">{children}</label>
);

const Input = ({ className = '', ...props }) => (
  <input 
    className={`w-full bg-[#1F2937] text-white rounded-xl p-3 outline-none focus:ring-2 focus:ring-blue-500/50 transition-all border border-transparent focus:border-blue-500/30 ${className}`} 
    {...props} 
  />
);

const Textarea = ({ className = '', ...props }) => (
  <textarea 
    className={`w-full bg-[#1F2937] text-white rounded-xl p-3 outline-none focus:ring-2 focus:ring-blue-500/50 transition-all border border-transparent focus:border-blue-500/30 resize-y min-h-[120px] ${className}`} 
    {...props} 
  />
);

const Select = ({ children, className = '', ...props }) => (
  <select 
    className={`w-full bg-[#1F2937] text-white rounded-xl p-3 outline-none focus:ring-2 focus:ring-blue-500/50 transition-all border border-transparent focus:border-blue-500/30 appearance-none ${className}`} 
    {...props}
  >
    {children}
  </select>
);

const loadScript = (src) => {
  return new Promise((resolve) => {
    const script = document.createElement('script')
    script.src = src
    script.onload = () => resolve(true)
    script.onerror = () => resolve(false)
    document.body.appendChild(script)
  })
}

export default function CreateTaskPage() {
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const toast = useToast();
  
  const [loading, setLoading] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);
  const [qrData, setQrData] = useState({ shortUrl: null, paymentId: null });
  const [paymentBreakdown, setPaymentBreakdown] = useState({ reward: 0, platformFee: 0, totalPaid: 0 });

  // Single State Object
  const [taskData, setTaskData] = useState({
    title: '',
    difficulty: 'Medium',
    category: 'Web Development',
    problem: '',
    requirements: [''],
    input: '',
    output: '',
    evaluation: {
      code: 25,
      performance: 25,
      ui: 25,
      logic: 25
    },
    tech: {
      allowed: '',
      restricted: ''
    },
    submission: '',
    reward: 200,
    description_images: []
  });
  const [uploading, setUploading] = useState(false);

  const handleImageUpload = async (e) => {
    const files = Array.from(e.target.files)
    if (taskData.description_images.length + files.length > 5) {
      toast.warning('Maximum 5 images allowed')
      return
    }

    setUploading(true)
    for (const file of files) {
      if (file.size > 2 * 1024 * 1024) {
        toast.warning(`${file.name} is too large (max 2MB)`)
        continue
      }

      const formData = new FormData()
      formData.append('image', file)

      try {
        const res = await fetch('/upload-image', {
          method: 'POST',
          body: formData
        })
        const data = await res.json()
        if (data.success) {
          setTaskData(prev => ({
            ...prev,
            description_images: [...prev.description_images, { id: Date.now() + Math.random(), url: data.url, name: file.name }]
          }))
        } else {
          toast.error(`Failed to upload ${file.name}`)
        }
      } catch (err) {
        toast.error('Upload failed — check server connection')
      }
    }
    setUploading(false)
    e.target.value = ''
  }

  const removeImage = (id) => {
    setTaskData(prev => ({
      ...prev,
      description_images: prev.description_images.filter(img => img.id !== id)
    }))
  }

  const updateField = (field, value) => {
    setTaskData(prev => ({ ...prev, [field]: value }));
  };

  const updateNestedField = (parent, field, value) => {
    setTaskData(prev => ({
      ...prev,
      [parent]: {
        ...prev[parent],
        [field]: value
      }
    }));
  };

  const rewardValue = Number(taskData.reward) || 0
  const postingFee = rewardValue <= 500 ? Math.round(rewardValue * 0.10) : rewardValue <= 5000 ? Math.round(rewardValue * 0.08) : Math.round(rewardValue * 0.05)
  const totalToPay = rewardValue + postingFee

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!taskData.title.trim() || !taskData.problem.trim()) {
      toast.warning('Please fill in title and problem statement');
      return;
    }
    if (taskData.category !== 'Web Development') {
      toast.error('Only Web Development tasks are currently supported.');
      return;
    }
    
    // Total weightage check
    const totalWeight = Object.values(taskData.evaluation).reduce((a, b) => a + b, 0);
    if (totalWeight !== 100) {
      toast.warning(`Total evaluation weightage must be 100% (currently ${totalWeight}%)`);
      return;
    }

    setShowPaymentModal(true);
  };

  const handleSelectPaymentMethod = async (method) => {
    setShowPaymentModal(false);
    setLoading(true);
    const mentorId = user?.id || profile?.id;
    const reward = Number(taskData.reward);

    if (method === 'qr') {
      try {
        const res = await fetch('/create-qr-payment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskDetails: taskData, mentorId, reward })
        })
        const data = await res.json()
        if (!data.success) {
          toast.error(data.message || 'Failed to create QR payment')
          setLoading(false)
          return
        }
        setPaymentBreakdown({
          reward: data.data.reward || reward,
          platformFee: data.data.platformFee || postingFee,
          totalPaid: data.data.totalPaid || (reward + postingFee)
        })
        setQrData({ shortUrl: data.data.shortUrl, paymentId: data.data.paymentId })
        setShowQrModal(true)
      } catch {
        toast.error('Network error — please try again')
      } finally {
        setLoading(false)
      }

    } else if (method === 'checkout') {
      try {
        const loaded = await loadScript('https://checkout.razorpay.com/v1/checkout.js')
        if (!loaded) {
          toast.error('Razorpay SDK failed to load')
          setLoading(false)
          return
        }

        const res = await fetch('/create-checkout-order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskDetails: taskData, mentorId, reward })
        })
        const data = await res.json()
        if (!data.success) {
          toast.error(data.message || 'Failed to create order')
          setLoading(false)
          return
        }
        setPaymentBreakdown({
          reward: data.data.reward || reward,
          platformFee: data.data.platformFee || postingFee,
          totalPaid: data.data.totalPaid || (reward + postingFee)
        })

        const options = {
          key: data.data.key,
          amount: data.data.amount,
          currency: 'INR',
          name: 'Nexus Sandbox',
          description: `Task Escrow: ${taskData.title}`,
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
                toast.success(`Task created! ₹${paymentBreakdown.totalPaid || (reward + postingFee)} paid (including fee). 🔒`)
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
          theme: { color: '#3b82f6' },
          modal: {
            ondismiss: function () {
              // Fire-and-forget cancellation of the pending order
              fetch('/cancel-payment', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ paymentId: data.data.orderId })
              }).catch(() => {})
              toast.warning('Payment was cancelled')
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
  };

  return (
    <div className="min-h-screen bg-[#0B1220] py-12 px-4 sm:px-6 font-sans">
      <div className="max-w-4xl mx-auto space-y-6">
        
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white tracking-tight">Create New Task</h1>
            <p className="text-gray-400 mt-1">Define a comprehensive challenge for developers</p>
          </div>
          <button 
            onClick={handleSubmit}
            disabled={loading || uploading}
            className="flex items-center gap-2 bg-blue-500 hover:bg-blue-600 text-white px-6 py-2.5 rounded-xl font-medium transition-all shadow-[0_0_20px_rgba(59,130,246,0.3)] hover:shadow-[0_0_25px_rgba(59,130,246,0.5)] disabled:opacity-50"
          >
            {loading ? 'Processing...' : uploading ? 'Uploading Images...' : (
              <>
                <Icons.Check /> Publish Task
              </>
            )}
          </button>
        </div>

        {/* Payment Summary Banner */}
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-2xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center text-blue-400">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2" ry="2"></rect><line x1="2" y1="10" x2="22" y2="10"></line></svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Escrow Protection Active</p>
              <p className="text-xs text-gray-400">Your funds are safely locked until you approve the submission.</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-400 uppercase font-bold tracking-wider">Total to Lock</p>
            <p className="text-2xl font-black text-blue-400">₹{totalToPay}</p>
            <p className="text-[11px] text-gray-400 mt-1">Reward ₹{rewardValue} + Fee ₹{postingFee}</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          
          {/* 1. TaskBasicsCard */}
          <Card title="Task Basics">
            <div className="space-y-4">
              <div>
                <Label>Task Title</Label>
                <Input 
                  placeholder="e.g., Build a Real-time Chat Application" 
                  value={taskData.title}
                  onChange={(e) => updateField('title', e.target.value)}
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Difficulty</Label>
                  <div className="relative">
                    <Select 
                      value={taskData.difficulty}
                      onChange={(e) => updateField('difficulty', e.target.value)}
                    >
                      <option value="Easy">🟢 Easy</option>
                      <option value="Medium">🟡 Medium</option>
                      <option value="Hard">🔴 Hard</option>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label>Category</Label>
                  <div className="relative">
                    <Select
                      value={taskData.category}
                      onChange={(e) => updateField('category', e.target.value)}
                    >
                      <option value="Web Development">Web Development</option>
                    </Select>
                  </div>
                  <div className="mt-2 text-[10px] text-gray-500 space-y-1">
                    <p><span className="text-emerald-500 font-bold">Supported:</span> React, Vite, Node.js, Static HTML apps</p>
                    <p><span className="text-rose-500 font-bold">Not supported:</span> Python ML, multi-server apps, databases</p>
                  </div>
                </div>
              </div>
              <div>
                <Label>Task budget — reward in Indian rupees (₹)</Label>
                <Input 
                  type="number"
                  min="50"
                  max="10000"
                  step="50"
                  placeholder="e.g., 500 (rupees, not points)" 
                  value={taskData.reward}
                  onChange={(e) => updateField('reward', e.target.value)}
                />
                <p className="text-[10px] text-gray-500 mt-1">This amount will be locked in escrow and paid to the winner.</p>
              </div>
            </div>
          </Card>

          {/* 2. ProblemStatementCard */}
          <Card title="Problem Statement">
            <Label>Detailed Description</Label>
            <Textarea 
              placeholder="Explain the task clearly. What is the business context? What needs to be built?"
              value={taskData.problem}
              onChange={(e) => updateField('problem', e.target.value)}
              className="min-h-[160px]"
            />
            
            {/* Image Upload Section */}
            <div className="mt-6 space-y-3">
              <Label>Reference Images (optional, max 5)</Label>
              <div className="flex flex-wrap gap-4">
                {taskData.description_images.map(img => (
                  <div key={img.id} className="relative group w-24 h-24 rounded-2xl overflow-hidden border border-white/10 shadow-lg">
                    <img src={img.url} alt={img.name} className="w-full h-full object-cover" />
                    {!img.url && (
                      <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                        <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                      </div>
                    )}
                    <button 
                      type="button" 
                      onClick={() => removeImage(img.id)} 
                      className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-lg backdrop-blur-md"
                    >
                      <Icons.Trash />
                    </button>
                  </div>
                ))}
                {taskData.description_images.length < 5 && (
                  <label className="w-24 h-24 rounded-2xl border-2 border-dashed border-gray-700 hover:border-blue-500 flex flex-col items-center justify-center cursor-pointer transition-all bg-[#1F2937]/50 hover:bg-[#1F2937]">
                    <Icons.Plus />
                    <span className="text-[10px] text-gray-500 mt-1 font-medium">Add Image</span>
                    <input type="file" accept="image/*" multiple onChange={handleImageUpload} className="hidden" />
                  </label>
                )}
              </div>
            </div>
          </Card>

          {/* 3. RequirementsCard */}
          <Card title="Requirements">
            <div className="space-y-3">
              <Label>Core Objectives</Label>
              {taskData.requirements.map((req, index) => (
                <div key={index} className="flex items-center gap-3">
                  <div className="flex-1">
                    <Input 
                      placeholder={`Requirement ${index + 1}...`}
                      value={req}
                      onChange={(e) => {
                        const newReqs = [...taskData.requirements];
                        newReqs[index] = e.target.value;
                        updateField('requirements', newReqs);
                      }}
                    />
                  </div>
                  {taskData.requirements.length > 1 && (
                    <button 
                      type="button"
                      onClick={() => {
                        const newReqs = taskData.requirements.filter((_, i) => i !== index);
                        updateField('requirements', newReqs);
                      }}
                      className="p-3 bg-red-500/10 text-red-500 hover:bg-red-500/20 rounded-xl transition-colors"
                    >
                      <Icons.Trash />
                    </button>
                  )}
                </div>
              ))}
              <button 
                type="button"
                onClick={() => updateField('requirements', [...taskData.requirements, ''])}
                className="flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300 mt-2 transition-colors font-medium"
              >
                <Icons.Plus /> Add Requirement
              </button>
            </div>
          </Card>

          {/* 4. InputOutputCard */}
          <Card title="Expected I/O Format">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Example Input (JSON / Text)</Label>
                <Textarea 
                  placeholder={'{\n  "user_id": 123\n}'}
                  value={taskData.input}
                  onChange={(e) => updateField('input', e.target.value)}
                  className="font-mono text-sm"
                />
              </div>
              <div>
                <Label>Expected Output (JSON / Text)</Label>
                <Textarea 
                  placeholder={'{\n  "status": "success"\n}'}
                  value={taskData.output}
                  onChange={(e) => updateField('output', e.target.value)}
                  className="font-mono text-sm"
                />
              </div>
            </div>
          </Card>

          {/* 5. EvaluationCard */}
          <Card title="Evaluation Weightage">
            <Label>Distribute 100% across the grading criteria</Label>
            <div className="space-y-6 mt-6">
              {Object.entries(taskData.evaluation).map(([key, value]) => (
                <div key={key} className="flex flex-col gap-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-300 capitalize font-medium">{key === 'ui' ? 'UI/UX' : key}</span>
                    <span className="text-blue-400 font-bold">{value}%</span>
                  </div>
                  <input 
                    type="range" 
                    min="0" 
                    max="100" 
                    value={value}
                    onChange={(e) => updateNestedField('evaluation', key, parseInt(e.target.value))}
                    className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                  />
                </div>
              ))}
              {/* Live validation feedback */}
              {(() => {
                const total = Object.values(taskData.evaluation).reduce((a, b) => a + b, 0);
                return total !== 100 ? (
                  <p className="text-xs text-amber-500 mt-2 font-medium">⚠️ Total weightage is {total}% (should be 100%)</p>
                ) : (
                  <p className="text-xs text-emerald-500 mt-2 font-medium">✨ Total weightage is perfectly 100%</p>
                )
              })()}
            </div>
          </Card>

          {/* 6. TechConstraintsCard */}
          <Card title="Technology Constraints">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Allowed Technologies</Label>
                <Input 
                  placeholder="e.g., React, Node.js, PostgreSQL"
                  value={taskData.tech.allowed}
                  onChange={(e) => updateNestedField('tech', 'allowed', e.target.value)}
                />
              </div>
              <div>
                <Label>Restricted Technologies</Label>
                <Input 
                  placeholder="e.g., TailwindCSS, External APIs"
                  value={taskData.tech.restricted}
                  onChange={(e) => updateNestedField('tech', 'restricted', e.target.value)}
                />
              </div>
            </div>
          </Card>

          {/* 7. SubmissionRulesCard */}
          <Card title="Submission Rules">
            <Label>What should the candidate submit?</Label>
            <Textarea 
              placeholder="e.g., Please provide a ZIP file containing the source code. The README must include setup instructions."
              value={taskData.submission}
              onChange={(e) => updateField('submission', e.target.value)}
            />
          </Card>

        </form>
      </div>

      <PaymentMethodModal
        isOpen={showPaymentModal}
        onClose={() => setShowPaymentModal(false)}
        onSelectMethod={handleSelectPaymentMethod}
        reward={rewardValue}
        platformFee={postingFee}
        totalPaid={totalToPay}
        loading={loading}
      />

      <QRPaymentModal
        isOpen={showQrModal}
        onClose={() => {
          setShowQrModal(false)
          toast.warning('Payment was cancelled')
        }}
        shortUrl={qrData.shortUrl}
        paymentId={qrData.paymentId}
        onSuccess={() => {
          setShowQrModal(false)
          toast.success(`Task created! ₹${paymentBreakdown.totalPaid || totalToPay} paid (including fee). 🔒`)
          navigate('/mentor/dashboard')
        }}
      />
    </div>
  );
}
