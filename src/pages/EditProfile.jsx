import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import Navbar from '../components/Navbar'
import { useToast } from '../components/Toast'

const SKILLS_SUGGESTIONS = [
  'React', 'Vue', 'Angular', 'Node.js', 'Python', 'Django', 'FastAPI',
  'Express', 'PostgreSQL', 'MongoDB', 'Redis', 'Docker', 'TypeScript',
  'GraphQL', 'REST API', 'Tailwind CSS', 'Next.js', 'Go', 'Rust', 'Java',
  'Spring Boot', 'AWS', 'GCP', 'Figma', 'UI/UX Design', 'Machine Learning'
]

const EXPERIENCE_LEVELS = [
  { value: 'beginner', label: 'Beginner (< 1 year)' },
  { value: 'junior', label: 'Junior (1-2 years)' },
  { value: 'mid', label: 'Mid-Level (2-4 years)' },
  { value: 'senior', label: 'Senior (4-7 years)' },
  { value: 'lead', label: 'Lead / Principal (7+ years)' },
]

export default function EditProfile() {
  const { profile, user } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const fileInputRef = useRef(null)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)

  const [form, setForm] = useState({
    name: '',
    bio: '',
    skills: [],
    experience: 'beginner',
    github_url: '',
    linkedin_url: '',
    portfolio_url: '',
    avatar_url: '',
  })

  const [skillInput, setSkillInput] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [avatarPreview, setAvatarPreview] = useState(null)

  useEffect(() => {
    if (!profile?.id) return
    const fetchUserData = async () => {
      setLoading(true)
      const { data } = await supabase
        .from('users')
        .select('name, bio, skills, experience, github_url, linkedin_url, portfolio_url, avatar_url')
        .eq('id', profile.id)
        .single()
      if (data) {
        setForm({
          name: data.name || profile.name || '',
          bio: data.bio || '',
          skills: data.skills || [],
          experience: data.experience || 'beginner',
          github_url: data.github_url || '',
          linkedin_url: data.linkedin_url || '',
          portfolio_url: data.portfolio_url || '',
          avatar_url: data.avatar_url || '',
        })
        if (data.avatar_url) setAvatarPreview(data.avatar_url)
      }
      setLoading(false)
    }
    fetchUserData()
  }, [profile?.id])

  const handleAvatarClick = () => fileInputRef.current?.click()

  const handleAvatarChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
      return toast.error('Please upload a JPG, PNG, WebP, or GIF image')
    }
    if (file.size > 5 * 1024 * 1024) {
      return toast.error('Image must be under 5MB')
    }

    const previewUrl = URL.createObjectURL(file)
    setAvatarPreview(previewUrl)
    setUploading(true)

    try {
      const formData = new FormData()
      formData.append('avatar', file)
      formData.append('userId', profile.id)
      const res = await fetch('/upload-avatar', { method: 'POST', body: formData })
      const data = await res.json()
      if (!data.success) throw new Error(data.message)
      setForm(prev => ({ ...prev, avatar_url: data.url }))
      toast.success('Avatar uploaded!')
    } catch (err) {
      toast.error(err.message || 'Avatar upload failed')
      setAvatarPreview(form.avatar_url || null)
    } finally {
      setUploading(false)
    }
  }

  const addSkill = (skill) => {
    const trimmed = skill.trim()
    if (!trimmed || form.skills.includes(trimmed) || form.skills.length >= 15) return
    setForm(prev => ({ ...prev, skills: [...prev.skills, trimmed] }))
    setSkillInput('')
    setShowSuggestions(false)
  }

  const removeSkill = (skill) => {
    setForm(prev => ({ ...prev, skills: prev.skills.filter(s => s !== skill) }))
  }

  const handleSkillKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addSkill(skillInput)
    }
  }

  const filteredSuggestions = SKILLS_SUGGESTIONS.filter(s =>
    s.toLowerCase().includes(skillInput.toLowerCase()) && !form.skills.includes(s)
  ).slice(0, 8)

  const handleSave = async () => {
    if (!form.name?.trim()) return toast.error('Name is required')
    if (form.bio && form.bio.length > 300) return toast.error('Bio must be under 300 characters')

    setSaving(true)
    try {
      const res = await fetch('/profile/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: profile.id, ...form })
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.message)
      toast.success('Profile updated successfully!')
      setTimeout(() => navigate('/profile'), 1200)
    } catch (err) {
      toast.error(err.message || 'Failed to save profile')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-[#131b2c] via-[#050505] to-black flex items-center justify-center">
        <div className="w-10 h-10 border-2 border-white/10 border-t-ice-500 rounded-full animate-spin" />
      </div>
    )
  }

  const initials = (form.name || profile?.name || 'U').split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)

  return (
    <div className="min-h-screen w-full relative overflow-y-auto bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-[#131b2c] via-[#050505] to-black pb-24">
      <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 brightness-100 contrast-150 pointer-events-none mix-blend-overlay" />
      <Navbar />

      <div className="max-w-2xl mx-auto px-6 mt-10 space-y-6 relative z-10">

        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
          <div className="flex items-center gap-3 mb-6">
            <button onClick={() => navigate('/profile')} className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-all">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <div>
              <h1 className="text-2xl font-black text-white">Edit Profile</h1>
              <p className="text-sm text-slate-400">Update your public developer profile</p>
            </div>
          </div>
        </motion.div>

        {/* Avatar Section */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="bg-slate-900/50 backdrop-blur-xl border border-white/10 rounded-3xl p-8">
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-400 mb-6">Profile Photo</h2>
          <div className="flex items-center gap-6">
            <div className="relative cursor-pointer group" onClick={handleAvatarClick}>
              <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-ice-400 to-blue-600 p-0.5 shadow-[0_0_20px_rgba(14,165,233,0.25)]">
                <div className="w-full h-full bg-black rounded-2xl overflow-hidden flex items-center justify-center">
                  {avatarPreview ? (
                    <img src={avatarPreview} alt="Avatar" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-2xl font-black text-white">{initials}</span>
                  )}
                </div>
              </div>
              <div className={`absolute inset-0 bg-black/60 rounded-2xl flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity ${uploading ? 'opacity-100' : ''}`}>
                {uploading ? (
                  <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                )}
              </div>
            </div>
            <div>
              <p className="text-sm font-semibold text-white mb-1">Upload a profile photo</p>
              <p className="text-xs text-slate-500 mb-3">JPG, PNG, WebP or GIF. Max 5MB.</p>
              <button onClick={handleAvatarClick} disabled={uploading} className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-sm font-semibold text-white transition-all">
                {uploading ? 'Uploading...' : 'Choose Photo'}
              </button>
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
          </div>
        </motion.div>

        {/* Basic Info */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="bg-slate-900/50 backdrop-blur-xl border border-white/10 rounded-3xl p-8 space-y-5">
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-400">Basic Info</h2>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Full Name *</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
              placeholder="Your full name"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-ice-500/50 transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Bio <span className="normal-case font-normal text-slate-600">({(form.bio || '').length}/300)</span></label>
            <textarea
              value={form.bio}
              onChange={(e) => setForm(prev => ({ ...prev, bio: e.target.value }))}
              rows={3}
              maxLength={300}
              placeholder="Tell the community about yourself — your background, what you build, what drives you..."
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-ice-500/50 transition-colors resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Experience Level</label>
            <select
              value={form.experience}
              onChange={(e) => setForm(prev => ({ ...prev, experience: e.target.value }))}
              className="w-full bg-[#0d1117] border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-ice-500/50 transition-colors"
            >
              {EXPERIENCE_LEVELS.map(lvl => (
                <option key={lvl.value} value={lvl.value}>{lvl.label}</option>
              ))}
            </select>
          </div>
        </motion.div>

        {/* Skills */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="bg-slate-900/50 backdrop-blur-xl border border-white/10 rounded-3xl p-8">
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-400 mb-5">Skills <span className="normal-case font-normal text-slate-600">({form.skills.length}/15)</span></h2>
          
          <div className="flex flex-wrap gap-2 mb-4 min-h-[36px]">
            {form.skills.map(skill => (
              <span key={skill} className="flex items-center gap-1.5 px-3 py-1.5 bg-ice-500/10 border border-ice-500/20 rounded-lg text-xs font-semibold text-ice-400">
                {skill}
                <button onClick={() => removeSkill(skill)} className="text-ice-400/50 hover:text-red-400 transition-colors ml-0.5">
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </span>
            ))}
            {form.skills.length === 0 && <p className="text-xs text-slate-600 self-center">No skills added yet</p>}
          </div>

          <div className="relative">
            <input
              type="text"
              value={skillInput}
              onChange={(e) => { setSkillInput(e.target.value); setShowSuggestions(true) }}
              onKeyDown={handleSkillKeyDown}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
              placeholder="Type a skill and press Enter (e.g. React, Node.js)"
              disabled={form.skills.length >= 15}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-ice-500/50 transition-colors disabled:opacity-40"
            />
            {showSuggestions && skillInput && filteredSuggestions.length > 0 && (
              <div className="absolute top-full mt-1 left-0 right-0 bg-[#0d1117] border border-white/10 rounded-xl overflow-hidden shadow-2xl z-20">
                {filteredSuggestions.map(s => (
                  <button key={s} type="button" onMouseDown={() => addSkill(s)} className="w-full text-left px-4 py-2.5 text-sm text-slate-300 hover:bg-white/5 hover:text-white transition-colors">
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
          <p className="text-xs text-slate-600 mt-2">Press Enter or comma to add. Max 15 skills.</p>
        </motion.div>

        {/* Links */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="bg-slate-900/50 backdrop-blur-xl border border-white/10 rounded-3xl p-8 space-y-5">
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-400">Links</h2>

          {[
            { key: 'github_url', label: 'GitHub', placeholder: 'https://github.com/username', icon: (
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg>
            )},
            { key: 'linkedin_url', label: 'LinkedIn', placeholder: 'https://linkedin.com/in/username', icon: (
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
            )},
            { key: 'portfolio_url', label: 'Portfolio / Website', placeholder: 'https://yoursite.com', icon: (
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
            )},
          ].map(({ key, label, placeholder, icon }) => (
            <div key={key}>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">{label}</label>
              <div className="relative">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500">{icon}</div>
                <input
                  type="url"
                  value={form[key]}
                  onChange={(e) => setForm(prev => ({ ...prev, [key]: e.target.value }))}
                  placeholder={placeholder}
                  className="w-full bg-white/5 border border-white/10 rounded-xl pl-11 pr-4 py-3 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-ice-500/50 transition-colors"
                />
              </div>
            </div>
          ))}
        </motion.div>

        {/* Save Button */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="flex gap-4 pb-10">
          <button onClick={() => navigate('/profile')} className="flex-1 py-4 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 text-white font-bold transition-all">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 py-4 rounded-2xl bg-gradient-to-r from-ice-500 to-blue-600 text-white font-bold transition-all shadow-[0_0_25px_rgba(14,165,233,0.3)] hover:shadow-[0_0_35px_rgba(14,165,233,0.45)] disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {saving ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : (
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            )}
            {saving ? 'Saving...' : 'Save Profile'}
          </button>
        </motion.div>

      </div>
    </div>
  )
}
