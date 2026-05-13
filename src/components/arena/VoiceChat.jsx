import { useEffect, useMemo, useRef, useState } from 'react'

function uid() {
  return Math.random().toString(16).slice(2)
}

export default function VoiceChat({ socket, matchId, selfUserId, selfName, locked }) {
  const [inVoice, setInVoice] = useState(false)
  const [muted, setMuted] = useState(false)
  const [voiceUsers, setVoiceUsers] = useState([])

  const localStreamRef = useRef(null)
  const peersRef = useRef(new Map()) // userId -> { pc }
  const remoteStreamRefs = useRef(new Map()) // userId -> MediaStream
  const audioElsRef = useRef(new Map()) // userId -> HTMLAudioElement

  const rtcConfig = useMemo(
    () => ({
      iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }]
    }),
    []
  )

  const ensureLocalStream = async () => {
    if (localStreamRef.current) return localStreamRef.current
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    localStreamRef.current = stream
    for (const track of stream.getAudioTracks()) track.enabled = !muted
    return stream
  }

  const addAudioToEl = (userId, stream) => {
    const el = audioElsRef.current.get(userId)
    if (el) {
      el.srcObject = stream
      el.play().catch(() => {})
    }
  }

  const createPeer = async ({ toUserId, localStream }) => {
    if (peersRef.current.has(toUserId)) return peersRef.current.get(toUserId)

    const pc = new RTCPeerConnection(rtcConfig)
    pc.onicecandidate = (e) => {
      if (!e.candidate) return
      socket.emit('arena_voice_signal', {
        matchId,
        toUserId,
        fromUserId: selfUserId,
        signal: { type: 'candidate', candidate: e.candidate }
      })
    }

    pc.ontrack = (e) => {
      const stream = e.streams?.[0]
      if (!stream) return
      remoteStreamRefs.current.set(toUserId, stream)
      addAudioToEl(toUserId, stream)
    }

    for (const track of localStream.getTracks()) pc.addTrack(track, localStream)

    peersRef.current.set(toUserId, { pc })
    return { pc }
  }

  const maybeMakeOffer = async (toUserId) => {
    const localStream = await ensureLocalStream()
    const { pc } = await createPeer({ toUserId, localStream })
    // Initiator rule: lexical smaller id creates the offer to reduce collisions.
    if (String(selfUserId) < String(toUserId)) {
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      socket.emit('arena_voice_signal', {
        matchId,
        toUserId,
        fromUserId: selfUserId,
        signal: { type: 'offer', sdp: offer }
      })
    }
  }

  const handleSignal = async ({ fromUserId, signal }) => {
    const { type } = signal || {}
    if (!type || !fromUserId) return

    const localStream = await ensureLocalStream()
    const { pc } = await createPeer({ toUserId: fromUserId, localStream })

    if (type === 'offer') {
      await pc.setRemoteDescription(signal.sdp)
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      socket.emit('arena_voice_signal', {
        matchId,
        toUserId: fromUserId,
        fromUserId: selfUserId,
        signal: { type: 'answer', sdp: answer }
      })
    } else if (type === 'answer') {
      await pc.setRemoteDescription(signal.sdp)
    } else if (type === 'candidate') {
      try {
        await pc.addIceCandidate(signal.candidate)
      } catch {
        // ignore candidate races
      }
    }
  }

  const joinVoice = async () => {
    if (inVoice) return
    setInVoice(true)
    await ensureLocalStream()
    socket.emit('arena_voice_join', {
      matchId,
      user: { id: selfUserId, name: selfName }
    })
    // include self
    setVoiceUsers([{ id: selfUserId, name: selfName }])
  }

  const leaveVoice = async () => {
    if (!inVoice) return
    setInVoice(false)
    socket.emit('arena_voice_leave', { matchId, user: { id: selfUserId, name: selfName } })
    setVoiceUsers([])

    // close peers
    for (const [peerUserId, { pc }] of peersRef.current.entries()) {
      try { pc.close() } catch {}
      peersRef.current.delete(peerUserId)
    }
  }

  useEffect(() => {
    if (!socket || !selfUserId || !matchId) return

    if (!locked) {
      // Auto-join on active match start.
      joinVoice().catch(() => {})
    }

    socket.on('arena_voice_joined', ({ user }) => {
      if (!user?.id) return
      if (user.id === selfUserId) return
      setVoiceUsers((prev) => {
        const exists = prev.some((u) => u.id === user.id)
        if (exists) return prev
        return [...prev, { id: user.id, name: user.name || 'Teammate' }]
      })
      maybeMakeOffer(user.id).catch(() => {})
    })

    socket.on('arena_voice_left', ({ user }) => {
      if (!user?.id) return
      setVoiceUsers((prev) => prev.filter((u) => u.id !== user.id))
      const entry = peersRef.current.get(user.id)
      if (entry?.pc) {
        try { entry.pc.close() } catch {}
      }
      peersRef.current.delete(user.id)
    })

    socket.on('arena_voice_signal', ({ fromUserId, signal }) => {
      handleSignal({ fromUserId, signal }).catch(() => {})
    })

    return () => {
      socket.off('arena_voice_joined')
      socket.off('arena_voice_left')
      socket.off('arena_voice_signal')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, matchId, selfUserId, locked])

  useEffect(() => {
    // Toggle mute state on local audio tracks.
    const stream = localStreamRef.current
    if (!stream) return
    for (const t of stream.getAudioTracks()) t.enabled = !muted
  }, [muted])

  useEffect(() => {
    if (locked) leaveVoice().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked])

  return (
    <div className="rounded-2xl bg-slate-900/70 border border-white/10 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-slate-400 font-bold">Team Voice</div>
          <div className="font-black mt-1">{locked ? 'Locked' : inVoice ? 'Live' : 'Join voice'}</div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={locked}
            onClick={() => (inVoice ? leaveVoice() : joinVoice()).catch(() => {})}
            className="px-3 py-2 rounded-xl font-bold text-sm border border-white/10 bg-white/5 hover:bg-white/10 text-slate-100"
          >
            {inVoice ? 'Leave' : 'Join'}
          </button>
          <button
            type="button"
            disabled={locked}
            onClick={() => setMuted((m) => !m)}
            className={`px-3 py-2 rounded-xl font-bold text-sm border ${
              locked ? 'opacity-50 cursor-not-allowed' : muted ? 'bg-rose-500/15 text-rose-200 border-rose-500/30' : 'bg-emerald-500/15 text-emerald-200 border-emerald-500/30'
            }`}
          >
            {muted ? 'Unmute' : 'Mute'}
          </button>
        </div>
      </div>

      <div className="text-xs text-slate-400">
        Teammates in room: <span className="text-slate-200 font-bold">{voiceUsers.length}</span>
      </div>

      <div className="space-y-2">
        {voiceUsers
          .filter((u) => u.id !== selfUserId)
          .map((u) => (
            <div key={u.id} className="flex items-center justify-between text-sm border border-white/5 bg-white/5 rounded-xl px-3 py-2">
              <span className="text-slate-200">{u.name}</span>
              <span className="text-slate-400">Audio</span>
            </div>
          ))}
      </div>

      {/* Hidden audio elements for each remote peer */}
      {voiceUsers
        .filter((u) => u.id !== selfUserId)
        .map((u) => (
          <audio
            key={u.id}
            ref={(el) => {
              if (!el) return
              audioElsRef.current.set(u.id, el)
              const stream = remoteStreamRefs.current.get(u.id)
              if (stream) addAudioToEl(u.id, stream)
            }}
            autoPlay
          />
        ))}
    </div>
  )
}

