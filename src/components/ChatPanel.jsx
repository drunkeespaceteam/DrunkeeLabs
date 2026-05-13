import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useToast } from './Toast'

function sanitizeMessage(input = '') {
  return String(input)
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<\/?script[^>]*>/gi, '')
    .replace(/[<>]/g, '')
}

export default function ChatPanel({ taskId, participantId, mentorId }) {
  const { profile } = useAuth()
  const toast = useToast()
  const [messages, setMessages] = useState([])
  const [newMessage, setNewMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [isRealtimeConnected, setIsRealtimeConnected] = useState(false)
  const messagesEndRef = useRef(null)

  const isMentor = profile?.id === mentorId

  useEffect(() => {
    if (!taskId || !participantId) return

    let isMounted = true

    // 1. Fetch initial messages
    const fetchMessages = async () => {
      if (!isMounted) return
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('task_id', taskId)
        .eq('participant_id', participantId)
        .order('created_at', { ascending: true })

      if (error) {
        toast.error('Failed to load chat history')
      } else {
        setMessages((prev) => {
          const merged = [...prev, ...(data || [])]
          const dedupedById = new Map()
          for (const msg of merged) {
            dedupedById.set(msg.id, { ...msg, message: sanitizeMessage(msg.message) })
          }
          return Array.from(dedupedById.values()).sort(
            (a, b) => new Date(a.created_at) - new Date(b.created_at)
          )
        })
      }
      if (loading) setLoading(false)
      scrollToBottom()
    }

    fetchMessages()

    // 2. Subscribe to new messages (Strictly filtered by task AND participant)
    const channel = supabase.channel(`chat:${taskId}:${participantId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `task_id=eq.${taskId}`,
      }, (payload) => {
        // Only process messages for this participant thread
        if (payload.new.participant_id !== participantId) return
        
        setMessages((prev) => {
          const sanitizedIncoming = { ...payload.new, message: sanitizeMessage(payload.new.message) }
          // Skip if we already have this exact message (optimistic or duplicate)
          if (prev.some(m => m.id === payload.new.id)) return prev
          // Also skip optimistic duplicates by matching content + sender within last 5s
          const isDuplicate = prev.some(m => 
            m.sender_id === payload.new.sender_id && 
            m.message === payload.new.message &&
            Math.abs(new Date(m.created_at) - new Date(payload.new.created_at)) < 5000
          )
          if (isDuplicate) {
            // Replace the optimistic message with the real one (to get the real ID)
            return prev.map(m => 
              (m.sender_id === payload.new.sender_id && m.message === payload.new.message && typeof m.id === 'string' && m.id.length > 30)
                ? sanitizedIncoming : m
            )
          }
          return [...prev, sanitizedIncoming]
        })
        setTimeout(scrollToBottom, 100)
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setIsRealtimeConnected(true)
          console.log(`[Chat] Realtime connected for task ${taskId}`)
        } else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) {
          setIsRealtimeConnected(false)
        }
      })

    // 3. Fallback polling (every 3s) only when realtime drops.
    const polling = setInterval(() => {
      if (!isRealtimeConnected) {
        fetchMessages()
      }
    }, 3000)

    return () => {
      isMounted = false
      clearInterval(polling)
      supabase.removeChannel(channel)
    }
  }, [taskId, participantId, isRealtimeConnected])

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const handleSendMessage = async (e) => {
    e.preventDefault()
    if (!newMessage.trim() || !profile || sending) return
    if (newMessage.length > 500) return toast.warning('Message too long (max 500 characters)')
    setSending(true)

    const text = sanitizeMessage(newMessage.trim())
    const tempId = crypto.randomUUID()
    const optimisticMsg = {
      id: tempId,
      task_id: taskId,
      participant_id: participantId,
      sender_id: profile.id,
      message: text,
      created_at: new Date().toISOString()
    }

    setMessages((prev) => [...prev, optimisticMsg])
    setTimeout(scrollToBottom, 100)
    setNewMessage('')

    try {
      const res = await fetch('/send-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId,
          participantId,
          senderId: profile.id,
          message: text
        })
      })
      const data = await res.json()
      if (!data.success) {
        toast.error(data.message || 'Failed to send message')
        setMessages((prev) => prev.filter(m => m.id !== tempId))
        setNewMessage(text) // Revert on failure
      }
    } catch (err) {
      toast.error('Network error while sending message')
      setMessages((prev) => prev.filter(m => m.id !== tempId))
      setNewMessage(text)
    } finally {
      setSending(false)
    }
  }

  if (loading) {
    return (
      <div className="h-full flex flex-col bg-white border-l border-slate-200">
        <div className="p-4 border-b border-slate-200 bg-slate-50">
          <h3 className="font-bold text-slate-800">Private Chat</h3>
        </div>
        <div className="flex-1 p-4 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-white border-l border-slate-200 shadow-xl z-10 w-80 shrink-0">
      <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
        <h3 className="font-bold text-slate-800 flex items-center gap-2">
          💬 {isMentor ? 'Chat with Participant' : 'Chat with Mentor'}
        </h3>
      </div>

      <div className="flex-1 p-4 overflow-y-auto bg-slate-50/50 space-y-4">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-400">
            <span className="text-3xl mb-2">👋</span>
            <p className="text-sm font-medium">Say hello!</p>
            <p className="text-xs text-center mt-1">This chat is private and secure.</p>
          </div>
        ) : (
          messages.map((msg) => {
            const isMe = msg.sender_id === profile?.id
            // Convert UTC timestamp to local browser time
            const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            
            return (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                key={msg.id} 
                className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
              >
                <div className={`px-4 py-2.5 rounded-2xl max-w-[85%] text-sm ${
                  isMe 
                    ? 'bg-emerald-500 text-white rounded-tr-sm' 
                    : 'bg-white border border-slate-200 text-slate-700 rounded-tl-sm shadow-sm'
                }`}>
                  {sanitizeMessage(msg.message)}
                </div>
                <span className="text-[10px] font-medium text-slate-400 mt-1 mx-1">
                  {time}
                </span>
              </motion.div>
            )
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-4 bg-white border-t border-slate-200">
        <div className="relative flex items-center">
          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !sending) handleSendMessage(e)
            }}
            placeholder="Type a message..."
            maxLength={500}
            disabled={sending}
            className="w-full pl-4 pr-12 py-3 bg-slate-50 border border-slate-200 rounded-full focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition-all text-sm font-medium text-slate-700 disabled:opacity-50"
          />
          <button
            type="button"
            onClick={handleSendMessage}
            disabled={!newMessage.trim() || sending}
            className="absolute right-2 p-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed z-10 cursor-pointer"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 2L11 13"/><path d="M22 2L15 22L11 13L2 9L22 2z"/></svg>
          </button>
        </div>
      </div>
    </div>
  )
}
