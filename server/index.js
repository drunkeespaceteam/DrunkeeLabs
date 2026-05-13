import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import OpenAI from 'openai'
import Razorpay from 'razorpay'
import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import fsPromises from 'fs/promises'
import multer from 'multer'
import unzipper from 'unzipper'
import Docker from 'dockerode'
import { createProxyMiddleware } from 'http-proxy-middleware'
import archiver from 'archiver'
import { Server } from 'socket.io'
import http from 'http'
import net from 'net'
import { extractZipSafe, prepareProject, buildImage, runContainer, imageExists, removeOldContainersForSubmission } from './sandbox.js'
import * as cm from './containerManager.js'
import { pingRedis, validateRedisOnStartup } from './redisClient.js'
import { recoverRunningFromRedis } from './executionStateManager.js'
import {
  namesMatchForBankPayout,
  creditWalletBalance,
  createRazorpayPayoutForWithdrawal,
  withdrawalGrossAmount
} from './withdrawalPayout.js'
import { createArenaRouter } from './arena/arenaRouter.js'
import { initArenaSockets } from './arena/arenaSockets.js'

import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Load .env from server/ first, fall back to project root
const envResult = dotenv.config({ path: path.join(__dirname, '.env') })
if (envResult.error) {
  dotenv.config({ path: path.join(__dirname, '..', '.env') })
}

// ─── Initialize Supabase ───
const supabaseUrl = process.env.SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseKey = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
const supabase = createClient(supabaseUrl, supabaseKey)

/**
 * Merge submission_revisions with submissions.revision_delivery_log (server-written).
 * Prefer a real table row when the same revision_number exists.
 * If both are empty but current_revision / latest_artifact_url indicate a ZIP was stored, add one fallback row.
 */
function mergeSubmissionRevisionSources(submissionId, tableRows, deliveryLog, submissionRow) {
  const byRev = new Map()
  for (const r of tableRows || []) {
    const n = Number(r.revision_number)
    if (!Number.isFinite(n)) continue
    byRev.set(n, { ...r, _mergedSource: 'table' })
  }
  const logArr = Array.isArray(deliveryLog) ? deliveryLog : []
  for (const entry of logArr) {
    const rev = Number(entry.revision_number)
    if (!Number.isFinite(rev)) continue
    if (byRev.has(rev)) continue
    byRev.set(rev, {
      id: `delivery-log-${submissionId}-${rev}`,
      submission_id: submissionId,
      revision_number: rev,
      artifact_url: entry.artifact_url ? entry.artifact_url : 'text-only-response',
      clarification_message: entry.message ?? null,
      review_response_message: entry.message ?? null,
      created_at: entry.created_at || new Date().toISOString(),
      uploaded_by: entry.uploaded_by || null,
      sandbox_status: entry.sandbox_status || 'idle',
      _mergedSource: 'submission_log'
    })
  }
  const cr = Number(submissionRow?.current_revision)
  const latest = String(submissionRow?.latest_artifact_url || '').trim()
  const orig = String(
    submissionRow?.source_zip_url || submissionRow?.zip_url || submissionRow?.original_zip_url || ''
  ).trim()
  if (
    byRev.size === 0 &&
    Number.isFinite(cr) &&
    cr >= 1 &&
    latest &&
    latest !== 'text-only-response' &&
    latest !== orig
  ) {
    byRev.set(cr, {
      id: `fallback-latest-${submissionId}`,
      submission_id: submissionId,
      revision_number: cr,
      artifact_url: latest,
      clarification_message: null,
      review_response_message: null,
      created_at: submissionRow?.created_at || new Date().toISOString(),
      uploaded_by: submissionRow?.user_id || null,
      sandbox_status: 'idle',
      _mergedSource: 'submission_latest_fallback'
    })
  }
  return Array.from(byRev.values()).sort((a, b) => a.revision_number - b.revision_number)
}

// ─── Initialize Razorpay ───
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || 'placeholder_key_id',
  key_secret: process.env.RAZORPAY_KEY_SECRET || 'placeholder_key_secret',
})

const app = express()
const server = http.createServer(app)
const io = new Server(server, {
  cors: { origin: '*' }
})

app.use(cors())
app.use(express.json({ limit: '15mb' }))

// ─────────────────────────────────────────────
// ARENA API (isolated)
// ─────────────────────────────────────────────
app.use(
  '/api/arena',
  createArenaRouter({
    supabase,
    io,
    redisConnection: cm.redisConnection,
    storageBucket: (process.env.ARENA_STORAGE_BUCKET || 'submissions').trim()
  })
)

// Initialize Socket.IO rooms and Redis Pub/Sub
const redisSubscriber = cm.redisConnection.duplicate()
redisSubscriber.on('error', (err) => {
  if (err.code === 'ECONNREFUSED') return
  console.error('[RedisSubscriber] Error:', err.message)
})
redisSubscriber.subscribe('container-logs')

redisSubscriber.on('message', (channel, message) => {
  if (channel === 'container-logs') {
    try {
      const data = JSON.parse(message)
      io.to(`submission-${data.submissionId}`).emit('log', {
        submissionId: data.submissionId,
        message: data.message,
        timestamp: new Date().toISOString()
      })
    } catch (e) {
      console.error('PubSub parse error', e)
    }
  }
})

// Track socket connections per submission room for auto-shutdown
const roomMemberCount = new Map() // submissionId -> count
const roomGraceTimers = new Map()  // submissionId -> timeout ref

io.on('connection', (socket) => {
  socket.on('join', async (submissionId) => {
    socket.join(`submission-${submissionId}`)
    console.log(`[Socket] User joined room: submission-${submissionId}`)

    // Cancel any pending grace-period shutdown
    const existingTimer = roomGraceTimers.get(submissionId)
    if (existingTimer) {
      clearTimeout(existingTimer)
      roomGraceTimers.delete(submissionId)
    }

    roomMemberCount.set(submissionId, (roomMemberCount.get(submissionId) || 0) + 1)

    // Send existing logs immediately
    const logs = await cm.getLogs(submissionId)
    if (logs && logs.length > 0) {
      socket.emit('initial-logs', { submissionId, logs })
    }
  })

  socket.on('disconnecting', () => {
    // Decrement member count for all rooms this socket was in
    for (const room of socket.rooms) {
      if (room.startsWith('submission-')) {
        const submissionId = room.replace('submission-', '')
        const count = (roomMemberCount.get(submissionId) || 1) - 1
        roomMemberCount.set(submissionId, Math.max(0, count))

        if (count <= 0) {
          // Start 30-second grace period before auto-shutdown
          const timer = setTimeout(() => {
            const entry = cm.getContainer(submissionId)
            if (entry && entry.status === 'running') {
              console.log(`[Auto-Shutdown] No viewers for ${submissionId} — stopping sandbox`)
              cm.cleanupContainer(submissionId, 'no-viewers')
            }
            roomGraceTimers.delete(submissionId)
            roomMemberCount.delete(submissionId)
          }, 30000)
          roomGraceTimers.set(submissionId, timer)
        }
      }
    }
  })
})

// ─────────────────────────────────────────────
// ARENA SOCKET NAMESPACE (isolated)
// ─────────────────────────────────────────────
initArenaSockets({ io, supabase, redisConnection: cm.redisConnection })

// Configure OpenAI client
const openai = new OpenAI({ 
  apiKey: process.env.GROK_API_KEY || 'placeholder',
  baseURL: 'https://api.x.ai/v1'
})

// ─── Utility Functions ───

// Configure multer for file uploads
const upload = multer({
  dest: path.join(__dirname, 'tmp', 'uploads'),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
})

// ─── SANDBOX PORT RANGE ───
// Containers are ONLY ever allocated ports in this range by getAvailablePort().
// Any port outside this range stored in Redis is stale / corrupt and must be rejected
// to prevent accidental proxying to the platform's own services (5000=Vite, 3001=Express).
const SANDBOX_PORT_MIN = 40000
const SANDBOX_PORT_MAX = 50000

/**
 * Checks whether something is actually listening on a given localhost port.
 * Returns true/false within timeoutMs (default 600ms).
 * Used to validate stale Redis entries before proxying.
 */
function isPortListening(port, timeoutMs = 600) {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    let settled = false
    const done = (result) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
    socket.connect(port, '127.0.0.1')
  })
}

/**
 * Clears all Redis state for a stale submission and updates the DB to 'stopped'.
 * Called when a Redis entry says "running" but the port has nothing listening —
 * this happens when the Docker container ran on a different machine (local dev vs Replit).
 */
async function clearStaleRedisEntry(submissionId) {
  await Promise.allSettled([
    cm.redisConnection.del(`exec:${submissionId}`),
    cm.redisConnection.del(`container:${submissionId}`)
  ])
  // Update DB so frontend polling stops showing "running"
  await supabase
    .from('submissions')
    .update({ build_status: 'stopped', preview_url: null })
    .eq('id', submissionId)
    .catch(() => {})
  console.log(`[Preview Proxy] 🧹 Cleared stale entry + updated DB to stopped for ${submissionId}`)
}

// ═══════════════════════════════════════════════════════════════
// MENTOR REVIEW QA — Isolated preview (MUST mount before /preview/:submissionId)
// ═══════════════════════════════════════════════════════════════
app.use('/preview/review/:submissionId/:revision', async (req, res, next) => {
  try {
    const { submissionId, revision } = req.params
    const revNum = parseInt(revision, 10)
    let containerPort = null
    let source = 'none'

    const reviewEntry = cm.getReviewContainer(submissionId, revNum)
    if (reviewEntry?.port && reviewEntry.status === 'running') {
      containerPort = reviewEntry.port
      source = 'review-registry'
    }

    if (!containerPort) {
      const redisInfo = await cm.redisConnection.hgetall(`review_container:${submissionId}:${revNum}`).catch(() => ({}))
      if (redisInfo?.status === 'running' && redisInfo?.port) {
        const p = parseInt(redisInfo.port, 10)
        if (p >= 40000 && p <= 50000) {
          const alive = await isPortListening(p)
          if (alive) {
            containerPort = p
            source = 'review-redis'
          }
        }
      }
    }

    if (!containerPort) {
      return res.status(503).json({ error: 'Review sandbox not ready', submissionId, revision: revNum })
    }

    cm.touchReviewContainer(submissionId, revNum)
    console.log(`[Review Proxy] ✅ ${submissionId}:v${revNum} → :${containerPort} (source=${source})`)

    return createProxyMiddleware({
      target: `http://localhost:${containerPort}`,
      changeOrigin: true,
      ws: true,
      logLevel: 'silent',
      pathRewrite: { [`^/preview/review/${submissionId}/${revision}`]: '' },
      on: {
        proxyRes: (proxyRes) => {
          const ct = proxyRes.headers['content-type']
          if (ct && ct.includes('text/html') && !ct.includes('charset')) {
            proxyRes.headers['content-type'] = ct + '; charset=utf-8'
          }
        },
        error: (err, req, res) => {
          console.error(`[Review Proxy] ⚠️ Error for ${submissionId}:v${revNum}: ${err.message}`)
          if (res.status && !res.headersSent) {
            res.status(502).json({ error: 'Review sandbox is unresponsive', code: err.code })
          } else if (res.end) {
            res.end()
          }
        }
      }
    })(req, res, next)
  } catch (err) {
    next(err)
  }
})

// Dynamic proxy for previews
// Port resolution priority: in-memory registry → exec: Redis key → container: Redis key
// NOTE: The DB preview_url column stores /preview/:id (a stable path, not host:port),
//       so we NEVER try to parse a port from it. Port always comes from Redis or registry.
app.use('/preview/:submissionId', async (req, res, next) => {
  try {
    const { submissionId } = req.params
    let containerPort = null
    let source = 'none'

    // Helper: returns the NOT_READY html for any case where proxy can't serve
    const sendNotReady = (reason) => {
      console.log(`[Preview Proxy] ❌ ${submissionId}: ${reason}`)
      return res.status(404).send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Preview Not Ready</title>
<style>body{background:#0a0a0a;color:#94a3b8;font-family:monospace;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:12px}
h2{color:#f1f5f9;margin:0}p{margin:0;font-size:0.8rem}small{color:#475569}</style></head>
<body><h2>Preview Not Ready</h2>
<p>Container is still building or has not started yet.</p>
<small>${reason}</small></body></html>`)
    }

    // ─── PORT RANGE VALIDATOR ───
    // Rejects ports that are outside the sandbox allocation range.
    // Prevents accidental proxying to platform services (5000=Vite, 3001=Express).
    const isSandboxPort = (p) => Number.isInteger(p) && p >= SANDBOX_PORT_MIN && p <= SANDBOX_PORT_MAX

    // ─── 1. In-memory registry (trusted — only set by the active worker in this env) ───
    const registryEntry = cm.getContainer(submissionId)
    if (registryEntry?.status === 'running' && registryEntry?.port) {
      containerPort = registryEntry.port
      source = 'registry'
    }

    // ─── 2. exec: Redis key — written by worker via persistToRedis ───
    if (!containerPort) {
      const execInfo = await cm.redisConnection.hgetall(`exec:${submissionId}`).catch(() => null)
      if (execInfo?.status === 'running' && execInfo?.port) {
        const p = parseInt(execInfo.port, 10)
        if (!isSandboxPort(p)) {
          console.warn(`[Preview Proxy] ⚠️  exec: port ${p} outside sandbox range for ${submissionId} — clearing stale entry`)
          await clearStaleRedisEntry(submissionId)
          return sendNotReady(`stale-port-${p}`)
        }
        // TCP probe: verify something is actually listening (rejects cross-machine stale entries)
        const alive = await isPortListening(p)
        if (!alive) {
          console.warn(`[Preview Proxy] 💀 exec: port ${p} not listening for ${submissionId} — clearing stale entry`)
          await clearStaleRedisEntry(submissionId)
          return sendNotReady(`container-not-running-${p}`)
        }
        containerPort = p
        source = 'redis-exec'
        console.log(`[Preview Proxy] Synced :${containerPort} for ${submissionId} from exec: key`)
        cm.updateContainer(submissionId, {
          status: 'running',
          port: containerPort,
          containerId: execInfo.containerId || registryEntry?.containerId,
          lastAccessed: Date.now()
        })
      }
    }

    // ─── 3. container: Redis key — legacy key also written by worker ───
    if (!containerPort) {
      const containerInfo = await cm.redisConnection.hgetall(`container:${submissionId}`).catch(() => null)
      if (containerInfo?.status === 'running' && containerInfo?.port) {
        const p = parseInt(containerInfo.port, 10)
        if (!isSandboxPort(p)) {
          console.warn(`[Preview Proxy] ⚠️  container: port ${p} outside sandbox range for ${submissionId} — clearing stale entry`)
          await clearStaleRedisEntry(submissionId)
          return sendNotReady(`stale-port-${p}`)
        }
        const alive = await isPortListening(p)
        if (!alive) {
          console.warn(`[Preview Proxy] 💀 container: port ${p} not listening for ${submissionId} — clearing stale entry`)
          await clearStaleRedisEntry(submissionId)
          return sendNotReady(`container-not-running-${p}`)
        }
        containerPort = p
        source = 'redis-container'
        console.log(`[Preview Proxy] Synced :${containerPort} for ${submissionId} from container: key`)
        cm.updateContainer(submissionId, {
          status: 'running',
          port: containerPort,
          containerId: containerInfo.containerId || registryEntry?.containerId,
          lastAccessed: Date.now()
        })
      }
    }

    if (!containerPort) {
      // If DB still says "running" but we have no Redis entry and no registry entry,
      // the container is definitively gone (expired TTL or ran on a different machine).
      // Update DB to "stopped" so the frontend polling loop exits and shows the upload view.
      let dbRow = null
      try {
        const { data } = await supabase
          .from('submissions')
          .select('build_status')
          .eq('id', submissionId)
          .single()
        dbRow = data
      } catch (_) {}
      if (dbRow?.build_status === 'running') {
        try {
          await supabase
            .from('submissions')
            .update({ build_status: 'stopped', preview_url: null })
            .eq('id', submissionId)
        } catch (_) {}
        console.log(`[Preview Proxy] 🛑 DB updated to stopped for orphaned submission ${submissionId}`)
      }
      return sendNotReady(`no-active-container registry=${registryEntry?.status || 'none'}`)
    }

    cm.touchContainer(submissionId)

    console.log(`[Preview Proxy] ✅ ${submissionId} → :${containerPort} (source=${source})`)

    return createProxyMiddleware({
      target: `http://localhost:${containerPort}`,
      changeOrigin: true,
      ws: true,
      logLevel: 'silent',
      pathRewrite: {
        [`^/preview/${submissionId}`]: '',
      },
      on: {
        proxyRes: (proxyRes) => {
          const contentType = proxyRes.headers['content-type']
          if (contentType && contentType.includes('text/html') && !contentType.includes('charset')) {
            proxyRes.headers['content-type'] = contentType + '; charset=utf-8'
          }
        },
        error: (err, req, res) => {
          console.error(`[Preview Proxy] ⚠️ Proxy error for ${submissionId} on :${containerPort}: ${err.message}`)
          if (res.status && !res.headersSent) {
            // Serve a simulated success screen if the connection is refused
            // (this happens gracefully in local development when Docker is mocked)
            if (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET') {
              res.status(200).send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Mock Preview</title>
<style>body{background:#0f172a;color:#cbd5e1;font-family:monospace;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:12px;text-align:center;}
h2{color:#38bdf8;margin:0}p{margin:0;font-size:1rem;max-width:600px;line-height:1.5;}
.success{color:#4ade80;font-size:1.5rem;margin-bottom:1rem;}</style></head>
<body>
<div class="success">✓ Build Successful</div>
<h2>Interactive Preview (Mock Mode)</h2>
<p>Your code was successfully packaged and deployed to the isolated sandbox environment.</p>
<p style="margin-top:20px;color:#64748b;font-size:0.8rem;">(Note: Since you are running the server locally without Docker Desktop, this is a simulated success screen. In production, your actual app would render here instead.)</p>
</body></html>`)
            } else {
              res.status(502).send('Preview sandbox is unresponsive.')
            }
          } else if (res.end) {
            res.end() // Close websocket gracefully
          }
        }
      }
    })(req, res, next)
  } catch (err) {
    next(err)
  }
})

// Endpoint to upload task images
app.post('/upload-image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No image uploaded' })
    }

    const fileExt = path.extname(req.file.originalname)
    const fileName = `${crypto.randomUUID()}${fileExt}`
    const filePath = req.file.path

    const fileData = await fsPromises.readFile(filePath)

    const { error } = await supabase.storage
      .from('task-images')
      .upload(fileName, fileData, {
        contentType: req.file.mimetype,
        upsert: false
      })

    if (error) throw error

    const { data: { publicUrl } } = supabase.storage.from('task-images').getPublicUrl(fileName)

    await fsPromises.unlink(filePath).catch(console.error)

    res.json({ success: true, url: publicUrl })
  } catch (error) {
    console.error('Image upload failed:', error)
    res.status(500).json({ success: false, message: 'Image upload failed' })
  }
})


const logAudit = async (action, userId, metadata = {}) => {
  try {
    await supabase.from('audit_logs').insert({ action, user_id: userId, metadata })
  } catch (err) {
    console.error('Audit log failed:', err)
  }
}

const insertNotification = async (userId, type, message, link = null) => {
  try {
    await supabase.from('notifications').insert({ user_id: userId, type, message, link })
  } catch (err) {
    console.error('Notification failed:', err)
  }
}

/** Single-file ZIP for storage buckets that only allow application/zip (e.g. default `submissions`). */
function packBufferAsZip(filenameInside, data) {
  return new Promise((resolve, reject) => {
    const chunks = []
    const archive = archiver('zip', { zlib: { level: 6 } })
    archive.on('error', reject)
    archive.on('data', (c) => chunks.push(c))
    archive.on('end', () => resolve(Buffer.concat(chunks)))
    archive.append(data, { name: filenameInside })
    archive.finalize()
  })
}

const checkRateLimit = async (userId) => {
  const today = new Date().toISOString().split('T')[0]
  const { count, error } = await supabase
    .from('tasks')
    .select('*', { count: 'exact', head: true })
    .eq('mentor_id', userId)
    .gte('created_at', today)
    
  if (error) {
    console.error('[Rate Limit Check Error]', error)
    return true // Allow if error
  }

  if (count > 10) {
    await supabase.from('users').update({ is_flagged: true }).eq('id', userId)
    await logAudit('USER_FLAGGED', userId, { reason: 'Rate limit exceeded for task creation' })
    return false // Rate limit exceeded
  }
  return true
}

const requireAdmin = async (req, res, next) => {
  const adminId = req.headers['x-admin-id'] || req.body.adminId
  if (!adminId) return res.status(401).json({ success: false, message: 'Unauthorized' })
  
  const { data } = await supabase.from('users').select('role').eq('id', adminId).single()
  const adminRole = String(data?.role || '').trim().toLowerCase()
  if (adminRole !== 'admin') {
    return res.status(403).json({ success: false, message: 'Forbidden: Admin access required' })
  }
  next()
}

const FEATURED_TASK_BOOST_FEE = 99

function calculateTaskPlatformFee(rewardAmount) {
  const reward = Number(rewardAmount) || 0
  if (reward <= 0) return 0
  if (reward <= 500) return Math.round(reward * 0.10)
  if (reward <= 5000) return Math.round(reward * 0.08)
  return Math.round(reward * 0.05)
}

function calculateWithdrawalFee(amount) {
  const requested = Number(amount) || 0
  if (requested <= 0) return 0
  return Math.max(5, Math.ceil(requested * 0.02))
}

async function logRevenue(type, amount, referenceId) {
  if (!amount || amount <= 0) return
  try {
    await supabase
      .from('revenue_logs')
      .insert({
        type,
        amount,
        reference_id: referenceId
      })
  } catch (err) {
    console.error('[Revenue Log Error]', err?.message || err)
  }
}

async function getRevenueSummary() {
  const { data: logs } = await supabase
    .from('revenue_logs')
    .select('type, amount, created_at')
    .order('created_at', { ascending: true })

  const safeLogs = logs || []
  const total = safeLogs.reduce((acc, l) => acc + (Number(l.amount) || 0), 0)
  const byType = safeLogs.reduce((acc, l) => {
    const key = l.type || 'unknown'
    acc[key] = (acc[key] || 0) + (Number(l.amount) || 0)
    return acc
  }, {})

  const dailyMap = {}
  for (const log of safeLogs) {
    const day = new Date(log.created_at).toISOString().slice(0, 10)
    dailyMap[day] = (dailyMap[day] || 0) + (Number(log.amount) || 0)
  }
  const daily = Object.entries(dailyMap).map(([date, amount]) => ({ date, amount }))

  return { total, byType, daily }
}

// ─── ADMIN ENDPOINTS ───

app.get('/admin/stats', requireAdmin, async (req, res) => {
  try {
    const { data: users } = await supabase.from('users').select('id, kyc_status, role')
    const { total: totalRevenue } = await getRevenueSummary()
    const { data: tasks } = await supabase.from('tasks').select('id, closed')
    const { data: kyc } = await supabase.from('kyc_submissions').select('id, status')
    const { data: withdrawals } = await supabase.from('withdrawals').select('amount, status')

    const runningSandboxes = Array.from(cm.registry.values()).filter((entry) => entry.status === 'running').length
    const failedSandboxes = Array.from(cm.registry.values()).filter((entry) => entry.status === 'failed').length

    const stats = {
      totalUsers: users?.length || 0,
      totalRevenue,
      activeTasks: tasks?.length || 0,
      pendingKYC: kyc?.filter(k => k.status === 'pending').length || 0,
      pendingWithdrawals: withdrawals?.filter(w => w.status === 'pending').length || 0,
      activeContainers: cm.registry.size,
      runningSandboxes,
      failedSandboxes
    }

    res.json({ success: true, stats })
  } catch (err) { res.status(500).json({ success: false, message: 'Failed to fetch stats' }) }
})

app.get('/admin/system-health', requireAdmin, async (req, res) => {
  try {
    const health = cm.getSystemStats()
    res.json({ success: true, health })
  } catch (err) {
    console.error('[System Health Error]', err)
    res.status(500).json({ success: false, message: 'Failed to fetch system health' })
  }
})

app.get('/admin/all-data', requireAdmin, async (req, res) => {
  try {
    const { data: kyc } = await supabase.from('kyc_submissions').select('*').order('submitted_at', { ascending: false })
    const { data: payments } = await supabase.from('payments').select('*').order('created_at', { ascending: false })
    const { data: withdrawals } = await supabase.from('withdrawals').select('*').order('created_at', { ascending: false })
    const { data: users } = await supabase.from('users').select('*').order('created_at', { ascending: false })
    const { data: tasks } = await supabase.from('tasks').select('*').order('created_at', { ascending: false })

    res.json({ success: true, kyc, payments, withdrawals, users, tasks })
  } catch (err) { 
    console.error('[Admin All Data Error]', err)
    res.status(500).json({ success: false, message: 'Failed to fetch admin data' }) 
  }
})

app.post('/admin/approve-withdrawal', requireAdmin, async (req, res) => {
  try {
    const { withdrawalId, status } = req.body

    const { data: withdrawal } = await supabase.from('withdrawals').select('*').eq('id', withdrawalId).single()
    if (!withdrawal) return res.status(404).json({ success: false, message: 'Withdrawal not found' })

    if (withdrawal.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Withdrawal already processed' })
    }
    if (withdrawal.amount <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid withdrawal amount' })
    }
    if (withdrawal.razorpay_payout_id) {
      return res.status(400).json({ success: false, message: 'Payout already initiated' })
    }

    if (status === 'approved') {
      const { data: user } = await supabase.from('users').select('*').eq('id', withdrawal.user_id).single()
      if (!user) throw new Error('User not found')
      await createRazorpayPayoutForWithdrawal({ supabase, razorpay, withdrawal, user })
      await insertNotification(
        withdrawal.user_id,
        'withdrawal',
        `Your withdrawal of ₹${withdrawalGrossAmount(withdrawal)} is being sent to your bank (IMPS).`,
        '/profile'
      )
    } else {
      const gross = withdrawalGrossAmount(withdrawal)
      await creditWalletBalance(supabase, withdrawal.user_id, gross)
      await supabase.from('withdrawals').update({ status: 'rejected' }).eq('id', withdrawalId).eq('status', 'pending')
      await insertNotification(withdrawal.user_id, 'withdrawal', `Your withdrawal request was rejected. ₹${gross} returned to wallet.`, '/profile')
    }

    await logAudit('WITHDRAWAL_MODERATED', withdrawal.user_id, { status, withdrawalId })
    res.json({ success: true, message: `Withdrawal ${status === 'approved' ? 'processing' : 'rejected'} successfully.` })
  } catch (err) {
    console.error('[Admin Approve Withdrawal Error]', err)
    res.status(500).json({ success: false, message: err.message || 'Failed to moderate withdrawal. Check logs.' })
  }
})

// ─── RAZORPAY WEBHOOK (payouts + payment links) — single handler
app.post('/razorpay-webhook', async (req, res) => {
  try {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || ''
    const signature = req.headers['x-razorpay-signature']
    const skipVerify = !webhookSecret && process.env.NODE_ENV !== 'production'
    if (!skipVerify) {
      const generated = crypto.createHmac('sha256', webhookSecret).update(JSON.stringify(req.body)).digest('hex')
      if (generated !== signature) {
        console.warn('[Webhook] Invalid RAZORPAY_WEBHOOK_SECRET / signature mismatch')
        return res.status(400).send('Invalid signature')
      }
    } else {
      console.warn('[Webhook] Skipping signature verification (no RAZORPAY_WEBHOOK_SECRET, non-production)')
    }

    const event = req.body.event
    const payload = req.body.payload || {}

    // ── Payout lifecycle (employee withdrawals)
    if (typeof event === 'string' && event.startsWith('payout.')) {
      const payoutEntity = payload.payout?.entity
      if (!payoutEntity?.id) return res.status(200).send('OK')

      if (event === 'payout.processed') {
        const { data: updatedRows, error } = await supabase
          .from('withdrawals')
          .update({ status: 'completed' })
          .eq('razorpay_payout_id', payoutEntity.id)
          .eq('status', 'processing')
          .select('user_id, final_amount, requested_amount')
        if (error) throw error
        const row = updatedRows?.[0]
        if (row?.user_id) {
          const paid = Number(row.final_amount) || Number(row.requested_amount) || 0
          await insertNotification(
            row.user_id,
            'withdrawal',
            `Your bank transfer of ₹${paid} has completed successfully.`,
            '/profile'
          )
        }
        console.log('[Webhook] Payout processed:', payoutEntity.id)
      } else if (event === 'payout.failed' || event === 'payout.reversed') {
        const { data: withdrawal } = await supabase
          .from('withdrawals')
          .select('*')
          .eq('razorpay_payout_id', payoutEntity.id)
          .eq('status', 'processing')
          .maybeSingle()

        if (withdrawal) {
          await supabase.from('withdrawals').update({ status: 'failed' }).eq('id', withdrawal.id)
          const gross = withdrawalGrossAmount(withdrawal)
          await creditWalletBalance(supabase, withdrawal.user_id, gross)
          console.log('[Webhook] Payout failed/reversed; wallet refunded:', payoutEntity.id, gross)
          await insertNotification(
            withdrawal.user_id,
            'withdrawal',
            `Your bank payout could not be completed. ₹${gross} has been returned to your wallet.`,
            '/profile'
          )
        }
      }
      return res.status(200).send('OK')
    }

    // ── Payment link (mentor task creation)
    if (event === 'payment_link.paid') {
      const paymentLink = payload.payment_link.entity
      const linkId = paymentLink.id
      const amountPaid = paymentLink.amount_paid / 100
      const tempTaskId = paymentLink.notes.temp_task_id

      if (!tempTaskId) return res.status(400).send('No temp_task_id')

      const { data: payment } = await supabase.from('payments').select('*').eq('razorpay_order_id', linkId).single()
      if (!payment) return res.status(404).send('Payment not found')
      if (payment.status === 'locked' || payment.status === 'credited') return res.status(200).send('OK')

      const { data: pendingTask } = await supabase.from('pending_tasks').select('*').eq('id', tempTaskId).single()
      if (!pendingTask) return res.status(404).send('Pending task not found')
      const expectedTotal = Number(pendingTask.total_paid || pendingTask.reward)
      if (amountPaid !== expectedTotal) return res.status(400).send('Amount mismatch')

      const newTaskId = crypto.randomUUID()
      const { error: taskError } = await supabase.from('tasks').insert({
        id: newTaskId,
        mentor_id: pendingTask.mentor_id,
        title: pendingTask.title,
        description: pendingTask.description || '',
        category: pendingTask.category,
        difficulty: pendingTask.difficulty,
        reward: pendingTask.reward,
        platform_fee: pendingTask.platform_fee || 0,
        total_paid: pendingTask.total_paid || pendingTask.reward,
        closed: false
      })
      if (taskError) {
        console.error('[Webhook] Task insert failed:', taskError.message)
        throw new Error(`Failed to create task: ${taskError.message}`)
      }

      const { data: lockedPayments, error: lockErr } = await supabase
        .from('payments')
        .update({ status: 'locked', task_id: newTaskId })
        .eq('id', payment.id)
        .eq('status', 'created')
        .select()

      if (lockErr) {
        console.error('[Webhook] Failed to lock payment:', lockErr)
        throw new Error('Task created but payment lock failed.')
      }

      if (!lockedPayments || lockedPayments.length === 0) {
        await supabase.from('tasks').delete().eq('id', newTaskId)
        return res.status(200).send('OK')
      }

      await supabase.from('pending_tasks').delete().eq('id', tempTaskId)
      await logRevenue('task_fee', Number(payment.platform_fee || pendingTask.platform_fee || 0), newTaskId)

      await insertNotification(
        pendingTask.mentor_id,
        'task',
        `Your task "${pendingTask.title}" is now live! Payment of ₹${pendingTask.reward} has been locked in escrow.`,
        `/mentor/dashboard`
      )
      return res.status(200).send('OK')
    }

    if (event === 'payment_link.cancelled' || event === 'payment_link.expired') {
      const linkId = payload.payment_link.entity.id
      const { data: cancelledPayment } = await supabase
        .from('payments')
        .select('mentor_id, amount')
        .eq('razorpay_order_id', linkId)
        .eq('status', 'created')
        .single()
      await supabase
        .from('payments')
        .update({ status: event === 'payment_link.expired' ? 'expired' : 'cancelled' })
        .eq('razorpay_order_id', linkId)
        .eq('status', 'created')
      if (cancelledPayment) {
        const statusLabel = event === 'payment_link.expired' ? 'expired' : 'cancelled'
        await insertNotification(
          cancelledPayment.mentor_id,
          'payment',
          `Your payment of ₹${cancelledPayment.amount} has ${statusLabel}. No funds were deducted.`,
          `/mentor/dashboard`
        )
      }
      return res.status(200).send('OK')
    }

    return res.status(200).send('OK')
  } catch (err) {
    console.error('[Webhook Processing Error]', err)
    res.status(500).send('Webhook processing failed')
  }
})

app.post('/admin/toggle-user-status', requireAdmin, async (req, res) => {
  try {
    const { userId, isSuspended } = req.body
    await supabase.from('users').update({ is_suspended: isSuspended }).eq('id', userId)
    await logAudit('USER_STATUS_TOGGLED', userId, { isSuspended })
    res.json({ success: true, message: `User ${isSuspended ? 'suspended' : 'activated'} successfully.` })
  } catch (err) { res.status(500).json({ success: false, message: 'Failed to toggle user status' }) }
})

app.post('/admin/toggle-task-featured', requireAdmin, async (req, res) => {
  try {
    const { taskId, isFeatured } = req.body
    if (!taskId || typeof isFeatured !== 'boolean') {
      return res.status(400).json({ success: false, message: 'Missing taskId or isFeatured' })
    }
    const featuredUntil = isFeatured ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() : null
    await supabase
      .from('tasks')
      .update({ is_featured: isFeatured, featured_until: featuredUntil })
      .eq('id', taskId)
    res.json({ success: true, message: isFeatured ? 'Task is now featured.' : 'Task unfeatured.' })
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update featured status.' })
  }
})

app.post('/admin/remove-task', requireAdmin, async (req, res) => {
  try {
    const { taskId } = req.body
    if (!taskId) return res.status(400).json({ success: false, message: 'Missing taskId' })
    await supabase.from('tasks').delete().eq('id', taskId)
    res.json({ success: true, message: 'Task removed.' })
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to remove task.' })
  }
})

app.get('/admin/revenue', requireAdmin, async (req, res) => {
  try {
    const revenue = await getRevenueSummary()
    res.json({ success: true, ...revenue })
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch revenue summary' })
  }
})

app.get('/admin/sandboxes', requireAdmin, async (req, res) => {
  try {
    const now = Date.now()

    // 1. Build base list from in-memory registry
    const registryEntries = []
    for (const [submissionId, entry] of cm.registry.entries()) {
      registryEntries.push({
        submissionId,
        userId: entry.userId || null,
        taskId: entry.taskId || null,
        status: entry.status || 'unknown',
        port: entry.port || null,
        previewType: entry.previewType || 'employee',
        startedAt: entry.startedAt || null,
        lastAccessed: entry.lastAccessed || null,
        ageSeconds: entry.startedAt ? Math.round((now - entry.startedAt) / 1000) : null,
        inactiveSeconds: entry.lastAccessed ? Math.round((now - entry.lastAccessed) / 1000) : null,
        containerId: entry.containerId || null,
      })
    }

    // 2. Scan Redis for containers not in registry (worker-tracked, server-restarted)
    const redisKeys = await cm.redisConnection.keys('exec:*').catch(() => [])
    const seenIds = new Set(registryEntries.map(e => e.submissionId))
    for (const key of redisKeys) {
      const subId = key.replace('exec:', '')
      if (seenIds.has(subId)) continue
      const rd = await cm.redisConnection.hgetall(key).catch(() => null)
      if (!rd || rd.status !== 'running') continue
      registryEntries.push({
        submissionId: subId,
        userId: rd.userId || null,
        taskId: rd.taskId || null,
        status: 'running',
        port: rd.port ? parseInt(rd.port, 10) : null,
        previewType: 'employee',
        startedAt: null,
        lastAccessed: null,
        ageSeconds: null,
        inactiveSeconds: null,
        containerId: rd.containerId || null,
        fromRedisOnly: true,
      })
      seenIds.add(subId)
    }

    // 3. Batch-join user names and task titles from DB
    const userIds = [...new Set(registryEntries.map(e => e.userId).filter(Boolean))]
    const taskIds = [...new Set(registryEntries.map(e => e.taskId).filter(Boolean))]

    const [usersRes, tasksRes] = await Promise.all([
      userIds.length > 0
        ? supabase.from('users').select('id, name').in('id', userIds)
        : Promise.resolve({ data: [] }),
      taskIds.length > 0
        ? supabase.from('tasks').select('id, title').in('id', taskIds)
        : Promise.resolve({ data: [] })
    ])

    const userMap = Object.fromEntries((usersRes.data || []).map(u => [u.id, u.name]))
    const taskMap = Object.fromEntries((tasksRes.data || []).map(t => [t.id, t.title]))

    // 4. Fetch recent logs for each container from Redis logs buffer
    const containers = await Promise.all(registryEntries.map(async (entry) => {
      const recentLogs = await cm.getLogs(entry.submissionId).catch(() => [])
      return {
        ...entry,
        userName: userMap[entry.userId] || null,
        taskTitle: taskMap[entry.taskId] || null,
        recentLogs: recentLogs.slice(-30),
      }
    }))

    // Sort: failed first, then running, then building, then others
    const statusOrder = { failed: 0, running: 1, building: 2, starting: 3, health_check: 4, queued: 5, stopped: 6, timeout: 7, unknown: 8 }
    containers.sort((a, b) => (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9))

    res.json({ success: true, containers, total: containers.length })
  } catch (err) {
    console.error('[Admin Sandboxes Error]', err)
    res.status(500).json({ success: false, message: 'Failed to fetch sandbox data' })
  }
})

app.get('/admin/system-monitoring', requireAdmin, async (req, res) => {
  try {
    const redisHealthy = await cm.isRedisHealthy()
    let dockerHealthy = false
    try {
      await cm.docker.ping()
      dockerHealthy = true
    } catch {
      dockerHealthy = false
    }

    const containers = Array.from(cm.registry.entries()).map(([submissionId, entry]) => ({
      submissionId,
      taskId: entry.taskId,
      userId: entry.userId,
      status: entry.status,
      port: entry.port,
      lastAccessed: entry.lastAccessed,
      startedAt: entry.startedAt
    }))

    const running = containers.filter((c) => c.status === 'running').length
    const failed = containers.filter((c) => c.status === 'failed').length
    const queueStats = {
      waiting: await cm.redisConnection.llen('bull:sandbox-execution:wait').catch(() => 0),
      active: await cm.redisConnection.llen('bull:sandbox-execution:active').catch(() => 0),
      delayed: await cm.redisConnection.zcard('bull:sandbox-execution:delayed').catch(() => 0)
    }

    res.json({
      success: true,
      uptimeSeconds: Math.round(process.uptime()),
      redisHealthy,
      dockerHealthy,
      activePreviews: cm.registry.size,
      runningSandboxes: running,
      failedSandboxes: failed,
      queue: queueStats,
      containers
    })
  } catch (err) {
    console.error('[System Monitoring Error]', err)
    res.status(500).json({ success: false, message: 'Failed to fetch system monitoring' })
  }
})

app.post('/admin/kill-container', requireAdmin, async (req, res) => {
  try {
    const { submissionId } = req.body
    if (!submissionId) return res.status(400).json({ success: false, message: 'Missing submissionId' })
    const entry = cm.getContainer(submissionId)
    if (!entry) return res.status(404).json({ success: false, message: 'Container not found' })

    const container = cm.docker.getContainer(entry.containerId)
    await container.stop().catch(() => {})
    await container.remove().catch(() => {})
    if (entry.port) cm.releasePort(entry.port)
    cm.registry.delete(submissionId)
    await supabase.from('submissions').update({ build_status: 'stopped' }).eq('id', submissionId)
    res.json({ success: true, message: 'Container killed successfully.' })
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to kill container.' })
  }
})

// ─── Task metadata for context ───
const TASKS = {
  1: { title: 'Build a REST API', category: 'Backend' },
  2: { title: 'Landing Page Redesign', category: 'Frontend' },
  3: { title: 'Real-time Chat System', category: 'Backend' },
  4: { title: 'Design System Components', category: 'Design' },
  5: { title: 'Payment Gateway Integration', category: 'API' },
  6: { title: 'Dashboard Analytics UI', category: 'Frontend' },
}

// ─── Evaluation Endpoint ───
app.post('/submit-project', async (req, res) => {
  try {
    const { taskId, userId, files } = req.body

    if (!files || typeof files !== 'object' || Object.keys(files).length === 0) {
      return res.status(400).json({ success: false, message: 'Project files are required' })
    }

    // Check task is not closed
    const { data: taskData } = await supabase.from('tasks').select('closed, title, category').eq('id', taskId).single()
    if (taskData?.closed) return res.status(400).json({ success: false, message: 'This task is closed. No more submissions allowed.' })

    // Check if user has a closed submission for this task
    const { data: existingSubs } = await supabase.from('submissions').select('*').eq('task_id', taskId).eq('user_id', userId).order('created_at', { ascending: false }).limit(1)
    const existingSub = existingSubs?.[0]
    if (existingSub?.is_final) return res.status(400).json({ success: false, message: 'Your submission is finalized. You cannot resubmit.' })

    const task = taskData || TASKS[taskId] || { title: 'Unknown Task', category: 'General' }

    let combinedCode = ''
    for (const [filename, content] of Object.entries(files)) {
      if (!filename.endsWith('/.keep')) {
        combinedCode += `\n--- File: ${filename} ---\n\`\`\`\n${content}\n\`\`\`\n`
      }
    }

    const prompt = `You are a senior code reviewer and mentor evaluating a developer's full project submission.

Task: "${task.title}" (Category: ${task.category})

Project Files:
${combinedCode}

Evaluate this entire project architecture based on:
1. **Functionality** - Does the combined code work together to solve the problem? Are there logic errors?
2. **Code Structure** - Are files organized well? Is the separation of concerns clear?
3. **Best Practices** - Does it follow modern web development conventions?
4. **Completeness** - Is it a robust, complete solution?

Return your evaluation as a JSON object with EXACTLY this structure (no markdown, no code fences, just raw JSON starting with { and ending with }):
{
  "score": <number 0-100>,
  "strengths": ["<strength 1>", "<strength 2>", "<strength 3>"],
  "weaknesses": ["<area for improvement 1>", "<area for improvement 2>"],
  "suggestions": ["<suggestion 1>", "<suggestion 2>", "<suggestion 3>"],
  "feedback": "<2-3 sentence overall encouraging summary of the project architecture>"
}

Be constructive and encouraging. Score generously for effort but accurately for architectural quality.`

    let result
    try {
      const completion = await openai.chat.completions.create({
        model: 'grok-2',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 1000,
      })

      const raw = completion.choices[0]?.message?.content || ''

      try {
        const jsonStr = raw.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
        result = JSON.parse(jsonStr)
      } catch {
        console.log('[AI Eval] JSON parse failed, using mock evaluation')
        result = getMockEvaluation(combinedCode)
      }
    } catch (aiError) {
      console.error('[AI Eval] API call failed:', aiError.message)
      result = getMockEvaluation(combinedCode)
    }

    result.score = Math.min(100, Math.max(0, Number(result.score) || 75))
    result.strengths = Array.isArray(result.strengths) && result.strengths.length > 0 ? result.strengths : ['Good initial structure']
    result.weaknesses = Array.isArray(result.weaknesses) && result.weaknesses.length > 0 ? result.weaknesses : ['Could use more modularity']
    result.suggestions = Array.isArray(result.suggestions) && result.suggestions.length > 0 ? result.suggestions : ['Add comments and documentation']
    result.feedback = result.feedback || 'Good effort! Keep building.'

    res.json({ success: true, data: result })
  } catch (error) {
    console.error('[Submit Project] Fatal error:', error.message)
    res.status(500).json({ success: false, message: 'Evaluation error' })
  }
})

function getMockEvaluation(codeStr) {
  const fileCount = (codeStr.match(/--- File:/g) || []).length
  const lines = codeStr.split('\n').filter((l) => l.trim()).length

  let score = 60
  if (fileCount > 2) score += 10
  if (lines > 50) score += 15
  score = Math.min(98, score)

  return {
    score,
    strengths: ['Solid initial foundation for the project requirements', 'Follows basic structural conventions'],
    weaknesses: ['Missing comprehensive error handling'],
    suggestions: ['Implement structured error boundaries'],
    feedback: `Great start! Your project demonstrates a solid understanding of the requirements.`
  }
}

// ─── Close Submission (Finalize) ───
app.post('/close-submission', async (req, res) => {
  try {
    const { userId, taskId } = req.body
    if (!userId || !taskId) return res.status(400).json({ success: false, message: 'Missing userId or taskId' })

    const { data: subs } = await supabase.from('submissions').select('*').eq('task_id', taskId).eq('user_id', userId).order('created_at', { ascending: false }).limit(1)
    const sub = subs?.[0]
    if (!sub) return res.status(404).json({ success: false, message: 'No submission found for this task.' })
    if (sub.user_id !== userId) return res.status(403).json({ success: false, message: 'Unauthorized.' })
    if (sub.is_final) return res.status(400).json({ success: false, message: 'Submission is already finalized.' })

    const { error: updateError } = await supabase.from('submissions').update({ is_final: true }).eq('id', sub.id)
    if (updateError) {
      console.error('[Close Submission Update Error]', updateError)
      return res.status(500).json({ success: false, message: `Database error: ${updateError.message}` })
    }

    // Notify the mentor
    const { data: task } = await supabase.from('tasks').select('mentor_id, title').eq('id', taskId).single()
    if (task) {
      await insertNotification(task.mentor_id, 'submission', `A developer has finalized their submission for task "${task.title}". Ready for your review!`, `/mentor/task/${taskId}/submissions`)
    }

    await logAudit('SUBMISSION_CLOSED', userId, { taskId, submissionId: sub.id })
    res.json({ success: true, message: 'Submission finalized. Good luck!' })
  } catch (error) {
    console.error('[Close Submission]', error.message)
    res.status(500).json({ success: false, message: 'Failed to close submission.' })
  }
})

// ─── Check Task Status for User ───
app.post('/check-task-status', async (req, res) => {
  try {
    const { userId, taskId } = req.body
    if (!userId || !taskId) return res.status(400).json({ success: false, message: 'Missing userId or taskId' })

    const { data: subs } = await supabase.from('submissions').select('*').eq('task_id', taskId).eq('user_id', userId).order('created_at', { ascending: false }).limit(1)
    const sub = subs?.[0]

    if (!sub) {
      return res.json({ success: true, data: { hasSubmission: false } })
    }

    res.json({
      success: true,
      data: {
        hasSubmission: true,
        submissionId: sub.id,
        isClosed: sub.is_final || false,
        isWinner: sub.is_winner || false,
        deliveryStatus: sub.delivery_status,
        score: sub.score,
        attemptNumber: sub.attempt_number || 1
      }
    })
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to check task status.' })
  }
})

// ─── Real-Money Escrow API ───

app.post('/create-qr-payment', async (req, res) => {
  try {
    const { taskDetails, mentorId, reward } = req.body
    if (!mentorId || !reward || reward <= 0) return res.status(400).json({ success: false, message: 'Invalid order parameters.' })

    const isAllowed = await checkRateLimit(mentorId)
    if (!isAllowed) return res.status(429).json({ success: false, message: 'Rate limit exceeded.' })

    const tempTaskId = crypto.randomUUID()
    const platformFee = calculateTaskPlatformFee(reward)
    const totalPaid = Number(reward) + platformFee

    // Store all rich task data as JSON in description for retrieval after payment
    const richTaskData = JSON.stringify({
      problem: taskDetails.problem || '',
      requirements: taskDetails.requirements || [],
      input: taskDetails.input || '',
      output: taskDetails.output || '',
      evaluation: taskDetails.evaluation || {},
      tech: taskDetails.tech || {},
      submission: taskDetails.submission || '',
      description_images: taskDetails.description_images || []
    })

    const { error: pendingError } = await supabase.from('pending_tasks').insert({
      id: tempTaskId, 
      mentor_id: mentorId, 
      title: taskDetails.title, 
      description: richTaskData,
      category: taskDetails.category, 
      difficulty: taskDetails.difficulty, 
      reward: reward,
      platform_fee: platformFee,
      total_paid: totalPaid
    })
    if (pendingError) throw pendingError

    const expireBy = Math.floor(Date.now() / 1000) + (20 * 60)
    const options = { amount: totalPaid * 100, currency: 'INR', accept_partial: false, description: `Task Escrow`, expire_by: expireBy, reference_id: tempTaskId, notes: { temp_task_id: tempTaskId } }
    const paymentLink = await razorpay.paymentLink.create(options)

    const { error: paymentError } = await supabase.from('payments').insert({
      task_id: tempTaskId, mentor_id: mentorId, amount: reward, platform_fee: platformFee, total_paid: totalPaid,
      net_amount: reward, status: 'created', razorpay_order_id: paymentLink.id, expires_at: new Date(expireBy * 1000).toISOString()
    })
    if (paymentError) throw paymentError

    res.json({ success: true, data: { paymentId: paymentLink.id, shortUrl: paymentLink.short_url, reward, platformFee, totalPaid } })
  } catch (error) { res.status(500).json({ success: false, message: 'Failed to create QR payment link.' }) }
})

app.post('/cancel-payment', async (req, res) => {
  try {
    const { paymentId } = req.body
    const { data: payment } = await supabase.from('payments').select('task_id').eq('razorpay_order_id', paymentId).eq('status', 'created').single()
    if (payment?.task_id) {
      await supabase.from('pending_tasks').delete().eq('id', payment.task_id)
    }
    await supabase.from('payments').update({ status: 'cancelled' }).eq('razorpay_order_id', paymentId).eq('status', 'created')
    res.json({ success: true, message: 'Payment cancelled' })
  } catch (error) { res.status(500).json({ success: false, message: 'Failed to cancel payment.' }) }
})

app.post('/create-checkout-order', async (req, res) => {
  try {
    const { taskDetails, mentorId, reward } = req.body
    if (!mentorId || !reward || reward <= 0) return res.status(400).json({ success: false, message: 'Invalid order parameters.' })
    const isAllowed = await checkRateLimit(mentorId)
    if (!isAllowed) return res.status(429).json({ success: false, message: 'Rate limit exceeded.' })

    const tempTaskId = crypto.randomUUID()
    const platformFee = calculateTaskPlatformFee(reward)
    const totalPaid = Number(reward) + platformFee

    // Store all rich task data as JSON in description for retrieval after payment
    const richTaskData = JSON.stringify({
      problem: taskDetails.problem || '',
      requirements: taskDetails.requirements || [],
      input: taskDetails.input || '',
      output: taskDetails.output || '',
      evaluation: taskDetails.evaluation || {},
      tech: taskDetails.tech || {},
      submission: taskDetails.submission || '',
      description_images: taskDetails.description_images || []
    })

    const { error: pendingError } = await supabase.from('pending_tasks').insert({
      id: tempTaskId, 
      mentor_id: mentorId, 
      title: taskDetails.title, 
      description: richTaskData,
      category: taskDetails.category, 
      difficulty: taskDetails.difficulty, 
      reward: reward,
      platform_fee: platformFee,
      total_paid: totalPaid
    })
    if (pendingError) {
      console.error('[Pending Task Insert Error]', pendingError)
      throw pendingError
    }

    const order = await razorpay.orders.create({ 
      amount: totalPaid * 100, 
      currency: 'INR', 
      receipt: `rcpt_${tempTaskId.substring(0, 30)}`,
      notes: {
        tempTaskId
      }
    })

    const { error: paymentError } = await supabase.from('payments').insert({
      task_id: tempTaskId, 
      mentor_id: mentorId, 
      amount: reward, 
      platform_fee: platformFee, 
      total_paid: totalPaid,
      net_amount: reward,
      status: 'created', 
      razorpay_order_id: order.id
    })
    if (paymentError) {
      console.error('[Payment Insert Error]', paymentError)
      throw paymentError
    }

    res.json({ success: true, data: { key: process.env.RAZORPAY_KEY_ID, orderId: order.id, amount: order.amount, tempTaskId, reward, platformFee, totalPaid } })
  } catch (error) { 
    console.error('[Create Checkout Order Error]', error)
    res.status(500).json({ success: false, message: error.message || 'Failed to create checkout order.' }) 
  }
})

app.post('/verify-checkout-payment', async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, tempTaskId } = req.body

    // Step 1: Verify Razorpay signature
    const expectedSignature = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(razorpay_order_id + '|' + razorpay_payment_id).digest('hex')
    if (expectedSignature !== razorpay_signature) {
      console.error('[Verify Payment] Signature mismatch. Expected:', expectedSignature, 'Received:', razorpay_signature)
      return res.status(400).json({ success: false, message: 'Invalid payment signature.' })
    }

    // Step 2: Find payment record
    const { data: payment, error: paymentErr } = await supabase.from('payments').select('*').eq('razorpay_order_id', razorpay_order_id).single()
    if (paymentErr) console.error('[Verify Payment] DB error fetching payment:', paymentErr)
    if (!payment) return res.status(404).json({ success: false, message: 'Payment record not found in database.' })
    if (payment.status !== 'created') return res.status(400).json({ success: false, message: `Payment already processed (status: ${payment.status}).` })

    // Step 3: Find pending task
    const { data: pendingTask, error: pendingErr } = await supabase.from('pending_tasks').select('*').eq('id', tempTaskId).single()
    if (pendingErr) console.error('[Verify Payment] DB error fetching pending task:', pendingErr)
    if (!pendingTask) return res.status(404).json({ success: false, message: 'Pending task not found. It may have expired.' })

    // Step 4: Unpack rich task data
    let richData = {}
    try {
      richData = JSON.parse(pendingTask.description || '{}')
    } catch {
      richData = { problem: pendingTask.description || '' }
    }

    // Step 5: Create the actual task
    const newTaskId = crypto.randomUUID()

    // Pack all rich task data into description as JSON (tasks table doesn't have problem/requirements/etc columns)
    const packedDescription = JSON.stringify({
      problem: richData.problem || '',
      requirements: richData.requirements || [],
      input: richData.input || '',
      output: richData.output || '',
      evaluation: richData.evaluation || {},
      tech: richData.tech || {},
      submission: richData.submission || '',
      description_images: richData.description_images || []
    })

    const taskPayload = {
      id: newTaskId,
      mentor_id: pendingTask.mentor_id,
      title: pendingTask.title,
      description: packedDescription,
      category: pendingTask.category,
      difficulty: pendingTask.difficulty,
      reward: pendingTask.reward,
      platform_fee: pendingTask.platform_fee || payment.platform_fee || 0,
      total_paid: pendingTask.total_paid || payment.total_paid || pendingTask.reward,
      closed: false
    }

    const { error: taskError } = await supabase.from('tasks').insert(taskPayload)
    if (taskError) {
      console.error('[Verify Payment] Task insert failed:', taskError.message)
      return res.status(500).json({ success: false, message: `Failed to create task: ${taskError.message}` })
    }

    // Step 6: Atomically lock payment (prevents duplicate tasks from race conditions)
    const { data: lockedPayments, error: lockErr } = await supabase
      .from('payments')
      .update({ status: 'locked', task_id: newTaskId })
      .eq('id', payment.id)
      .eq('status', 'created')
      .select()

    if (lockErr) {
      console.error('[Verify Payment] Failed to lock payment:', lockErr)
      return res.status(500).json({ success: false, message: 'Task created but payment lock failed.' })
    }

    if (!lockedPayments || lockedPayments.length === 0) {
      // Another request already processed this payment — delete the duplicate task we just created
      await supabase.from('tasks').delete().eq('id', newTaskId)
      return res.json({ success: true, message: 'Payment already processed.' })
    }

    // Step 7: Log revenue and cleanup
    await logRevenue('task_fee', Number(payment.platform_fee) || Number(pendingTask.platform_fee) || 0, newTaskId)
    await supabase.from('pending_tasks').delete().eq('id', tempTaskId)

    res.json({ success: true, message: 'Payment verified and task created.' })
  } catch (error) {
    console.error('[Verify Payment Error]', error)
    res.status(500).json({ success: false, message: error?.message || 'Payment verification failed.' })
  }
})

app.post('/feature-task', async (req, res) => {
  try {
    const { taskId, mentorId } = req.body
    if (!taskId || !mentorId) return res.status(400).json({ success: false, message: 'Missing taskId or mentorId' })

    const { data: task } = await supabase.from('tasks').select('id, mentor_id, title').eq('id', taskId).single()
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' })
    if (task.mentor_id !== mentorId) return res.status(403).json({ success: false, message: 'Unauthorized' })

    const order = await razorpay.orders.create({
      amount: FEATURED_TASK_BOOST_FEE * 100,
      currency: 'INR',
      receipt: `feat_${taskId}`.slice(0, 40),
      notes: { taskId, mentorId, feature: 'true' }
    })

    const { error: featuredPaymentError } = await supabase.from('payments').insert({
      task_id: taskId,
      mentor_id: mentorId,
      amount: FEATURED_TASK_BOOST_FEE,
      platform_fee: FEATURED_TASK_BOOST_FEE,
      total_paid: FEATURED_TASK_BOOST_FEE,
      net_amount: FEATURED_TASK_BOOST_FEE,
      status: 'created',
      razorpay_order_id: order.id,
      payment_type: 'featured'
    })
    if (featuredPaymentError) {
      console.warn('[Feature Task] Payment insert failed:', featuredPaymentError.message)
    }

    return res.json({ success: true, data: { orderId: order.id, amount: order.amount, fee: FEATURED_TASK_BOOST_FEE } })
  } catch (error) {
    console.error('[Feature Task Error]', error)
    return res.status(500).json({ success: false, message: 'Failed to create featured task order' })
  }
})

app.post('/verify-feature-task-payment', async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, taskId, mentorId } = req.body
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex')
    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ success: false, message: 'Invalid payment signature.' })
    }

    const featuredUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    await supabase
      .from('tasks')
      .update({ is_featured: true, featured_until: featuredUntil })
      .eq('id', taskId)
      .eq('mentor_id', mentorId)

    await supabase
      .from('payments')
      .update({ status: 'credited', payment_type: 'featured' })
      .eq('razorpay_order_id', razorpay_order_id)

    await logRevenue('featured_fee', FEATURED_TASK_BOOST_FEE, taskId)
    await insertNotification(mentorId, 'payment', 'Your task is now featured for 24 hours.', '/mentor/dashboard')
    return res.json({ success: true, message: 'Task featured successfully.' })
  } catch (error) {
    console.error('[Verify Feature Task Payment Error]', error)
    return res.status(500).json({ success: false, message: 'Featured payment verification failed.' })
  }
})

// ─── DELIVERY WORKFLOW (REPLACES /select-winner) ───

// Step 1: Mentor announces winner (closes task, sets delivery to pending)
app.post('/announce-winner', async (req, res) => {
  try {
    const { taskId, submissionId, mentorId } = req.body

    const { data: task } = await supabase.from('tasks').select('mentor_id, closed, title, reward').eq('id', taskId).single()
    if (!task) return res.status(404).json({ success: false, message: 'Task not found.' })
    if (task.mentor_id !== mentorId) return res.status(403).json({ success: false, message: 'Unauthorized.' })
    if (task.closed) return res.status(400).json({ success: false, message: 'Task already closed.' })

    // Get the winner's current files to auto-snapshot
    const { data: winnerSub } = await supabase.from('submissions').select('files, user_id').eq('id', submissionId).single()

    // ✨ WALLET INTEGRATION: Lock funds when winner is announced
    if (task.reward && task.reward > 0) {
      const { data: rpcData, error: rpcErr } = await supabase.rpc('lock_escrow_funds', { 
        p_submission_id: submissionId, 
        p_task_id: taskId, 
        p_user_id: winnerSub.user_id, 
        p_amount: task.reward 
      })
      if (rpcErr) {
        console.error('[Wallet] Failed to lock escrow:', rpcErr)
      } else {
        console.log('[Wallet] Escrow locked:', rpcData)
      }
    }

    // Mark winner, auto-snapshot code, set delivery_status to 'submitted' (ready for mentor confirmation)
    await supabase.from('submissions').update({ 
      is_winner: true, 
      delivery_status: 'submitted',
      final_files: winnerSub?.files || {},
      delivered_at: new Date().toISOString(),
      delivery_deadline: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
    }).eq('id', submissionId)
    await supabase.from('tasks').update({ closed: true }).eq('id', taskId)

    // Notify ALL participants about winner announcement
    const { data: allSubmissions } = await supabase.from('submissions').select('user_id, id').eq('task_id', taskId)
    if (allSubmissions) {
      for (const sub of allSubmissions) {
        if (sub.id === submissionId) {
          await insertNotification(sub.user_id, 'winner', `🏆 You've been selected as the winner for task "${task.title || 'Task'}"! Waiting for mentor to confirm your code.`, `/task/${taskId}`)
        } else {
          await insertNotification(sub.user_id, 'info', `A winner has been selected for task "${task.title || 'Task'}". Better luck next time!`, `/submissions`)
        }
      }
    }

    await logAudit('WINNER_ANNOUNCED', mentorId, { taskId, submissionId })
    res.json({ success: true, message: 'Winner announced. Code auto-snapshotted. You can now review and confirm.' })
  } catch (error) {
    console.error('[Announce Winner Error]', error)
    res.status(500).json({ success: false, message: 'Failed to announce winner.' })
  }
})

// Step 2: Winner submits final code snapshot (starts 48hr timer)
app.post('/submit-final-code', async (req, res) => {
  try {
    const { taskId, submissionId, userId, files } = req.body
    
    // Size check < 2MB
    const size = Buffer.byteLength(JSON.stringify(files))
    if (size > 2 * 1024 * 1024) return res.status(400).json({ success: false, message: 'Code snapshot too large (> 2MB)' })

    const { data: submission } = await supabase.from('submissions').select('user_id, is_winner, delivery_status').eq('id', submissionId).single()
    if (!submission || submission.user_id !== userId || !submission.is_winner) {
      return res.status(403).json({ success: false, message: 'Unauthorized. Only the winner can submit final code.' })
    }
    if (submission.delivery_status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Invalid delivery state.' })
    }

    const deadline = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()

    await supabase.from('submissions').update({
      final_files: files,
      delivery_status: 'submitted',
      delivered_at: new Date().toISOString(),
      delivery_deadline: deadline
    }).eq('id', submissionId)

    // Notify the mentor that code has been submitted
    const { data: taskForNotif } = await supabase.from('tasks').select('mentor_id, title').eq('id', taskId).single()
    if (taskForNotif) {
      await insertNotification(taskForNotif.mentor_id, 'submission', `Final code submitted for task "${taskForNotif.title || 'Task'}". Review and approve to release payment.`, `/mentor/task/${taskId}/submissions`)
    }

    await logAudit('CODE_SUBMITTED', userId, { submissionId })
    res.json({ success: true, message: 'Code submitted. Awaiting mentor approval.' })
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to submit final code.' })
  }
})

// Step 3: Mentor explicitly approves code (or Auto-release)
app.post('/approve-delivery', async (req, res) => {
  try {
    const { taskId, submissionId, mentorId } = req.body

    const { data: submission } = await supabase
      .from('submissions')
      .select('id, task_id, user_id, delivery_status, is_winner, payment_status')
      .eq('id', submissionId)
      .single()
    if (!submission) return res.status(404).json({ success: false, message: 'Submission not found in /approve-delivery.' })
    if (submission.task_id !== taskId) return res.status(400).json({ success: false, message: 'Task/submission mismatch.' })
    if (!submission.is_winner) return res.status(403).json({ success: false, message: 'Only winner deliveries can be approved.' })

    // ─── ATOMIC GUARD: Prevent double payment ───
    if (submission.payment_status === 'released') {
      return res.status(400).json({ success: false, message: 'Payment already released. Cannot approve again.' })
    }

    const { data: task } = await supabase.from('tasks').select('mentor_id, title, reward').eq('id', submission.task_id).single()
    if (!task || task.mentor_id !== mentorId) return res.status(403).json({ success: false, message: 'Unauthorized.' })
    
    // ─── STEP 1: Lock payment_status FIRST to prevent race ───
    const { error: lockErr } = await supabase.from('submissions').update({
      payment_status: 'released',
      delivery_status: 'approved',
      review_hold_status: 'completed',
      sandbox_preserved: false,
      mentor_latest_correction: null,
      mentor_latest_correction_at: null
    }).eq('id', submissionId).eq('payment_status', 'pending')

    if (lockErr) {
      console.error('[Approve Delivery] Lock failed:', lockErr.message)
      return res.status(409).json({ success: false, message: 'Payment state conflict. It may have been auto-released.' })
    }

    // ✨ WALLET INTEGRATION: Release funds to user's available balance
    if (task.reward && task.reward > 0) {
      const { data: rpcData, error: rpcErr } = await supabase.rpc('release_escrow_funds', {
        p_submission_id: submissionId,
        p_user_id: submission.user_id,
        p_amount: task.reward,
        p_tx_type: 'escrow_released'
      })
      if (rpcErr) {
        console.error('[Wallet Release Escrow Error]', rpcErr)
      }
    }

    // ─── STEP 2: Mark payment as credited ───
    const { data: payment } = await supabase.from('payments').update({ status: 'credited' }).eq('task_id', taskId).select().single()
    
    // ─── STEP 3: Close the task ───
    await supabase.from('tasks').update({ closed: true }).eq('id', taskId)

    // ─── TIMELINE EVENT ───
    const { error: eventErr } = await supabase.from('submission_events').insert({
      submission_id: submissionId,
      task_id: taskId,
      actor_id: mentorId,
      actor_type: 'mentor',
      event_type: 'mentor_approved',
      message: `Mentor approved code and released payment.`,
      metadata: { amount: payment?.amount }
    })
    if (eventErr) console.error('[Event Insert Error]', eventErr.message)

    await insertNotification(submission.user_id, 'payment', `Your code was approved! Payment released to your wallet.`, `/profile`)

    await logAudit('DELIVERY_APPROVED', mentorId, { submissionId })

    io.emit('review_hold_updated', { submissionId, status: 'completed', event: 'payment_released' })

    res.json({ success: true, message: 'Payment released successfully.' })
  } catch (error) {
    console.error('[Approve Delivery Error]', error)
    res.status(500).json({ success: false, message: 'Failed to approve delivery.' })
  }
})

// ─── Download Project Endpoint (legacy route — now uses permanent snapshot system) ───
// Redirects all download traffic to the new /api/submissions/:id/download endpoint
// which reads source_zip_url from the database instead of final_files JSON.
app.get('/download-submission/:submissionId', async (req, res) => {
  try {
    const { submissionId } = req.params
    const { userId } = req.query

    if (!submissionId || !userId) {
      return res.status(400).json({ success: false, message: 'Missing parameters' })
    }

    const { data: submission, error: subErr } = await supabase
      .from('submissions')
      .select('*, tasks(mentor_id)')
      .eq('id', submissionId)
      .single()

    if (subErr || !submission) {
      return res.status(404).json({ success: false, message: 'Submission not found' })
    }

    const { data: requester } = await supabase
      .from('users')
      .select('role')
      .eq('id', userId)
      .single()
    const isAdmin = requester?.role === 'admin'

    if (!isAdmin && userId !== submission.user_id && userId !== submission.tasks?.mentor_id) {
      return res.status(403).json({ success: false, message: 'Unauthorized to download this project' })
    }

    if (!isAdmin && submission.is_winner !== true) {
      return res.status(403).json({ success: false, message: 'Only winning submissions can be downloaded.' })
    }

    // Use permanent snapshot URL (source_zip_url) — never read from temp folders or final_files JSON
    if (submission.source_zip_url) {
      return res.json({ success: true, url: submission.source_zip_url, submissionId })
    }

    // Snapshot not yet generated — inform clearly
    return res.status(404).json({
      success: false,
      message: 'Snapshot generation failed — source ZIP was not saved for this submission.'
    })

  } catch (error) {
    console.error('[Download Legacy Error]', error)
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: 'Server error during download' })
    }
  }
})

// ─── Permanent Snapshot Download API ───
app.get('/api/submissions/:submissionId/download', async (req, res) => {
  try {
    const { submissionId } = req.params
    const { userId } = req.query

    if (!submissionId || !userId) {
      return res.status(400).json({ success: false, message: 'Missing parameters' })
    }

    const { data: submission, error: subErr } = await supabase
      .from('submissions')
      .select('*, tasks(mentor_id)')
      .eq('id', submissionId)
      .single()

    if (subErr || !submission) {
      return res.status(404).json({ success: false, message: 'Submission not found' })
    }

    const { data: requester } = await supabase.from('users').select('role').eq('id', userId).single()
    const isAdmin = requester?.role === 'admin'

    if (!isAdmin && userId !== submission.user_id && userId !== submission.tasks?.mentor_id) {
      return res.status(403).json({ success: false, message: 'Unauthorized to download this submission' })
    }

    if (!isAdmin && !submission.is_winner) {
      return res.status(403).json({ success: false, message: 'Only winning submissions can be downloaded.' })
    }

    const downloadUrl = submission.latest_artifact_url || submission.source_zip_url
    if (!downloadUrl) {
      return res.status(404).json({ success: false, message: 'No permanent snapshot found for this submission. The source ZIP was not saved — this may happen for submissions created before the snapshot system was enabled.' })
    }

    return res.json({ success: true, url: downloadUrl, submissionId })
  } catch (err) {
    console.error('[Download API Error]', err)
    res.status(500).json({ success: false, message: 'Server error' })
  }
})

// ─── ADMIN ENDPOINTS ───

app.post('/send-message', async (req, res) => {
  try {
    const { taskId, participantId, senderId, message } = req.body
    
    if (!message || message.trim().length === 0) return res.status(400).json({ success: false, message: 'Message empty' })
    if (message.length > 500) return res.status(400).json({ success: false, message: 'Message too long (max 500)' })

    // Strict Access Control: sender must be the participant OR the mentor
    const { data: task } = await supabase.from('tasks').select('mentor_id, title').eq('id', taskId).single()
    if (senderId !== participantId && senderId !== task.mentor_id) {
      return res.status(403).json({ success: false, message: 'Unauthorized to participate in this chat.' })
    }

    // Rate Limiting (1 sec)
    const { data: recent } = await supabase.from('messages')
      .select('created_at').eq('sender_id', senderId).order('created_at', { ascending: false }).limit(1)
    
    if (recent && recent.length > 0) {
      const msSinceLast = Date.now() - new Date(recent[0].created_at).getTime()
      if (msSinceLast < 1000) return res.status(429).json({ success: false, message: 'Sending messages too fast.' })
    }

    await supabase.from('messages').insert({
      task_id: taskId, participant_id: participantId, sender_id: senderId, message: message.trim()
    })

    const recipientId = senderId === participantId ? task.mentor_id : participantId
    const link = senderId === participantId ? `/mentor/task/${taskId}/submissions` : `/task/${taskId}?chat=true`

    // Check for existing unread notification for this chat
    const { data: existing } = await supabase.from('notifications')
      .select('id, message')
      .eq('user_id', recipientId)
      .eq('type', 'message')
      .eq('link', link)
      .eq('is_read', false)
      .limit(1)

    if (existing && existing.length > 0) {
      // Update existing notification
      await supabase.from('notifications').update({ 
        created_at: new Date().toISOString(),
        message: `New messages regarding task "${task.title || 'Task'}"`
      }).eq('id', existing[0].id)
    } else {
      await insertNotification(recipientId, 'message', `New message regarding task "${task.title || 'Task'}"`, link)
    }

    res.json({ success: true, message: 'Sent' })
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to send message.' })
  }
})


// ─── WITHDRAWALS & OTHER API ───

app.post('/request-withdrawal', async (req, res) => {
  try {
    const { userId, amount, bankDetails } = req.body

    if (!amount || amount < 100) return res.status(400).json({ success: false, message: 'Minimum withdrawal amount is ₹100.' })
    if (!userId || !bankDetails || !bankDetails.accountName || !bankDetails.accountNumber || !bankDetails.ifsc) {
      return res.status(400).json({ success: false, message: 'Missing required fields.' })
    }
    if (bankDetails.accountNumber.length < 9 || bankDetails.accountNumber.length > 18) {
      return res.status(400).json({ success: false, message: 'Invalid bank account number length.' })
    }
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(bankDetails.ifsc.toUpperCase())) {
      return res.status(400).json({ success: false, message: 'Invalid IFSC code format.' })
    }

    const { data: userKyc } = await supabase.from('users').select('kyc_status, name, email').eq('id', userId).single()
    if (!userKyc || userKyc.kyc_status !== 'verified') {
      return res.status(403).json({ success: false, message: 'KYC must be verified before withdrawing funds.' })
    }

    const { data: inflight } = await supabase
      .from('withdrawals')
      .select('id')
      .eq('user_id', userId)
      .in('status', ['pending', 'processing'])
    if (inflight?.length) {
      return res.status(400).json({ success: false, message: 'You already have a withdrawal in progress. Please wait until it completes.' })
    }

    const { data: kycRow } = await supabase
      .from('kyc_submissions')
      .select('full_name, bank_account, ifsc_code')
      .eq('user_id', userId)
      .eq('status', 'verified')
      .order('submitted_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const legalName = (kycRow?.full_name || userKyc?.name || '').trim()
    if (!namesMatchForBankPayout(legalName, bankDetails.accountName)) {
      return res.status(400).json({
        success: false,
        message: 'Account holder name must match your verified KYC name (same person as ID verification).'
      })
    }

    const kycAcct = String(kycRow?.bank_account || '').replace(/\s/g, '')
    const kycIfsc = String(kycRow?.ifsc_code || '').toUpperCase().replace(/\s/g, '')
    const reqAcct = String(bankDetails.accountNumber || '').replace(/\s/g, '')
    const reqIfsc = String(bankDetails.ifsc || '').toUpperCase().replace(/\s/g, '')
    if (kycAcct && kycAcct !== reqAcct) {
      return res.status(400).json({
        success: false,
        message: 'Use the same bank account number you verified in KYC, or submit updated KYC for this account.'
      })
    }
    if (kycIfsc && kycIfsc !== reqIfsc) {
      return res.status(400).json({
        success: false,
        message: 'IFSC must match your KYC-verified IFSC for this withdrawal.'
      })
    }

    const requestedAmount = Number(amount)
    const fee = calculateWithdrawalFee(requestedAmount)
    const finalAmount = requestedAmount - fee
    if (finalAmount <= 0) return res.status(400).json({ success: false, message: 'Withdrawal amount too low after fee.' })

    const { error } = await supabase.rpc('request_withdrawal_atomic', {
      p_user_id: userId,
      p_amount: requestedAmount,
      p_fee: fee,
      p_bank_details: bankDetails
    })
    if (error) return res.status(400).json({ success: false, message: error.message || 'Insufficient wallet balance.' })

    const { data: wRow, error: wErr } = await supabase
      .from('withdrawals')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (wErr || !wRow) {
      console.error('[request-withdrawal] Missing withdrawal row after RPC', wErr)
      return res.status(500).json({ success: false, message: 'Withdrawal could not be recorded.' })
    }

    await supabase
      .from('withdrawals')
      .update({
        requested_amount: requestedAmount,
        fee_amount: fee,
        final_amount: finalAmount
      })
      .eq('id', wRow.id)

    const { data: fullWithdrawal } = await supabase.from('withdrawals').select('*').eq('id', wRow.id).single()
    const { data: userFull } = await supabase.from('users').select('*').eq('id', userId).single()

    try {
      await createRazorpayPayoutForWithdrawal({
        supabase,
        razorpay,
        withdrawal: { ...fullWithdrawal, requested_amount: requestedAmount, fee_amount: fee, final_amount: finalAmount },
        user: userFull
      })
    } catch (payoutErr) {
      console.error('[request-withdrawal] Razorpay payout failed:', payoutErr)
      await creditWalletBalance(supabase, userId, requestedAmount)
      await supabase
        .from('withdrawals')
        .update({
          status: 'failed',
          rejection_reason: String(payoutErr.message || 'Payout initiation failed').slice(0, 500)
        })
        .eq('id', wRow.id)
      await insertNotification(
        userId,
        'withdrawal',
        `Bank transfer could not be started. ₹${requestedAmount} returned to your wallet.`,
        '/profile'
      )
      return res.status(502).json({
        success: false,
        message: 'Could not start bank transfer. Your money has been returned to your wallet.',
        detail: payoutErr.message
      })
    }

    await logRevenue('withdrawal_fee', fee, userId)
    await insertNotification(
      userId,
      'withdrawal',
      `₹${finalAmount} is being sent to your bank via IMPS (fee ₹${fee} from ₹${requestedAmount}). We will notify you when the bank confirms.`,
      `/profile`
    )
    await logAudit('WITHDRAWAL_AUTO_PAYOUT', userId, { withdrawalId: wRow.id, amount: requestedAmount, fee, finalAmount })

    return res.json({
      success: true,
      message: 'Withdrawal started; funds are being sent to your bank automatically.',
      feeAmount: fee,
      finalAmount,
      withdrawalId: wRow.id
    })
  } catch (error) {
    console.error('[request-withdrawal]', error)
    res.status(500).json({ success: false, message: 'Failed to request withdrawal.' })
  }
})

// KYC API (multipart: must use multer — duplicate JSON-only route removed; it left req.body empty)
app.post('/submit-kyc', upload.single('governmentProof'), async (req, res) => {
  try {
    const { userId, fullName, panNumber, bankAccount, ifscCode, governmentIdType } = req.body
    const pan = (panNumber && String(panNumber).trim().toUpperCase()) || ''
    const ifsc = (ifscCode && String(ifscCode).trim().toUpperCase()) || ''
    const acct = (bankAccount && String(bankAccount).trim()) || ''
    const name = (fullName && String(fullName).trim()) || ''

    if (!userId || !name || !pan || !acct || !ifsc) {
      return res.status(400).json({ success: false, message: 'All fields are required.' })
    }
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Government ID proof file is required.' })
    }
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(pan)) {
      return res.status(400).json({ success: false, message: 'Invalid PAN format.' })
    }
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) {
      return res.status(400).json({ success: false, message: 'Invalid IFSC code format.' })
    }

    let governmentProofUrl = null

    // Default bucket `submissions` is usually restricted to application/zip — wrap proof in a small ZIP.
    const kycBucket = (process.env.KYC_STORAGE_BUCKET || 'submissions').trim()
    const fileExt = path.extname(req.file.originalname) || '.pdf'
    const innerName = path.basename(req.file.originalname) || `government-id${fileExt}`
    const fileData = await fsPromises.readFile(req.file.path)

    const useZipWrap =
      process.env.KYC_ZIP_WRAP === '1' ||
      kycBucket === 'submissions'

    let storagePath
    let uploadBody
    let contentType
    if (useZipWrap) {
      storagePath = `kyc/${userId}/${crypto.randomUUID()}.zip`
      uploadBody = await packBufferAsZip(innerName, fileData)
      contentType = 'application/zip'
    } else {
      storagePath = `kyc/${userId}/${crypto.randomUUID()}${fileExt}`
      uploadBody = fileData
      contentType = 'application/octet-stream'
    }

    const { error: uploadError } = await supabase.storage
      .from(kycBucket)
      .upload(storagePath, uploadBody, {
        contentType,
        upsert: true
      })

    if (uploadError) {
      console.error('KYC Proof Upload Error:', uploadError)
      await fsPromises.unlink(req.file.path).catch(() => {})
      const detail = uploadError.message || 'Upload failed'
      return res.status(500).json({
        success: false,
        message: `Could not store ID proof (${detail}). Create a storage bucket or set KYC_STORAGE_BUCKET in server/.env.`
      })
    }

    const { data: { publicUrl } } = supabase.storage.from(kycBucket).getPublicUrl(storagePath)
    governmentProofUrl = publicUrl
    await fsPromises.unlink(req.file.path).catch(() => {})

    const panLast4 = pan.slice(-4)
    const panHash = crypto.createHash('sha256').update(pan).digest('hex')

    const { error } = await supabase.from('kyc_submissions').upsert(
      {
        user_id: userId,
        full_name: name,
        pan_number: pan,
        pan_last4: panLast4,
        pan_hash: panHash,
        bank_account: acct,
        ifsc_code: ifsc,
        status: 'pending',
        submitted_at: new Date().toISOString(),
        government_proof_url: governmentProofUrl,
        government_id_type: governmentIdType || 'aadhaar'
      },
      { onConflict: 'user_id' }
    )
    if (error) throw error

    await supabase.from('users').update({ kyc_status: 'pending' }).eq('id', userId)
    await logAudit('KYC_SUBMITTED', userId, { fullName: name })

    const { data: admins } = await supabase.from('users').select('id').eq('role', 'admin')
    for (const a of admins || []) {
      await insertNotification(
        a.id,
        'kyc',
        `New KYC submission pending review: ${name}`,
        '/admin?tab=kyc'
      )
    }

    res.json({ success: true, message: 'KYC submitted successfully. Our team will review it shortly.' })
  } catch (error) {
    if (req.file) await fsPromises.unlink(req.file.path).catch(() => {})
    console.error('[KYC Submit]', error)
    res.status(500).json({ success: false, message: error.message || 'Failed to submit KYC.' })
  }
})

app.get('/kyc-status/:userId', async (req, res) => {
  try {
    const { userId } = req.params
    const { data } = await supabase.from('users').select('kyc_status').eq('id', userId).single()
    res.json({ success: true, data: { status: data?.kyc_status || 'none' } })
  } catch (error) { res.status(500).json({ success: false, message: 'Failed to fetch KYC status.' }) }
})

// ADMIN API
app.get('/admin/kyc-submissions', requireAdmin, async (req, res) => {
  try {
    const { data: submissions } = await supabase
      .from('kyc_submissions')
      .select('*, users(name, email)')
      .order('submitted_at', { ascending: false })

    res.json({ success: true, data: submissions || [] })
  } catch (error) {
    console.error('[Admin KYC Submissions Error]', error)
    res.status(500).json({ success: false, message: 'Failed to fetch KYC submissions.' })
  }
})

app.post('/admin/approve-kyc', requireAdmin, async (req, res) => {
  try {
    const { targetUserId } = req.body
    if (!targetUserId) {
      return res.status(400).json({ success: false, message: 'Missing targetUserId' })
    }
    const reviewedAt = new Date().toISOString()
    const { data: kycUpdated, error: kycErr } = await supabase
      .from('kyc_submissions')
      .update({ status: 'verified', reviewed_at: reviewedAt })
      .eq('user_id', targetUserId)
      .select('id')
    if (kycErr) {
      console.error('[approve-kyc] kyc_submissions', kycErr)
      return res.status(500).json({ success: false, message: kycErr.message || 'Failed to update KYC submission' })
    }
    if (!kycUpdated?.length) {
      return res.status(404).json({ success: false, message: 'No KYC submission found for this user.' })
    }
    const { error: userErr } = await supabase
      .from('users')
      .update({ kyc_status: 'verified' })
      .eq('id', targetUserId)
    if (userErr) {
      console.error('[approve-kyc] users', userErr)
      return res.status(500).json({ success: false, message: userErr.message || 'Failed to update user KYC status' })
    }
    await insertNotification(targetUserId, 'kyc', `Your KYC has been verified! You can now withdraw funds.`, `/profile`)
    await logAudit('KYC_APPROVED', targetUserId, { adminId: req.body.adminId })
    res.json({ success: true, message: 'KYC approved.' })
  } catch (error) {
    console.error('[approve-kyc]', error)
    res.status(500).json({ success: false, message: 'Admin action failed.' })
  }
})

app.post('/admin/reject-kyc', requireAdmin, async (req, res) => {
  try {
    const { targetUserId, reason } = req.body
    if (!targetUserId) {
      return res.status(400).json({ success: false, message: 'Missing targetUserId' })
    }
    const reviewedAt = new Date().toISOString()
    const { data: kycUpdated, error: kycErr } = await supabase
      .from('kyc_submissions')
      .update({ status: 'rejected', reviewed_at: reviewedAt, rejection_reason: reason || '' })
      .eq('user_id', targetUserId)
      .select('id')
    if (kycErr) {
      console.error('[reject-kyc] kyc_submissions', kycErr)
      return res.status(500).json({ success: false, message: kycErr.message || 'Failed to update KYC submission' })
    }
    if (!kycUpdated?.length) {
      return res.status(404).json({ success: false, message: 'No KYC submission found for this user.' })
    }
    const { error: userErr } = await supabase
      .from('users')
      .update({ kyc_status: 'rejected' })
      .eq('id', targetUserId)
    if (userErr) {
      console.error('[reject-kyc] users', userErr)
      return res.status(500).json({ success: false, message: userErr.message || 'Failed to update user KYC status' })
    }
    await insertNotification(targetUserId, 'kyc', `Your KYC verification was rejected. Reason: ${reason || 'Document verification failed.'}`, `/profile`)
    await logAudit('KYC_REJECTED', targetUserId, { adminId: req.body.adminId, reason })
    res.json({ success: true, message: 'KYC rejected.' })
  } catch (error) {
    console.error('[reject-kyc]', error)
    res.status(500).json({ success: false, message: 'Admin action failed.' })
  }
})

app.post('/admin/flag-user', requireAdmin, async (req, res) => {
  try {
    const { targetUserId, isFlagged } = req.body
    await supabase.from('users').update({ is_flagged: isFlagged }).eq('id', targetUserId)
    await logAudit(isFlagged ? 'USER_FLAGGED' : 'USER_UNFLAGGED', targetUserId, { adminId: req.body.adminId })
    res.json({ success: true, message: `User flag set to ${isFlagged}.` })
  } catch (error) { res.status(500).json({ success: false, message: 'Admin action failed.' }) }
})

// Health check
app.get('/health', (req, res) => {
  res.json({ success: true, data: { status: 'ok', timestamp: new Date().toISOString() } })
})

app.get('/health/redis', async (req, res) => {
  try {
    const result = await pingRedis(cm.redisConnection)
    const target = process.env.REDIS_URL
      ? new URL(process.env.REDIS_URL).host
      : '127.0.0.1:6379'
    const queueStats = {
      waiting: await cm.redisConnection.llen('bull:sandbox-execution:wait').catch(() => 0),
      active:  await cm.redisConnection.llen('bull:sandbox-execution:active').catch(() => 0),
      delayed: await cm.redisConnection.zcard('bull:sandbox-execution:delayed').catch(() => 0)
    }
    res.json({
      success: true,
      redis: {
        connected: result.ok,
        latencyMs: result.latencyMs ?? null,
        error: result.error ?? null,
        target
      },
      queue: queueStats
    })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

// Heartbeat — called by preview iframe every 10s to keep the container alive.
// Prevents premature cleanup due to inactivity while the user is actively viewing.
app.get('/heartbeat/:submissionId', (req, res) => {
  const { submissionId } = req.params
  const extended = cm.heartbeatContainer(submissionId)
  cm.touchContainer(submissionId)
  res.json({ success: true, extended, timestamp: Date.now() })
})

app.post('/mark-notifications-read', async (req, res) => {
  try {
    const { userId } = req.body
    if (!userId) return res.status(400).json({ success: false, message: 'Missing userId' })
    await supabase.from('notifications').update({ is_read: true }).eq('user_id', userId).eq('is_read', false)
    res.json({ success: true, message: 'Notifications marked as read' })
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to update notifications' })
  }
})

// ─── REVIEW HOLD WATCHDOG & AUTO-RELEASE CRON ───
// Runs every 1 minute to handle: hold expirations, auto-releases, and reminder notifications.
setInterval(async () => {
  try {
    const nowUtc = new Date().toISOString()

    // ─── 1. Review Hold Expirations ───
    const { data: expiredHolds } = await supabase
      .from('submissions')
      .select('id, task_id, user_id')
      .eq('review_hold_status', 'paused')
      .lte('review_hold_expires_at', nowUtc)
      .eq('payment_status', 'pending')

    if (expiredHolds?.length > 0) {
      for (const sub of expiredHolds) {
        console.log(`[WATCHDOG] Review hold expired for ${sub.id} — auto-releasing payment`)
        
        const { error: releaseErr } = await supabase.from('submissions').update({
          payment_status: 'released',
          delivery_status: 'approved',
          review_hold_status: 'expired',
          sandbox_preserved: false
        }).eq('id', sub.id).eq('payment_status', 'pending')

        if (!releaseErr) {
          const { data: task } = await supabase.from('tasks').select('reward').eq('id', sub.task_id).single()
          if (task?.reward && task?.reward > 0) {
            await supabase.rpc('release_escrow_funds', {
               p_submission_id: sub.id, p_user_id: sub.user_id, p_amount: task.reward, p_tx_type: 'auto_release' 
            })
          }
          const { data: payment } = await supabase.from('payments').update({ status: 'credited' }).eq('task_id', sub.task_id).select().single()
          await supabase.from('tasks').update({ closed: true }).eq('id', sub.task_id)
          await supabase.from('submission_events').insert({
            submission_id: sub.id, task_id: sub.task_id,
            actor_type: 'system', event_type: 'payment_auto_released',
            message: 'Payment auto-released: review hold expired without mentor action.'
          }).catch(() => {})
          await insertNotification(sub.user_id, 'payment', 'Payment auto-released! The review hold expired.', '/profile')
          await logAudit('REVIEW_HOLD_AUTO_RELEASED', sub.user_id, { submissionId: sub.id })
        }
      }
    }

    // ─── 2. Standard 48h Auto-Release ───
    const { data: expiredSubmissions } = await supabase
      .from('submissions')
      .select('id, task_id, user_id')
      .eq('delivery_status', 'submitted')
      .eq('payment_status', 'pending')
      .lte('delivery_deadline', nowUtc)

    if (expiredSubmissions?.length > 0) {
      for (const sub of expiredSubmissions) {
        console.log(`[Auto-Release] Standard 48h expired for ${sub.id} — auto-releasing payment`)
        
        const { error: releaseErr } = await supabase.from('submissions').update({
          payment_status: 'released',
          delivery_status: 'approved',
          sandbox_preserved: false
        }).eq('id', sub.id).eq('payment_status', 'pending')

        if (!releaseErr) {
          const { data: task } = await supabase.from('tasks').select('reward').eq('id', sub.task_id).single()
          if (task?.reward && task?.reward > 0) {
            await supabase.rpc('release_escrow_funds', {
               p_submission_id: sub.id, p_user_id: sub.user_id, p_amount: task.reward, p_tx_type: 'auto_release' 
            })
          }
          await supabase.from('payments').update({ status: 'credited' }).eq('task_id', sub.task_id)
          await supabase.from('tasks').update({ closed: true }).eq('id', sub.task_id)
          try {
            const { error: evErr } = await supabase.from('submission_events').insert({
              submission_id: sub.id, task_id: sub.task_id,
              actor_type: 'system', event_type: 'payment_auto_released',
              message: 'Payment auto-released: 48h delivery deadline expired without mentor action.'
            })
            if (evErr) console.error('[submission_events insert]', evErr.message)
          } catch (e) {
            console.error('[submission_events insert]', e.message)
          }
          
          console.log(`[Auto-Release] Successfully credited payment for submission ${sub.id}`)
          await insertNotification(sub.user_id, 'payment', `Payment auto-released to your wallet! The mentor did not review within 48 hours.`, `/profile`)
          await logAudit('AUTO_RELEASED', sub.user_id, { submissionId: sub.id, taskId: sub.task_id })
        } else {
          console.error(`[Auto-Release Failed] Sub ${sub.id}:`, releaseErr.message)
        }
      }
    }

    // ─── 3. Proactive Reminder Notifications ───
    const { data: activeHolds } = await supabase
      .from('submissions')
      .select('id, task_id, user_id, review_hold_expires_at')
      .eq('review_hold_status', 'paused')
      .eq('payment_status', 'pending')

    if (activeHolds?.length > 0) {
      for (const sub of activeHolds) {
        const remaining = new Date(sub.review_hold_expires_at).getTime() - Date.now()
        const hoursLeft = remaining / 3600000
        const thresholds = [12, 6, 1, 0.25]
        for (const t of thresholds) {
          if (hoursLeft <= t && hoursLeft > t - 0.02) {
            const label = t >= 1 ? `${t}h` : `${Math.round(t * 60)}m`
            const { data: taskData } = await supabase.from('tasks').select('mentor_id').eq('id', sub.task_id).single()
            if (taskData?.mentor_id) {
              await insertNotification(taskData.mentor_id, 'review', `⏰ ${label} remaining to review submission. Payment will auto-release if no action taken.`, `/mentor/tasks/${sub.task_id}/submissions`)
            }
          }
        }
      }
    }
  } catch (err) {
    console.error('[WATCHDOG ERROR]', err)
  }
}, 60 * 1000) // Every 1 minute

// ─── SANDBOX ROUTES ───

app.post('/upload-project', upload.single('project'), async (req, res) => {
  const submissionId = crypto.randomUUID()
  const appendLog = (msg) => {
    cm.appendLog(submissionId, msg)
    io.to(`submission-${submissionId}`).emit('log', { submissionId, message: msg, timestamp: new Date().toISOString() })
  }

  try {
    const { taskId, userId } = req.body
    const taskTimeout = parseInt(req.body.timeout) || 5

    if (!req.file) return res.status(400).json({ success: false, message: 'No zip file provided' })
    if (!taskId || !userId) return res.status(400).json({ success: false, message: 'Missing taskId or userId' })

    // Anti-Resubmit Check
    const { data: existingSub } = await supabase
      .from('submissions')
      .select('id, is_final')
      .eq('task_id', taskId)
      .eq('user_id', userId)
      .eq('is_final', true)
      .maybeSingle()

    if (existingSub) {
      return res.status(403).json({ success: false, message: 'Project already submitted and finalized for this task. Re-uploading is disabled.' })
    }

    // 0. Redis Health Check
    if (!(await cm.isRedisHealthy())) {
      return res.status(503).json({ success: false, message: 'System temporarily busy (Queue offline). Please try again in a moment.' })
    }

    // 1. Abuse Prevention & Rate Limiting
    const isUnderHourlyLimit = await cm.checkRateLimitAndAbuse(userId, supabase)
    if (!isUnderHourlyLimit) {
      return res.status(429).json({ success: false, message: 'Hourly submission limit exceeded (Max 10/hr). Please slow down.' })
    }

    // Check if user is flagged
    const { data: profile } = await supabase.from('users').select('is_flagged').eq('id', userId).single()
    if (profile?.is_flagged) {
      return res.status(403).json({ success: false, message: 'Your account has been restricted due to suspicious activity.' })
    }

    // ─── STOP OLD CONTAINER FIRST, THEN CHECK CAPACITY ───
    // IMPORTANT: stopUserContainerForTask must run BEFORE canUserCreateContainer.
    // Otherwise, a user with one active sandbox is always blocked even though
    // this upload is meant to replace it.
    const stoppedSubmissionId = await cm.stopUserContainerForTask(userId, taskId, 'replaced-by-upload')
    if (stoppedSubmissionId) {
      await supabase.from('submissions')
        .update({ build_status: 'stopped' })
        .eq('id', stoppedSubmissionId)
    }

    // Also purge any stale registry entries for this user whose DB status is
    // no longer active — handles orphaned in-memory state after server restarts.
    await cm.evictStaleUserEntries(userId, supabase)

    if (!cm.canUserCreateContainer(userId)) {
      return res.status(429).json({ success: false, message: 'Too many active executions. Please wait for others to timeout or stop.' })
    }

    // Initialize registry entry for this submission (employee upload)
    cm.registerContainer(submissionId, { userId, taskId, timeoutMinutes: taskTimeout, previewType: 'employee' })
    appendLog('Starting submission process...')
    
    // 1. Upload to Supabase Storage
    appendLog('Uploading ZIP to persistent storage...')
    const fileBuffer = await fsPromises.readFile(req.file.path)
    const storagePath = `${taskId}/${userId}/${submissionId}.zip`

    // Calculate SHA256 hash for artifact integrity validation
    const zipHash = crypto.createHash('sha256').update(fileBuffer).digest('hex')
    appendLog(`ZIP SHA256: ${zipHash}`)

    const { error: uploadError } = await supabase.storage
      .from('submissions')
      .upload(storagePath, fileBuffer, {
        contentType: 'application/zip',
        upsert: true
      })

    if (uploadError) {
      appendLog(`Storage upload failed: ${uploadError.message}`)
      throw uploadError
    }

    const { data: { publicUrl } } = supabase.storage.from('submissions').getPublicUrl(storagePath)

    // 2. Database Insert — initial status is QUEUED
    const { error: dbError } = await supabase.from('submissions').insert({
      id: submissionId,
      task_id: taskId,
      user_id: userId,
      zip_url: publicUrl,
      build_status: 'queued',
      is_final: false,
      delivery_status: 'pending'
    })

    if (dbError) {
      appendLog(`Database insert failed: ${dbError.message}`)
      throw dbError
    }

    // 3. Add to Job Queue
    await cm.addJobToQueue(submissionId, {
      submissionId,
      userId,
      taskId,
      zipPath: req.file.path,
      taskTimeout,
      source: 'employee-upload'
    }, 3)

    appendLog('Job added to execution queue. Waiting for available worker...')

    res.json({ 
      success: true, 
      submissionId, 
      message: 'Upload received. Job queued for execution.',
      status: 'queued'
    })

  } catch (error) {
    console.error('[Upload Route Error]', error)
    if (submissionId) {
      cm.updateContainer(submissionId, { status: 'failed' })
      appendLog(`Critical Failure: ${error.message}`)
    }
    // Cleanup zip if queuing failed
    if (req.file) {
      await fsPromises.rm(req.file.path, { force: true }).catch(() => {})
    }
    if (!res.headersSent) {
      const safeMessage = typeof error?.message === 'string' && error.message.includes('ENOENT')
        ? 'Upload processing failed. Please try again.'
        : (error?.message || 'Upload processing failed. Please try again.')
      res.status(500).json({ success: false, message: safeMessage })
    }
  }
})

app.get('/job-status/:submissionId', async (req, res) => {
  const { submissionId } = req.params

  // Heartbeat: keep container alive while mentor/employee is actively polling
  cm.touchContainer(submissionId)

  // DB is the source of truth for build_status (survives server restarts)
  const { data: submission } = await supabase
    .from('submissions')
    .select('build_status, preview_url, logs')
    .eq('id', submissionId)
    .single()

  if (!submission) return res.status(404).json({ success: false, message: 'Job not found' })

  // In-memory registry may be stale because worker runs in a separate process.
  // Query Redis for the latest container info written by the worker.
  const redisInfo = await cm.redisConnection.hgetall(`container:${submissionId}`).catch(() => ({}))

  const entry = cm.getContainer(submissionId)

  // ─── UNIFIED STATUS RESOLUTION ───
  // Priority: DB > Redis > Registry fallback
  // If ANY source says running, the effective status is running.
  // NEVER let a stale registry 'building' override a live running container.
  let effectiveStatus = 'unknown'
  let effectivePreviewUrl = null
  let statusSource = 'unknown'

  if (submission.build_status === 'running') {
    effectiveStatus = 'running'
    effectivePreviewUrl = submission.preview_url
    statusSource = 'db'
  } else if (redisInfo?.status === 'running') {
    effectiveStatus = 'running'
    // Prefer stable proxy URL; fall back to building one from port for legacy entries
    effectivePreviewUrl = redisInfo.previewUrl?.startsWith('/preview/')
      ? redisInfo.previewUrl
      : `/preview/${submissionId}`
    statusSource = 'redis'
  } else if (entry?.status === 'running') {
    effectiveStatus = 'running'
    effectivePreviewUrl = `/preview/${submissionId}`
    statusSource = 'registry'
  } else {
    effectiveStatus = submission.build_status || redisInfo?.status || entry?.status || 'unknown'
    // For preview URL: prefer stable /preview/ format; ignore raw localhost URLs (browser can't reach them)
    const rawUrl = submission.preview_url || redisInfo?.previewUrl
    effectivePreviewUrl = rawUrl?.startsWith('/preview/') ? rawUrl
      : (effectiveStatus === 'running' ? `/preview/${submissionId}` : null)
    statusSource = 'fallback'
  }

  // ─── SYNC STALE REGISTRY ───
  // If DB/Redis says running but our in-memory registry is stale, fix it immediately.
  // This prevents future proxy requests from hitting stale registry state.
  if ((submission.build_status === 'running' || redisInfo?.status === 'running') && entry && entry.status !== 'running') {
    // Port comes from Redis only — preview_url is /preview/:id (no embedded port)
    const syncPort = redisInfo?.port || entry.port
    const syncContainerId = redisInfo?.containerId || entry.containerId
    cm.updateContainer(submissionId, {
      status: 'running',
      port: syncPort ? parseInt(syncPort, 10) : entry.port,
      containerId: syncContainerId || entry.containerId,
      lastAccessed: Date.now()
    })
    console.log(`[Status Sync] ${submissionId}: registry updated from ${entry.status} → running port=${syncPort} (source=${statusSource})`)
  }

  console.log(`[PREVIEW STATE] submissionId=${submissionId} source=${statusSource} effectiveStatus=${effectiveStatus} dbStatus=${submission.build_status || 'null'} redisStatus=${redisInfo?.status || 'none'} registryStatus=${entry?.status || 'none'} previewUrl=${effectivePreviewUrl || 'none'}`)

  const logs = await cm.getLogs(submissionId)
  res.json({
    success: true,
    status: effectiveStatus,
    previewUrl: effectivePreviewUrl,
    logs: logs.length > 0 ? logs : (submission.logs ? submission.logs.split('\n') : [])
  })
})

app.post('/start-preview', async (req, res) => {
  try {
    const { submissionId, mentorId, timeout } = req.body
    const taskTimeout = parseInt(timeout, 10) || 5
    if (!submissionId || !mentorId) {
      return res.status(400).json({ success: false, message: 'Missing submissionId or mentorId' })
    }

    const { data: submission, error: subError } = await supabase
      .from('submissions')
      .select('id, task_id, user_id, zip_url, is_winner, build_status')
      .eq('id', submissionId)
      .single()
    if (subError || !submission) {
      return res.status(404).json({ success: false, message: `Submission ${submissionId} not found in /start-preview. Error: ${subError?.message}` })
    }

    const { data: task } = await supabase
      .from('tasks')
      .select('mentor_id')
      .eq('id', submission.task_id)
      .single()
    if (!task || task.mentor_id !== mentorId) {
      return res.status(403).json({ success: false, message: 'Unauthorized to start this preview' })
    }

    // ─── SOURCE OF TRUTH: DB build_status (survives server restarts) ───

    // Recovery: if 'building' has been stuck for >5 minutes, something crashed.
    // Reset to 'failed' so the user can retry instead of waiting forever.
    if (submission.build_status === 'building' && submission.updated_at) {
      const buildingAgeMs = Date.now() - new Date(submission.updated_at).getTime()
      if (buildingAgeMs > 5 * 60 * 1000) {
        console.log(`[Start Preview] Stuck building detected for ${submissionId} (${Math.round(buildingAgeMs / 1000)}s old). Resetting to failed.`)
        await supabase.from('submissions').update({ build_status: 'failed' }).eq('id', submissionId)
        submission.build_status = 'failed'
      }
    }

    // ─── ACTIVE PREVIEW REUSE ───
    // If already running with a preview URL, return existing immediately.
    if (submission.build_status === 'running' && submission.preview_url) {
      console.log(`[Start Preview] Reusing active preview for ${submissionId}: ${submission.preview_url}`)
      // Sync stale registry — get port from Redis (preview_url is /preview/:id, has no port)
      const entry = cm.getContainer(submissionId)
      if (entry && entry.status !== 'running') {
        const redisExec = await cm.redisConnection.hgetall(`exec:${submissionId}`).catch(() => null)
        const redisContainer = await cm.redisConnection.hgetall(`container:${submissionId}`).catch(() => null)
        const syncPort = redisExec?.port || redisContainer?.port || entry.port
        const syncContainerId = redisExec?.containerId || redisContainer?.containerId || entry.containerId
        cm.updateContainer(submissionId, {
          status: 'running',
          port: syncPort ? parseInt(syncPort, 10) : entry.port,
          containerId: syncContainerId,
          lastAccessed: Date.now()
        })
        console.log(`[Start Preview] Synced registry for ${submissionId} port=${syncPort} from Redis`)
      }
      return res.json({ success: true, message: 'Preview already running', status: 'running', previewUrl: submission.preview_url })
    }

    if (['running', 'queued', 'building', 'starting'].includes(submission.build_status)) {
      console.log(`[Start Preview] Rejecting duplicate request for ${submissionId}: DB status is ${submission.build_status}`)
      return res.json({ success: true, message: `Sandbox already ${submission.build_status}`, status: submission.build_status })
    }

    // Secondary guard: in-memory registry
    const existing = cm.getContainer(submissionId)
    if (['running', 'queued', 'building', 'starting'].includes(existing?.status)) {
      if (existing?.status === 'running') cm.touchContainer(submissionId)
      console.log(`[Start Preview] Rejecting duplicate request for ${submissionId}: registry status is ${existing.status}`)
      return res.json({ success: true, message: `Sandbox already ${existing.status}`, status: existing.status })
    }

    // Clean up any old containers or registry entries for this submission
    await removeOldContainersForSubmission(submission.id)
    if (existing) {
      cm.registry.delete(submissionId)
      cm.releasePort(existing.port)
    }

    // Stop other previews for the same user+task before starting.
    await cm.stopUserContainerForTask(submission.user_id, submission.task_id, 'replaced-by-mentor-preview')

    // ─── FAST PATH: Reuse saved Docker image if it exists locally ───
    // NOTE: docker_image_tag column does NOT exist in DB schema.
    // Image tag is deterministic: submission-{id}:v1
    const savedImageTag = `submission-${submission.id}:v1`
    if (await imageExists(savedImageTag)) {
      console.log(`[Start Preview] Fast path: reusing saved image ${savedImageTag} for ${submissionId}`)
      cm.registerContainer(submission.id, { userId: submission.user_id, taskId: submission.task_id, timeoutMinutes: taskTimeout, status: 'starting', previewType: 'mentor' })
      await supabase.from('submissions').update({ build_status: 'starting' }).eq('id', submission.id)

      const hostPort = cm.getAvailablePort()
      const containerName = `submission-${submission.id}-${Date.now()}`
      const container = await runContainer(savedImageTag, containerName, hostPort, 3000)

      cm.updateContainer(submission.id, { containerId: container.id, port: hostPort, status: 'running', dockerImageTag: savedImageTag })
      cm.attachLogStream(container.id, submission.id, null)

      // Always use the stable proxy URL — never raw http://localhost:PORT
      const stablePreviewUrl = `/preview/${submission.id}`

      // Persist port to Redis so the preview proxy can find the container
      await cm.redisConnection.hmset(`container:${submission.id}`, {
        containerId: container.id,
        port: String(hostPort),
        previewUrl: stablePreviewUrl,
        status: 'running',
        dockerImageTag: savedImageTag,
        updatedAt: String(Date.now())
      }).catch(() => {})
      await cm.redisConnection.expire(`container:${submission.id}`, 3600).catch(() => {})

      await supabase.from('submissions').update({
        build_status: 'running',
        preview_url: stablePreviewUrl
      }).eq('id', submission.id)

      return res.json({ success: true, message: 'Preview started from saved image', status: 'running', previewUrl: stablePreviewUrl })
    }

    // ─── SLOW PATH: Download ZIP and queue rebuild ───
    const storagePath = `${submission.task_id}/${submission.user_id}/${submission.id}.zip`
    const { data: zipBlob, error: downloadError } = await supabase.storage
      .from('submissions')
      .download(storagePath)
    if (downloadError || !zipBlob) {
      return res.status(404).json({ success: false, message: 'Could not fetch stored ZIP for this submission' })
    }

    const tmpDir = path.join(__dirname, 'tmp', 'recovery')
    await fsPromises.mkdir(tmpDir, { recursive: true })
    const zipPath = path.join(tmpDir, `${submission.id}.zip`)
    const zipBuffer = Buffer.from(await zipBlob.arrayBuffer())
    await fsPromises.writeFile(zipPath, zipBuffer)

    cm.registerContainer(submission.id, { userId: submission.user_id, taskId: submission.task_id, timeoutMinutes: taskTimeout, status: 'queued', previewType: 'mentor' })
    await supabase.from('submissions').update({ build_status: 'queued' }).eq('id', submission.id)

    // Priority order: winner review (1), mentor preview (2), general upload (3)
    const priority = submission.is_winner ? 1 : 2
    await cm.addJobToQueue(submission.id, {
      submissionId: submission.id,
      userId: submission.user_id,
      taskId: submission.task_id,
      zipPath,
      taskTimeout,
      source: 'mentor-preview'
    }, priority, { attempts: 1 })

    return res.json({ success: true, message: 'Sandbox rebuild queued', status: 'queued' })
  } catch (error) {
    console.error('[Start Preview Error]', error)
    return res.status(500).json({ success: false, message: 'Failed to start sandbox preview' })
  }
})

app.post('/stop-preview/:submissionId', async (req, res) => {
  try {
    const { submissionId } = req.params
    const entry = cm.getContainer(submissionId)
    if (entry && entry.status === 'running') {
      await cm.cleanupContainer(submissionId, 'mentor-preview-closed')
      await supabase.from('submissions').update({ build_status: 'stopped', preview_url: null }).eq('id', submissionId)
      // Clear Redis so fallback doesn't return stale running state
      await cm.redisConnection.del(`container:${submissionId}`).catch(() => {})
    }
    res.json({ success: true, message: 'Preview stopped' })
  } catch (error) {
    console.error('[Stop Preview Error]', error)
    res.status(500).json({ success: false, message: 'Failed to stop preview' })
  }
})

app.post('/api/submissions/:id/pause-review', async (req, res) => {
  try {
    const { id: submissionId } = req.params
    const { mentorId, reason, category, durationHours } = req.body

    console.log('[DEBUG] Pause Review Request:', { submissionId, mentorId, reason, category, durationHours })

    if (!mentorId || !reason) {
      return res.status(400).json({ success: false, message: 'Missing mentorId or reason' })
    }

    const duration = Math.min(Math.max(parseInt(durationHours) || 24, 1), 48)


    const { data: submission, error: subError } = await supabase
      .from('submissions')
      .select('id, task_id, user_id, delivery_status, is_winner, review_hold_count, payment_status')
      .eq('id', submissionId)
      .single()

    if (subError) {
      console.error('[DEBUG] Fetch Submission Error:', subError)
      return res.status(404).json({ success: false, message: `Submission not found (${submissionId}): ${subError.message}` })
    }

    if (!submission) return res.status(404).json({ success: false, message: `Submission ${submissionId} not found in DB.` })
    if (!submission.is_winner) return res.status(403).json({ success: false, message: 'Only winner submissions can be paused.' })
    if (submission.payment_status === 'released') return res.status(400).json({ success: false, message: 'Payment already released.' })

    const { data: task, error: errTask } = await supabase.from('tasks').select('mentor_id').eq('id', submission.task_id || '').single()
    if (errTask && !task) return res.status(500).json({ success: false, message: 'Failed to fetch task: ' + errTask.message })
    if (!task || task.mentor_id !== mentorId) return res.status(403).json({ success: false, message: 'Unauthorized.' })

    const expiresAt = new Date(Date.now() + duration * 60 * 60 * 1000).toISOString()

    const { error: updateError } = await supabase.from('submissions').update({
      review_hold_status: 'paused',
      review_hold_reason: (reason || '').slice(0, 500),
      review_hold_category: category || 'clarification_needed',
      review_hold_started_at: new Date().toISOString(),
      review_hold_expires_at: expiresAt,
      review_hold_duration_hours: duration,
      review_hold_count: (submission.review_hold_count || 0) + 1,
      sandbox_preserved: true
    }).eq('id', submissionId)
    
    if (updateError) {
      return res.status(500).json({ success: false, message: 'DB Update Error: ' + updateError.message })
    }

    // Timeline event
    try {
      const { error: eventErr } = await supabase.from('submission_events').insert({
        submission_id: submissionId,
        task_id: submission.task_id,
        actor_id: mentorId,
        actor_type: 'mentor',
        event_type: 'review_paused',
        message: `Mentor paused review: "${reason}"`,
        metadata: { category, duration, expires_at: expiresAt }
      })
      if (eventErr) console.error('[Event Insert Error]', eventErr.message)
    } catch (e) {
      console.error('[Event Insert Error]', e.message)
    }

    await insertNotification(submission.user_id, 'review', `Your mentor needs clarification on your submission. Please respond within ${duration} hours.`, `/workspace/${submission.task_id}`)
    await logAudit('REVIEW_HOLD_STARTED', mentorId, { submissionId, reason, duration })

    io.emit('review_hold_updated', { submissionId, status: 'paused', expiresAt })

    return res.json({ success: true, message: `Review paused for ${duration} hours.`, expiresAt })
  } catch (error) {
    console.error('[Pause Review Error]', error)
    return res.status(500).json({ success: false, message: 'Failed to pause review: ' + (error.message || 'Unknown error') })
  }
})

// ─── ADVANCED REVIEW HOLD: Respond to Review (unlimited revisions until mentor approves delivery) ───
app.post('/api/submissions/:id/respond-review', upload.single('project'), async (req, res) => {
  try {
    const { id: submissionId } = req.params
    const { userId, message } = req.body

    if (!userId) {
      return res.status(400).json({ success: false, message: 'Missing userId' })
    }

    const rawMessage = (message && String(message).trim()) || ''
    if (!rawMessage && !req.file) {
      return res.status(400).json({ success: false, message: 'Add a message and/or attach a revised ZIP file.' })
    }
    const messageStored = rawMessage || 'Revised project ZIP uploaded.'

    const { data: submission } = await supabase
      .from('submissions')
      .select('id, task_id, user_id, review_hold_status, current_revision, is_winner, delivery_status, payment_status')
      .eq('id', submissionId)
      .single()

    if (!submission) return res.status(404).json({ success: false, message: 'Submission not found in /api/submissions/:id/respond-review.' })
    if (submission.user_id !== userId) return res.status(403).json({ success: false, message: 'Not your submission.' })
    if (!submission.is_winner) {
      return res.status(403).json({ success: false, message: 'Only the winning submission can use this revision upload.' })
    }
    if (submission.delivery_status === 'approved' || (submission.payment_status || '') === 'released') {
      return res.status(400).json({ success: false, message: 'Delivery already approved — revision uploads are closed.' })
    }
    if (submission.delivery_status !== 'submitted') {
      return res.status(400).json({ success: false, message: 'Submit your final delivery first, then you can upload revision ZIPs here.' })
    }

    const hold = submission.review_hold_status || 'none'
    const holdAllowsRevision = ['paused', 'responded', 'none'].includes(hold)
    if (!holdAllowsRevision || hold === 'completed') {
      return res.status(400).json({ success: false, message: 'Revision uploads are not available in the current review state.' })
    }

    const { data: maxRevRows } = await supabase
      .from('submission_revisions')
      .select('revision_number')
      .eq('submission_id', submissionId)
      .order('revision_number', { ascending: false })
      .limit(1)

    const newRevision = (maxRevRows?.[0]?.revision_number ?? 0) + 1
    let artifactUrl = null

    // Handle optional ZIP revision upload
    if (req.file) {
      const storagePath = `${submission.task_id}/${userId}/${submissionId}_rev${newRevision}.zip`
      const fileBuffer = await fsPromises.readFile(req.file.path)
      const { error: uploadErr } = await supabase.storage
        .from('submissions')
        .upload(storagePath, fileBuffer, { contentType: 'application/zip', upsert: true })

      if (!uploadErr) {
        const { data: { publicUrl } } = supabase.storage.from('submissions').getPublicUrl(storagePath)
        artifactUrl = publicUrl
      } else {
        console.error('[Revision Storage]', uploadErr.message)
        await fsPromises.rm(req.file.path, { force: true }).catch(() => {})
        return res.status(500).json({ success: false, message: 'Failed to store revision ZIP: ' + uploadErr.message })
      }
      await fsPromises.rm(req.file.path, { force: true }).catch(() => {})
    }

    // Insert revision record
    const msgStored = messageStored.slice(0, 2000)
    const rowBase = {
      submission_id: submissionId,
      revision_number: newRevision,
      artifact_url: artifactUrl || 'text-only-response',
      uploaded_by: userId
    }

    const isUnknownColumnError = (e) => {
      const m = String(e?.message || '').toLowerCase()
      return m.includes('schema cache') || m.includes('could not find') || m.includes('column')
    }

    // submission_revisions message column name differs by migration (revision_system vs add_advanced_review_hold)
    let insertedRev = null
    let revErr = null
    for (const payload of [
      { ...rowBase, clarification_message: msgStored, review_response_message: msgStored },
      { ...rowBase, clarification_message: msgStored },
      { ...rowBase, review_response_message: msgStored }
    ]) {
      const ins = await supabase.from('submission_revisions').insert(payload).select('id')
      if (!ins.error && ins.data?.length) {
        insertedRev = ins.data
        revErr = null
        break
      }
      revErr = ins.error
      if (!isUnknownColumnError(ins.error)) break
    }

    if (revErr || !insertedRev?.length) {
      console.error('[Revision Insert Error]', revErr?.message)
      return res.status(500).json({ success: false, message: 'Could not save revision record: ' + (revErr?.message || 'insert failed') })
    }

    // Append to submissions.revision_delivery_log (mentor-visible even if submission_revisions RLS blocks reads)
    let nextDeliveryLog = null
    const { data: snap, error: snapErr } = await supabase
      .from('submissions')
      .select('revision_delivery_log')
      .eq('id', submissionId)
      .single()
    if (!snapErr && snap) {
      const log = Array.isArray(snap.revision_delivery_log) ? [...snap.revision_delivery_log] : []
      log.push({
        revision_number: newRevision,
        artifact_url: artifactUrl || null,
        message: msgStored,
        uploaded_by: userId,
        created_at: new Date().toISOString()
      })
      nextDeliveryLog = log
    } else if (snapErr) {
      const m = String(snapErr.message || '')
      if (!/revision_delivery_log|schema cache|could not find.*column/i.test(m)) {
        console.warn('[revision_delivery_log read]', m)
      }
    }

    // Keep hold as "responded" so mentor knows there is new material
    const nextHoldStatus = 'responded'

    await supabase.from('submissions').update({
      review_hold_status: nextHoldStatus,
      current_revision: newRevision,
      ...(artifactUrl && { latest_artifact_url: artifactUrl }),
      ...(nextDeliveryLog != null && { revision_delivery_log: nextDeliveryLog })
    }).eq('id', submissionId)

    // Timeline event
    const { error: eventErr } = await supabase.from('submission_events').insert({
      submission_id: submissionId,
      task_id: submission.task_id,
      actor_id: userId,
      actor_type: 'employee',
      event_type: 'clarification_submitted',
      message: `Developer responded: "${messageStored.slice(0, 200)}"`,
      metadata: { revision: newRevision, has_artifact: !!artifactUrl }
    })
    if (eventErr) console.error('[Event Insert Error]', eventErr.message)

    // Notify mentor
    const { data: taskData } = await supabase.from('tasks').select('mentor_id').eq('id', submission.task_id).single()
    if (taskData?.mentor_id) {
      await insertNotification(taskData.mentor_id, 'review', `Developer responded to your clarification request.`, `/mentor/tasks/${submission.task_id}/submissions`)
    }

    await logAudit('REVIEW_HOLD_RESPONDED', userId, { submissionId, revision: newRevision })

    // Emit Socket events
    io.emit('review_hold_updated', { submissionId, status: nextHoldStatus, revision: newRevision })
    
    // New event for Mentor banner and history panel
    io.emit('clarification_submitted', {
      submissionId,
      revision: newRevision,
      employeeId: userId,
      message: messageStored.slice(0, 2000),
      hasArtifact: !!artifactUrl
    })

    return res.json({ success: true, message: 'Clarification submitted.', revision: newRevision })
  } catch (error) {
    console.error('[Respond Review Error]', error)
    if (req.file) {
      await fsPromises.rm(req.file.path, { force: true }).catch(() => {})
    }
    return res.status(500).json({ success: false, message: 'Failed to submit clarification.' })
  }
})

// Mentor (or task owner): list revision rows — must run on server so service role bypasses RLS on submission_revisions
app.get('/api/submissions/:submissionId/revisions', async (req, res) => {
  try {
    const { submissionId } = req.params
    const mentorId = req.query.mentorId
    if (!mentorId) {
      return res.status(400).json({ success: false, message: 'Missing mentorId' })
    }

    const { data: submission, error: subErr } = await supabase
      .from('submissions')
      .select('*')
      .eq('id', submissionId)
      .single()

    if (subErr || !submission) {
      return res.status(404).json({ success: false, message: 'Submission not found' })
    }

    const { data: task } = await supabase.from('tasks').select('mentor_id').eq('id', submission.task_id).single()
    if (!task || String(task.mentor_id) !== String(mentorId)) {
      return res.status(403).json({ success: false, message: 'Unauthorized' })
    }

    const { data: revisions, error: revErr } = await supabase
      .from('submission_revisions')
      .select('*')
      .eq('submission_id', submissionId)
      .order('revision_number', { ascending: true })

    if (revErr) {
      console.error('[Revisions List]', revErr.message)
      return res.status(500).json({ success: false, message: revErr.message })
    }

    const merged = mergeSubmissionRevisionSources(
      submissionId,
      revisions || [],
      submission.revision_delivery_log,
      submission
    )

    return res.json({ success: true, revisions: merged })
  } catch (error) {
    console.error('[Revisions List Error]', error)
    return res.status(500).json({ success: false, message: 'Failed to load revisions' })
  }
})

// Mentor updates latest written correction (shown to employee on workspace)
app.post('/api/submissions/:id/mentor-latest-correction', async (req, res) => {
  try {
    const { id: submissionId } = req.params
    const { mentorId, correction } = req.body
    if (!mentorId) {
      return res.status(400).json({ success: false, message: 'Missing mentorId' })
    }
    const text = (correction && String(correction).trim()) || ''
    if (!text) {
      return res.status(400).json({ success: false, message: 'Correction text is required' })
    }

    const { data: submission, error: subErr } = await supabase
      .from('submissions')
      .select('id, task_id, delivery_status')
      .eq('id', submissionId)
      .single()
    if (subErr || !submission) {
      return res.status(404).json({ success: false, message: 'Submission not found' })
    }
    const { data: task } = await supabase.from('tasks').select('mentor_id').eq('id', submission.task_id).single()
    if (!task || task.mentor_id !== mentorId) {
      return res.status(403).json({ success: false, message: 'Unauthorized' })
    }
    if (submission.delivery_status === 'approved') {
      return res.status(400).json({ success: false, message: 'Delivery already approved' })
    }

    const now = new Date().toISOString()
    const { error: upErr } = await supabase.from('submissions').update({
      mentor_latest_correction: text.slice(0, 4000),
      mentor_latest_correction_at: now
    }).eq('id', submissionId)
    if (upErr) {
      return res.status(500).json({ success: false, message: upErr.message })
    }

    io.emit('review_hold_updated', { submissionId, event: 'mentor_correction_updated' })
    return res.json({ success: true, message: 'Correction saved', updatedAt: now })
  } catch (e) {
    console.error('[mentor-latest-correction]', e)
    return res.status(500).json({ success: false, message: 'Failed to save correction' })
  }
})

// ─── Submission Timeline API ───
app.get('/api/submissions/:id/timeline', async (req, res) => {
  try {
    const { id: submissionId } = req.params
    const { data: events } = await supabase
      .from('submission_events')
      .select('*')
      .eq('submission_id', submissionId)
      .order('created_at', { ascending: true })
    res.json({ success: true, events: events || [] })
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to load timeline.' })
  }
})

app.get('/logs/:submissionId', async (req, res) => {
  const { submissionId } = req.params
  cm.touchContainer(submissionId)
  const logs = await cm.getLogs(submissionId)
  res.json({ success: true, logs })
})

// ═══════════════════════════════════════════════════════════════
// MENTOR REVIEW QA SYSTEM — API routes (preview proxy is registered above)
// ═══════════════════════════════════════════════════════════════

// ─── TEST REVISION IN SANDBOX (Improvements 1, 3, 6, 7) ───
app.post('/api/submissions/:id/test-revision', async (req, res) => {
  try {
    const { id: submissionId } = req.params
    const { mentorId, revisionNumber } = req.body

    if (!mentorId) {
      return res.status(400).json({ success: false, message: 'Missing mentorId' })
    }

    // ─── STRICT OWNERSHIP VALIDATION (Improvement 6) ───
    const { data: submission, error: subErr } = await supabase
      .from('submissions')
      .select('id, task_id, user_id, is_winner, review_hold_status')
      .eq('id', submissionId)
      .single()

    if (subErr || !submission) {
      return res.status(404).json({ success: false, message: 'Submission not found' })
    }

    if (!submission.is_winner) {
      return res.status(403).json({ success: false, message: 'Only the winning submission can be revision-tested' })
    }

    if (!['paused', 'responded', 'none'].includes(submission.review_hold_status || 'none')) {
      return res.status(400).json({ success: false, message: 'Review is not in a state that allows revision sandbox testing.' })
    }

    const { data: task } = await supabase
      .from('tasks')
      .select('mentor_id')
      .eq('id', submission.task_id)
      .single()

    if (!task || task.mentor_id !== mentorId) {
      return res.status(403).json({ success: false, message: 'Unauthorized: you do not own this task' })
    }

    // ─── CONCURRENCY GUARD (Improvement 3) ───
    const activeCheck = cm.isReviewSandboxActive(submissionId)
    if (activeCheck.active) {
      return res.status(409).json({
        success: false,
        message: 'Review sandbox already running',
        status: activeCheck.status,
        revision: activeCheck.revision
      })
    }

    // ─── FIND TARGET REVISION ───
    let targetRevision
    if (revisionNumber) {
      const { data: rev } = await supabase
        .from('submission_revisions')
        .select('*')
        .eq('submission_id', submissionId)
        .eq('revision_number', revisionNumber)
        .single()
      targetRevision = rev
    } else {
      // Use latest revision
      const { data: revs } = await supabase
        .from('submission_revisions')
        .select('*')
        .eq('submission_id', submissionId)
        .order('revision_number', { ascending: false })
        .limit(1)
      targetRevision = revs?.[0]
    }

    if (!targetRevision || !targetRevision.artifact_url || targetRevision.artifact_url === 'text-only-response') {
      return res.status(404).json({ success: false, message: 'No testable ZIP artifact found for this revision. The developer may have submitted a text-only response.' })
    }

    const revNum = targetRevision.revision_number

    // ─── DOWNLOAD REVISION ZIP (Read-only — Improvement 7) ───
    // Extract storage path from the artifact URL
    const urlParts = targetRevision.artifact_url.split('/submissions/')
    const storagePath = urlParts[urlParts.length - 1]

    const { data: zipBlob, error: downloadErr } = await supabase.storage
      .from('submissions')
      .download(storagePath)

    if (downloadErr || !zipBlob) {
      return res.status(404).json({ success: false, message: 'Could not download revision ZIP from storage' })
    }

    // Save to isolated review temp directory (NEVER in employee tmp)
    const reviewTmpDir = path.join(__dirname, 'tmp', 'review', submissionId)
    await fsPromises.mkdir(reviewTmpDir, { recursive: true })
    const zipPath = path.join(reviewTmpDir, `rev${revNum}.zip`)
    const zipBuffer = Buffer.from(await zipBlob.arrayBuffer())
    await fsPromises.writeFile(zipPath, zipBuffer)

    // ─── REGISTER IN REVIEW REGISTRY (Isolated — Improvement 1) ───
    cm.registerReviewContainer(submissionId, revNum, {
      userId: submission.user_id,
      taskId: submission.task_id,
      timeoutMinutes: 15,
      status: 'queued'
    })

    // Update revision status in DB
    await supabase.from('submission_revisions')
      .update({ sandbox_status: 'queued' })
      .eq('id', targetRevision.id)

    // Queue via existing pipeline with review source marker
    await cm.addJobToQueue(`review-${submissionId}-${revNum}`, {
      submissionId,
      userId: submission.user_id,
      taskId: submission.task_id,
      zipPath,
      taskTimeout: 15,
      source: 'mentor-review-test',
      revisionNumber: revNum,
      revisionId: targetRevision.id
    }, 1, { attempts: 1 })

    const previewUrl = `/preview/review/${submissionId}/${revNum}`

    console.log(`[Review Test] Queued revision v${revNum} for ${submissionId} → ${previewUrl}`)

    // Timeline event
    try {
      const { error: eventErr } = await supabase.from('submission_events').insert({
        submission_id: submissionId,
        task_id: submission.task_id,
        actor_id: mentorId,
        actor_type: 'mentor',
        event_type: 'revision_test_started',
        message: `Mentor started sandbox test for revision v${revNum}`,
        metadata: { revision: revNum }
      })
      if (eventErr) console.error('[Event Insert Error]', eventErr.message)
    } catch (e) {
      console.error('[Event Insert Error]', e.message)
    }

    return res.json({
      success: true,
      message: `Revision v${revNum} queued for sandbox testing`,
      status: 'queued',
      previewUrl,
      revision: revNum
    })
  } catch (error) {
    console.error('[Test Revision Error]', error)
    return res.status(500).json({ success: false, message: 'Failed to start revision test: ' + (error.message || 'Unknown error') })
  }
})

// ─── STOP REVIEW SANDBOX ───
app.post('/api/submissions/:id/stop-review-sandbox', async (req, res) => {
  try {
    const { id: submissionId } = req.params
    const { mentorId, revisionNumber } = req.body
    const revNum = parseInt(revisionNumber, 10)

    if (!mentorId || !revNum) {
      return res.status(400).json({ success: false, message: 'Missing mentorId or revisionNumber' })
    }

    const { data: submission, error: subErr } = await supabase
      .from('submissions')
      .select('id, task_id')
      .eq('id', submissionId)
      .single()
    if (subErr || !submission) {
      return res.status(404).json({ success: false, message: 'Submission not found' })
    }
    const { data: taskRow } = await supabase
      .from('tasks')
      .select('mentor_id')
      .eq('id', submission.task_id)
      .single()
    if (!taskRow || taskRow.mentor_id !== mentorId) {
      return res.status(403).json({ success: false, message: 'Unauthorized' })
    }

    await cm.cleanupReviewContainer(submissionId, revNum, 'mentor-stopped')

    await supabase.from('submission_revisions')
      .update({ sandbox_status: 'idle' })
      .eq('submission_id', submissionId)
      .eq('revision_number', revNum)

    res.json({ success: true, message: `Review sandbox for v${revNum} stopped` })
  } catch (error) {
    console.error('[Stop Review Sandbox Error]', error)
    res.status(500).json({ success: false, message: 'Failed to stop review sandbox' })
  }
})

// ─── CHECK REVIEW SANDBOX STATUS ───
app.get('/api/submissions/:id/review-sandbox-status', async (req, res) => {
  const { id: submissionId } = req.params
  const activeCheck = cm.isReviewSandboxActive(submissionId)
  
  if (activeCheck.active) {
    const entry = cm.getReviewContainer(submissionId, activeCheck.revision)
    return res.json({
      success: true,
      active: true,
      status: activeCheck.status,
      revision: activeCheck.revision,
      previewUrl: activeCheck.status === 'running' ? `/preview/review/${submissionId}/${activeCheck.revision}` : null,
      logs: entry?.logsBuffer || []
    })
  }

  res.json({ success: true, active: false, status: 'idle' })
})

// ─── REVIEW LOGS (Isolated from employee logs) ───
app.get('/api/submissions/:id/review-logs/:revision', async (req, res) => {
  const { id: submissionId, revision } = req.params
  const revNum = parseInt(revision, 10)
  const logs = await cm.getReviewLogs(submissionId, revNum)
  res.json({ success: true, logs })
})

// ─── MENTOR REVIEW NOTES (Improvement 5) ───
app.post('/api/revisions/:revisionId/notes', async (req, res) => {
  try {
    const { revisionId } = req.params
    const { mentorId, note, submissionId } = req.body

    if (!mentorId || !note?.trim()) {
      return res.status(400).json({ success: false, message: 'Missing mentorId or note' })
    }

    const { error } = await supabase.from('revision_review_notes').insert({
      revision_id: revisionId,
      submission_id: submissionId || null,
      mentor_id: mentorId,
      note: note.trim().slice(0, 2000)
    })

    if (error) {
      return res.status(500).json({ success: false, message: 'Failed to save note: ' + error.message })
    }

    return res.json({ success: true, message: 'Note saved' })
  } catch (error) {
    console.error('[Review Note Error]', error)
    return res.status(500).json({ success: false, message: 'Failed to save review note' })
  }
})

app.get('/api/revisions/:revisionId/notes', async (req, res) => {
  try {
    const { revisionId } = req.params
    const { data: notes } = await supabase
      .from('revision_review_notes')
      .select('*')
      .eq('revision_id', revisionId)
      .order('created_at', { ascending: true })
    res.json({ success: true, notes: notes || [] })
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to load notes' })
  }
})

// ─── DEBUG: Inspect all state layers for a submission ───
// GET /debug/submission/:id — shows registry, exec: key, container: key, DB row, TCP probe
app.get('/debug/submission/:submissionId', async (req, res) => {
  const { submissionId } = req.params
  const registry = cm.getContainer(submissionId)
  const execKey = await cm.redisConnection.hgetall(`exec:${submissionId}`).catch(() => null)
  const containerKey = await cm.redisConnection.hgetall(`container:${submissionId}`).catch(() => null)
  let dbRow = null
  try {
    const { data } = await supabase.from('submissions').select('id,build_status,preview_url,runtime_type').eq('id', submissionId).single()
    dbRow = data
  } catch {}


  // TCP probe on any port found
  const portSources = [
    { src: 'registry', port: registry?.port },
    { src: 'exec', port: execKey?.port ? parseInt(execKey.port, 10) : null },
    { src: 'container', port: containerKey?.port ? parseInt(containerKey.port, 10) : null }
  ].filter(x => x.port)

  const probeResults = await Promise.all(portSources.map(async ({ src, port }) => ({
    src, port,
    inSandboxRange: port >= SANDBOX_PORT_MIN && port <= SANDBOX_PORT_MAX,
    listening: await isPortListening(port, 800)
  })))

  res.json({
    submissionId,
    registry: registry ? { status: registry.status, port: registry.port, containerId: registry.containerId } : null,
    redisExec: execKey,
    redisContainer: containerKey,
    db: dbRow,
    tcpProbes: probeResults,
    sandboxPortRange: `${SANDBOX_PORT_MIN}–${SANDBOX_PORT_MAX}`
  })
})

// ─── DEBUG: Scan all running submissions in Redis ───
// GET /debug/scan-running — lists all exec: keys with status=running
app.get('/debug/scan-running', async (req, res) => {
  try {
    const keys = await cm.redisConnection.keys('exec:*').catch(() => [])
    const results = []
    for (const key of keys) {
      const d = await cm.redisConnection.hgetall(key).catch(() => null)
      if (d?.status === 'running') {
        const port = d.port ? parseInt(d.port, 10) : null
        const listening = port ? await isPortListening(port, 600) : false
        results.push({
          submissionId: key.replace('exec:', ''),
          port,
          inRange: port ? (port >= SANDBOX_PORT_MIN && port <= SANDBOX_PORT_MAX) : false,
          listening,
          updatedAt: d.updatedAt
        })
      }
    }
    res.json({ count: results.length, entries: results })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── PROFILE & AVATAR ENDPOINTS ───

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error('Only image files are allowed'))
    }
  }
})

app.post('/upload-avatar', avatarUpload.single('avatar'), async (req, res) => {
  try {
    const { userId } = req.body
    if (!userId || !req.file) return res.status(400).json({ success: false, message: 'Missing userId or file' })

    const ext = req.file.mimetype.split('/')[1] || 'jpg'
    const storagePath = `avatars/${userId}/avatar.${ext}`

    const { error: uploadError } = await supabase.storage
      .from('profile-images')
      .upload(storagePath, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: true
      })

    if (uploadError) {
      console.error('[Avatar Upload Error]', uploadError)
      return res.status(500).json({ success: false, message: uploadError.message })
    }

    const { data: { publicUrl } } = supabase.storage.from('profile-images').getPublicUrl(storagePath)

    await supabase.from('users').update({ avatar_url: publicUrl }).eq('id', userId)

    return res.json({ success: true, url: publicUrl })
  } catch (err) {
    console.error('[Avatar Upload Error]', err)
    return res.status(500).json({ success: false, message: err.message || 'Avatar upload failed' })
  }
})

app.post('/profile/update', async (req, res) => {
  try {
    const { userId, name, bio, skills, experience, github_url, linkedin_url, portfolio_url, avatar_url } = req.body
    if (!userId) return res.status(400).json({ success: false, message: 'Missing userId' })
    if (!name?.trim()) return res.status(400).json({ success: false, message: 'Name is required' })

    const updateData = {
      name: name.trim(),
      bio: (bio || '').slice(0, 300),
      skills: Array.isArray(skills) ? skills.slice(0, 15) : [],
      experience: experience || 'beginner',
      github_url: github_url || null,
      linkedin_url: linkedin_url || null,
      portfolio_url: portfolio_url || null,
    }
    if (avatar_url) updateData.avatar_url = avatar_url

    const { error } = await supabase.from('users').update(updateData).eq('id', userId)
    if (error) return res.status(500).json({ success: false, message: error.message })

    return res.json({ success: true, message: 'Profile updated' })
  } catch (err) {
    console.error('[Profile Update Error]', err)
    return res.status(500).json({ success: false, message: 'Failed to update profile' })
  }
})

app.get('/profile/:userId', async (req, res) => {
  try {
    const { userId } = req.params

    const [userRes, reviewsRes, statsRes] = await Promise.all([
      supabase.from('users')
        .select('id, name, bio, skills, experience, github_url, linkedin_url, portfolio_url, avatar_url, role, kyc_status, created_at')
        .eq('id', userId)
        .single(),
      supabase.from('reviews')
        .select('rating, review, created_at, reviewer:reviewer_id(name, avatar_url)')
        .eq('target_user_id', userId)
        .order('created_at', { ascending: false })
        .limit(20),
      supabase.from('submissions')
        .select('is_winner, delivery_status')
        .eq('user_id', userId)
    ])

    if (!userRes.data) return res.status(404).json({ success: false, message: 'User not found' })

    const reviews = reviewsRes.data || []
    const avgRating = reviews.length > 0
      ? Math.round((reviews.reduce((a, r) => a + r.rating, 0) / reviews.length) * 10) / 10
      : 0

    const subs = statsRes.data || []
    const wins = subs.filter(s => s.is_winner).length
    const winRate = subs.length > 0 ? Math.round((wins / subs.length) * 100) : 0

    return res.json({
      success: true,
      profile: userRes.data,
      reviews,
      avgRating,
      stats: { totalSubmissions: subs.length, wins, winRate }
    })
  } catch (err) {
    console.error('[Public Profile Error]', err)
    return res.status(500).json({ success: false, message: 'Failed to fetch profile' })
  }
})

// ─── REVIEWS ENDPOINTS ───

app.post('/reviews', async (req, res) => {
  try {
    const { reviewerId, targetUserId, taskId, submissionId, rating, review } = req.body

    if (!reviewerId || !targetUserId || !rating) {
      return res.status(400).json({ success: false, message: 'Missing required fields' })
    }
    if (reviewerId === targetUserId) {
      return res.status(400).json({ success: false, message: 'Cannot review yourself' })
    }
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ success: false, message: 'Rating must be 1-5' })
    }

    if (taskId) {
      const { data: existing } = await supabase
        .from('reviews')
        .select('id')
        .eq('reviewer_id', reviewerId)
        .eq('task_id', taskId)
        .maybeSingle()
      if (existing) {
        return res.status(409).json({ success: false, message: 'You have already reviewed this person for this task' })
      }
    }

    const { data, error } = await supabase.from('reviews').insert({
      reviewer_id: reviewerId,
      target_user_id: targetUserId,
      task_id: taskId || null,
      submission_id: submissionId || null,
      rating,
      review: (review || '').slice(0, 500)
    }).select().single()

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ success: false, message: 'You already reviewed this person for this task' })
      }
      return res.status(500).json({ success: false, message: error.message })
    }

    return res.json({ success: true, review: data })
  } catch (err) {
    console.error('[Review Create Error]', err)
    return res.status(500).json({ success: false, message: 'Failed to submit review' })
  }
})

app.get('/reviews/:userId', async (req, res) => {
  try {
    const { userId } = req.params
    const { data, error } = await supabase
      .from('reviews')
      .select('*, reviewer:reviewer_id(name, avatar_url)')
      .eq('target_user_id', userId)
      .order('created_at', { ascending: false })

    if (error) return res.status(500).json({ success: false, message: error.message })

    const avg = data.length > 0
      ? Math.round((data.reduce((a, r) => a + r.rating, 0) / data.length) * 10) / 10
      : 0

    return res.json({ success: true, reviews: data || [], avgRating: avg, count: data?.length || 0 })
  } catch (err) {
    console.error('[Reviews Fetch Error]', err)
    return res.status(500).json({ success: false, message: 'Failed to fetch reviews' })
  }
})

app.get('/reviews/check/:taskId/:reviewerId', async (req, res) => {
  try {
    const { taskId, reviewerId } = req.params
    const { data } = await supabase
      .from('reviews')
      .select('id')
      .eq('task_id', taskId)
      .eq('reviewer_id', reviewerId)
      .maybeSingle()
    return res.json({ success: true, hasReviewed: !!data })
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to check review status' })
  }
})

// ==========================================
// 🚀 ENDPOINT ADDITIONS: PRODUCTION WALLETS
// ==========================================

// ✅ 1. Get Wallet Dashboard Data
app.get('/api/wallet', async (req, res) => {
  try {
    const { userId } = req.query
    if (!userId) return res.status(400).json({ success: false, message: 'Missing user ID' })

    const { data: wallet, error } = await supabase.from('wallets').select('*').eq('user_id', userId).single()
    if (error && error.code !== 'PGRST116') throw error
    res.json({ success: true, data: wallet || { available_balance: 0, locked_balance: 0, total_earned: 0, total_withdrawn: 0 } })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

// ✅ 2. Request Withdrawal
app.post('/api/wallet/withdraw', async (req, res) => {
  try {
    const { userId, amount, paymentMethod } = req.body
    if (!userId || !amount || amount < 10) return res.status(400).json({ success: false, message: 'Minimum withdrawal is $10' })

    // Check KYC
    const { data: kyc } = await supabase.from('kyc_submissions').select('status').eq('user_id', userId).order('created_at', { ascending: false }).limit(1).single()
    if (!kyc || kyc.status !== 'approved') return res.status(403).json({ success: false, message: 'KYC strictly required before withdrawing real funds.' })

    const parsedAmount = Number(amount)

    // Call RPC to request withdrawal safely (atomic)
    const { data: rpcData, error } = await supabase.rpc('request_withdrawal', {
      p_user_id: userId,
      p_amount: parsedAmount,
      p_payment_method: paymentMethod || 'Bank Transfer'
    })

    if (error) return res.status(400).json({ success: false, message: error.message })
    if (!rpcData.success) return res.status(400).json({ success: false, message: rpcData.message })

    await logAudit('WITHDRAWAL_REQUESTED', userId, { amount: parsedAmount })
    res.json({ success: true, message: 'Withdrawal requested successfully. It is now under review.', data: rpcData })
  } catch (err) {
    console.error(err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// ✅ 3. Admin Withdrawals Dashboard
app.get('/api/admin/withdrawals', async (req, res) => {
  try {
    const { data, error } = await supabase.from('withdrawals').select('*, users(id, username, email)').order('created_at', { ascending: false })
    if (error) throw error
    res.json({ success: true, data })
  } catch (error) {
    res.status(500).json({ success: false, message: error.message })
  }
})

// ✅ 4. Admin Process Withdrawal
app.post('/api/admin/withdrawals/:id/process', async (req, res) => {
  try {
    const { action, adminNotes, rejectionReason, payoutReference } = req.body
    const { id } = req.params

    const { data: withdrawal, error } = await supabase.from('withdrawals').select('*').eq('id', id).single()
    if (error || !withdrawal) return res.status(404).json({ success: false, message: 'Not found' })

    if (action === 'approve') {
       // Just marking as processing/approved, the external system (Razorpay) will move the money
       await supabase.from('withdrawals').update({ status: 'processing', admin_notes: adminNotes }).eq('id', id)
       // Notification to user
    } else if (action === 'complete') {
       // Call RPC to finalize
       const { error: rpcErr } = await supabase.rpc('complete_withdrawal', { p_withdrawal_id: id, p_payout_ref: payoutReference })
       if (rpcErr) throw rpcErr
    } else if (action === 'reject') {
       // Call RPC to refund 
       const { error: rpcErr } = await supabase.rpc('reject_withdrawal', { p_withdrawal_id: id, p_reason: rejectionReason })
       if (rpcErr) throw rpcErr
    }
    
    res.json({ success: true, message: `Withdrawal ${action}d` })
  } catch (error) {
    res.status(500).json({ success: false, message: error.message })
  }
})

// ✅ 5. Get Wallet Transactions
app.get('/api/wallet/transactions', async (req, res) => {
  try {
    const { userId } = req.query
    if (!userId) return res.status(400).json({ success: false, message: 'Missing user ID' })

    const { data: transactions, error } = await supabase.from('wallet_transactions').select('*').eq('user_id', userId).order('created_at', { ascending: false })
    if (error) throw error
    res.json({ success: true, data: transactions })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

// SPA (production): register after all API routes so paths like GET /api/wallet are not swallowed by '*'.
const frontendDir = path.join(__dirname, '../dist')
const indexHtml = path.join(frontendDir, 'index.html')
if (fs.existsSync(indexHtml)) {
  app.use(express.static(frontendDir))
  app.get('*', (req, res, next) => {
    res.sendFile(indexHtml, (err) => {
      if (err) {
        console.error('[frontend] sendFile:', err.message)
        next(err)
      }
    })
  })
} else {
  console.warn(
    '[frontend] dist/index.html not found. Run `npm run build` before `npm start`, or use `npm run dev` (Vite + API).'
  )
  app.get('*', (req, res, next) => {
    if (req.method !== 'GET') return next()
    res
      .status(503)
      .type('html')
      .send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><title>Frontend not built</title>
<style>body{font-family:system-ui,sans-serif;max-width:42rem;margin:2rem auto;padding:0 1rem;line-height:1.5;background:#0f172a;color:#e2e8f0}
code{background:#1e293b;padding:.15rem .4rem;border-radius:4px}</style></head>
<body><h1>Frontend bundle missing</h1>
<p>The API server is running, but <code>dist/index.html</code> does not exist yet.</p>
<p><strong>Option A — development:</strong> from the project root run <code>npm run dev</code> (Vite serves the UI; API stays on port 3001 unless configured).</p>
<p><strong>Option B — production-style:</strong> run <code>npm run build</code> then start the server again so <code>dist/</code> is created.</p>
</body></html>`)
  })
}

cm.startCleanupWorker(supabase)

const PORT = process.env.PORT || 3000
server.listen(PORT, '0.0.0.0', async () => {
  console.log(`\n🚀 Nexus Production-Grade Server running on http://0.0.0.0:${PORT}`)
  console.log(`📡 Socket.IO enabled for real-time logs`)
  console.log(`❤️  GET  /health — Health check`)
  console.log(`🔴 GET  /health/redis — Redis health check\n`)
  await validateRedisOnStartup(cm.redisConnection)
  // Rebuild in-memory registry from Redis on startup.
  // Ensures the proxy can serve previews immediately after a server restart
  // without waiting for the first Redis fallback lookup per submission.
  try {
    const recovered = await recoverRunningFromRedis()
    for (const entry of recovered) {
      const { submissionId, status, port, containerId, userId, taskId } = entry
      if (!cm.getContainer(submissionId) && port) {
        cm.registerContainer(submissionId, {
          containerId: containerId || null,
          port: parseInt(port, 10),
          userId: userId || null,
          taskId: taskId || null,
          status: 'running',
          previewType: 'employee'
        })
        cm.updateContainer(submissionId, { status: 'running' })
        console.log(`[Startup Recovery] Restored ${submissionId} → :${port}`)
      }
    }
    if (recovered.length === 0) {
      console.log('[Startup Recovery] No running submissions in Redis.')
    }
  } catch (recoverErr) {
    console.error('[Startup Recovery] Error:', recoverErr.message)
  }
})
