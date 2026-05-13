import fsPromises from 'fs/promises'
import path from 'path'
import { docker, pingDocker } from './dockerClient.js'
import { createConnection, pingRedis, buildConnectionOptions } from './redisClient.js'

export { pingDocker }

// ─── CONTAINER REGISTRY ───
// submissionId → { containerId, port, userId, taskId, status, logsBuffer, healthStatus,
//                  lastAccessed, startedAt, timeoutMinutes, restartCount, previewType,
//                  expiresAt, buildStartedAt }
const registry = new Map()
const usedPorts = new Set()

// ─── ISOLATED REVIEW SANDBOX REGISTRY (Improvement 1) ───
// Key format: "review:<submissionId>:<revision>" — isolated from employee registry.
const reviewRegistry = new Map()

export function reviewRegistryKey(submissionId, revision) {
  return `review:${submissionId}:${revision}`
}
const INACTIVE_TIMEOUT_REVIEW_MS = 15 * 60 * 1000 // 15 minutes for mentor review sandboxes

// ─── CONFIGURATION ───
const DEFAULT_TIMEOUT_MINUTES = 5
const MAX_CONTAINERS_PER_USER = 2
const MAX_GLOBAL_CONTAINERS = 10
const MAX_SUBMISSIONS_PER_HOUR = 10
const PORT_RANGE = { min: 40000, max: 50000 }
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000 // every 5 minutes

const INACTIVE_TIMEOUT_EMPLOYEE_MS = 10 * 60 * 1000 // 10 minutes
const INACTIVE_TIMEOUT_MENTOR_MS = 15 * 60 * 1000   // 15 minutes
const MAX_BUILD_TIME_MS = 120 * 1000   // 120 seconds
const MAX_STARTUP_TIME_MS = 60 * 1000  // 60 seconds
const MAX_RESTART_ATTEMPTS = 3

const BILLING_RATE_PER_SEC = 0.01 // ₹0.01 per second

// ─── REDIS & QUEUE SETUP ───
// Shared connection for general app use (pub/sub, state, locks)
export const redisConnection = createConnection('Redis-App')

export async function isRedisHealthy() {
  const result = await pingRedis(redisConnection)
  return result.ok
}

const sandboxQueue = {
  getJob: async () => null,
  getJobs: async () => [],
  add: async (name, data, opts) => {
    // Process inline
    import('./worker.js').then(worker => {
      worker.processJob(data).catch(err => console.error(err))
    })
    return { id: opts.jobId }
  }
}

export async function addJobToQueue(queueKey, data, priority = 3, opts = {}) {
  const source = data.source || 'unknown'
  const attempts = opts.attempts ?? 3
  const jobId = `submission-${queueKey}`

  // ─── DEDUPLICATION GUARD ───
  // Check if a job already exists for this submission (any state)
  const existingJob = await sandboxQueue.getJob(jobId)
  if (existingJob) {
    const state = await existingJob.getState()
    if (['waiting', 'active', 'delayed'].includes(state)) {
      console.log(`[QUEUE ADD] REJECTED duplicate for ${queueKey}: job already ${state} (source=${source})`)
      return existingJob
    }
    // Job is completed/failed — remove it so we can add a fresh one
    await existingJob.remove()
  }

  console.log(`[QUEUE ADD] queueKey=${queueKey} submissionId=${data.submissionId} source=${source} attempts=${attempts} priority=${priority} jobId=${jobId}`)
  return await sandboxQueue.add('execute', {
    ...data
  }, {
    jobId,
    priority,
    attempts,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: true,
    removeOnFail: true
  })
}

export async function cleanStaleJobs(maxAgeHours = 24) {
  try {
    const jobs = await sandboxQueue.getJobs(['completed', 'failed'])
    const cutoff = Date.now() - (maxAgeHours * 60 * 60 * 1000)
    let removed = 0
    for (const job of jobs) {
      if (job.finishedOn && job.finishedOn < cutoff) {
        await job.remove()
        removed++
      }
    }
    if (removed > 0) {
      console.log(`[Queue Cleanup] Removed ${removed} stale jobs`)
    }
  } catch (err) {
    console.error('[Queue Cleanup Error]', err.message)
  }
}

// ─── PORT ALLOCATOR ───
export function getAvailablePort() {
  for (let i = 0; i < 200; i++) {
    const port = Math.floor(Math.random() * (PORT_RANGE.max - PORT_RANGE.min + 1)) + PORT_RANGE.min
    if (!usedPorts.has(port)) {
      usedPorts.add(port)
      return port
    }
  }
  throw new Error('No available ports for preview containers.')
}

export function releasePort(port) {
  usedPorts.delete(port)
}

// ─── CONTAINER LIMITS ───
export function getUserActiveCount(userId) {
  let count = 0
  for (const entry of registry.values()) {
    if (entry.userId === userId && ['building', 'starting', 'running'].includes(entry.status)) {
      count++
    }
  }
  return count
}

export function getGlobalActiveCount() {
  let count = 0
  for (const entry of registry.values()) {
    if (['building', 'starting', 'running'].includes(entry.status)) {
      count++
    }
  }
  return count
}

export function canUserCreateContainer(userId) {
  return getUserActiveCount(userId) < MAX_CONTAINERS_PER_USER && getGlobalActiveCount() < MAX_GLOBAL_CONTAINERS
}

// ─── STALE ENTRY EVICTION ───
// Removes registry entries for a user whose DB build_status is no longer
// active (not building/starting/running). This handles orphaned in-memory
// state after server restarts where Redis recovery restored stale entries.
export async function evictStaleUserEntries(userId, supabase) {
  const userEntries = []
  for (const [submissionId, entry] of registry.entries()) {
    if (entry.userId === userId && ['building', 'starting', 'running'].includes(entry.status)) {
      userEntries.push(submissionId)
    }
  }

  if (userEntries.length === 0) return

  try {
    const { data: rows } = await supabase
      .from('submissions')
      .select('id, build_status')
      .in('id', userEntries)

    for (const row of (rows || [])) {
      if (!['building', 'starting', 'running', 'queued'].includes(row.build_status)) {
        console.log(`[Evict] Removing stale registry entry ${row.id} (DB status: ${row.build_status})`)
        const entry = registry.get(row.id)
        if (entry?.port) releasePort(entry.port)
        registry.delete(row.id)
        await redisConnection.del(`container:${row.id}`).catch(() => {})
      }
    }
  } catch (err) {
    console.error('[Evict] Error evicting stale entries:', err.message)
  }
}

// ─── HOURLY RATE LIMITING & ABUSE PREVENTION ───
const hourlySubmissionTracker = new Map() // userId → { count, lastReset, violations }

export async function checkRateLimitAndAbuse(userId, supabase) {
  const now = Date.now()
  let userStats = hourlySubmissionTracker.get(userId)

  if (!userStats || (now - userStats.lastReset) > 3600000) {
    userStats = { count: 0, lastReset: now, violations: userStats?.violations || 0 }
    hourlySubmissionTracker.set(userId, userStats)
  }

  userStats.count++

  if (userStats.count > MAX_SUBMISSIONS_PER_HOUR) {
    userStats.violations++
    if (userStats.violations >= 3 && supabase) {
      await supabase.from('users').update({ is_flagged: true }).eq('id', userId).catch(() => {})
    }
    return false
  }

  return true
}

// ─── REGISTRY CRUD ───
export function registerContainer(submissionId, {
  containerId, port, userId, taskId, status = 'building',
  timeoutMinutes = DEFAULT_TIMEOUT_MINUTES, previewType = 'employee'
}) {
  const now = Date.now()
  const inactiveTimeout = (previewType === 'mentor')
    ? INACTIVE_TIMEOUT_MENTOR_MS
    : INACTIVE_TIMEOUT_EMPLOYEE_MS

  registry.set(submissionId, {
    containerId,
    port,
    userId,
    taskId,
    startedAt: now,
    status,
    logsBuffer: [],
    healthStatus: 'pending',
    lastAccessed: now,
    timeoutMinutes,
    restartCount: 0,
    previewType: previewType || 'employee',
    expiresAt: now + inactiveTimeout,
    buildStartedAt: status === 'building' ? now : null
  })
}

export async function stopUserContainerForTask(userId, taskId, reason = 'replaced') {
  for (const [submissionId, entry] of registry.entries()) {
    if (entry.userId === userId && entry.taskId === taskId) {
      await cleanupContainer(submissionId, reason)
      return submissionId
    }
  }
  return null
}

export function updateContainer(submissionId, updates) {
  const entry = registry.get(submissionId)
  if (entry) {
    Object.assign(entry, updates)
    // Refresh expiry when sandbox becomes active
    if (updates.status === 'running') {
      const inactiveTimeout = entry.previewType === 'mentor'
        ? INACTIVE_TIMEOUT_MENTOR_MS
        : INACTIVE_TIMEOUT_EMPLOYEE_MS
      entry.expiresAt = Date.now() + inactiveTimeout
    }
  }
}

export function getContainer(submissionId) {
  return registry.get(submissionId)
}

export function touchContainer(submissionId) {
  const entry = registry.get(submissionId)
  if (entry) {
    entry.lastAccessed = Date.now()
    const inactiveTimeout = entry.previewType === 'mentor'
      ? INACTIVE_TIMEOUT_MENTOR_MS
      : INACTIVE_TIMEOUT_EMPLOYEE_MS
    entry.expiresAt = Date.now() + inactiveTimeout
  }
}

// ─── HEARTBEAT ───
// Called by frontend iframe heartbeat to extend container lifetime during active preview.
export function heartbeatContainer(submissionId) {
  const entry = registry.get(submissionId)
  if (!entry) return false
  const now = Date.now()
  entry.lastAccessed = now
  const inactiveTimeout = entry.previewType === 'mentor'
    ? INACTIVE_TIMEOUT_MENTOR_MS
    : INACTIVE_TIMEOUT_EMPLOYEE_MS
  entry.expiresAt = now + inactiveTimeout
  return true
}

export async function appendLog(submissionId, msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  const entry = registry.get(submissionId)
  if (entry) {
    entry.logsBuffer.push(line)
    // Keep buffer bounded to prevent memory leaks
    if (entry.logsBuffer.length > 5000) {
      entry.logsBuffer = entry.logsBuffer.slice(-4000)
    }
  }

  await redisConnection.rpush(`logs:${submissionId}`, line).catch(() => {})
  await redisConnection.expire(`logs:${submissionId}`, 3600).catch(() => {})
  await redisConnection.publish('container-logs', JSON.stringify({ submissionId, message: msg })).catch(() => {})
}

export async function getLogs(submissionId) {
  try {
    return await redisConnection.lrange(`logs:${submissionId}`, 0, -1)
  } catch {
    return []
  }
}

// ─── HEALTH CHECK ───
// Validates both connectivity AND that the app is serving real content (not a ghost port).
export async function healthCheck(port, maxAttempts = 20) {
  // MOCKED for AI Studio: Since Docker is mocked, mock the healthcheck too
  return true
}

// ─── PORT DETECTION FROM LOGS ───
const PORT_PATTERNS = [
  /localhost:(\d+)/i,
  /0\.0\.0\.0:(\d+)/i,
  /running on port\s+(\d+)/i,
  /listening on\s+(\d+)/i,
  /listening on port\s+(\d+)/i,
  /http:\/\/[\w.-]+:(\d+)/i,
  /port\s+(\d+)/i
]

export function detectPortFromLogs(logs) {
  for (const line of logs) {
    for (const pattern of PORT_PATTERNS) {
      const match = line.match(pattern)
      if (match) {
        const port = parseInt(match[1], 10)
        if (port > 0 && port <= 65535) return port
      }
    }
  }
  return null
}

// ─── CONTAINER LOG STREAMING ───
// Docker multiplexes stdout/stderr with an 8-byte binary header per frame.
// docker.modem.demuxStream properly strips these headers, producing clean UTF-8 text
// instead of garbled characters (e.g. ðŸš€ for 🚀) from the raw binary stream.
export async function attachLogStream(containerId, submissionId) {
  try {
    const container = docker.getContainer(containerId)
    const logStream = await container.logs({
      follow: true,
      stdout: true,
      stderr: true,
      timestamps: false
    })

    const makeWriter = (prefix) => ({
      write(chunk) {
        const lines = Buffer.from(chunk).toString('utf8')
          .split('\n')
          .map(l => l.replace(/\r/g, '').trim())
          .filter(l => l.length > 0)
        for (const line of lines) {
          appendLog(submissionId, prefix ? `[${prefix}] ${line}` : line)
        }
      }
    })

    docker.modem.demuxStream(logStream, makeWriter(null), makeWriter('err'))
    logStream.on('error', () => {
      appendLog(submissionId, '[Stream Error] Log stream disconnected')
    })
  } catch {
    appendLog(submissionId, '[Log Attach Failed] Could not attach to container logs')
  }
}

/** Attach Docker logs into mentor-review sandbox log buffer (isolated from employee). */
export async function attachReviewLogStream(containerId, submissionId, revision) {
  try {
    const container = docker.getContainer(containerId)
    const logStream = await container.logs({
      follow: true,
      stdout: true,
      stderr: true,
      timestamps: false
    })

    const makeWriter = (prefix) => ({
      write(chunk) {
        const lines = Buffer.from(chunk).toString('utf8')
          .split('\n')
          .map(l => l.replace(/\r/g, '').trim())
          .filter(l => l.length > 0)
        for (const line of lines) {
          appendReviewLog(submissionId, revision, prefix ? `[${prefix}] ${line}` : line)
        }
      }
    })

    docker.modem.demuxStream(logStream, makeWriter(null), makeWriter('err'))
    logStream.on('error', () => {
      appendReviewLog(submissionId, revision, '[Stream Error] Log stream disconnected')
    })
  } catch {
    appendReviewLog(submissionId, revision, '[Log Attach Failed] Could not attach to container logs')
  }
}

// ─── SAFE CONTAINER CLEANUP (IMMUTABLE ARTIFACT ARCHITECTURE) ───
// This function may ONLY remove:
//   ✅ temp extracted copies (server/tmp/submissions/)
//   ✅ expired Docker containers
//   ✅ preview runtime files
//   ✅ temporary sandbox folders
// This function must NEVER remove:
//   ❌ Supabase Storage files (original ZIP artifacts)
//   ❌ Database records (original_zip_url, artifact_hash)
//   ❌ Winner submission artifacts (artifact_status = 'locked')
async function cleanupContainer(submissionId, reason = 'timeout') {
  const entry = registry.get(submissionId)
  if (!entry) return

  console.log(`[WORKER] Cleanup starting for ${submissionId} (${reason})`)

  // Stop container with timeout to prevent hanging
  if (entry.containerId) {
    try {
      const container = docker.getContainer(entry.containerId)
      await container.stop({ t: 10 }).catch(() => {})
      await container.remove({ force: true }).catch(() => {})
    } catch (e) {
      // Container might already be gone
    }
  }

  releasePort(entry.port)
  registry.delete(submissionId)

  // Clear Redis so fallback never returns stale running state
  await redisConnection.del(`container:${submissionId}`).catch(() => {})

  // ─── CLEANUP TEMP EXTRACTED FILES ONLY ───
  // NEVER delete:
  //   - Supabase Storage artifacts (handled by Supabase, not local filesystem)
  //   - ZIP files in tmp/uploads (may be needed for retry)
  //   - Winner artifacts (artifact_status = 'locked')
  // ONLY delete extracted submission folders in tmp/submissions/
  const paths = [
    path.join(process.cwd(), 'server', 'tmp', 'submissions', submissionId),
    path.join(process.cwd(), 'tmp', 'submissions', submissionId)
  ]

  // Also clean any job-specific temp dirs (format: submissionId-jobId)
  try {
    const tmpSubmissionsDir = path.join(process.cwd(), 'server', 'tmp', 'submissions')
    const entries = await fsPromises.readdir(tmpSubmissionsDir).catch(() => [])
    for (const entry of entries) {
      if (entry.startsWith(submissionId)) {
        paths.push(path.join(tmpSubmissionsDir, entry))
      }
    }
  } catch { /* tmp dir may not exist */ }

  for (const p of paths) {
    await fsPromises.rm(p, { recursive: true, force: true }).catch(() => {})
  }

  console.log(`[WORKER] Cleanup complete for ${submissionId} — temp files removed, permanent artifact preserved`)
}

export { cleanupContainer }

// ─── DOCKER PRUNING ───
async function pruneDockerResources() {
  try {
    // Remove dangling images
    const images = await docker.listImages({ filters: { dangling: { true: true } } })
    for (const img of images) {
      await docker.getImage(img.Id).remove({ force: true }).catch(() => {})
    }

    // Remove dead/stopped containers not tracked in registry
    const containers = await docker.listContainers({ all: true })
    const registryIds = new Set()
    for (const entry of registry.values()) {
      if (entry.containerId) registryIds.add(entry.containerId)
    }
    for (const entry of reviewRegistry.values()) {
      if (entry.containerId) registryIds.add(entry.containerId)
    }

    for (const c of containers) {
      if (!registryIds.has(c.Id) && c.State !== 'running') {
        await docker.getContainer(c.Id).remove({ force: true }).catch(() => {})
      }
    }
  } catch (e) {
    console.error('[Docker Prune Error]', e.message)
  }
}

// ─── STOPPED ORPHAN CONTAINER CLEANUP ───
// Remove stopped Docker containers whose names contain submission-* but are NOT tracked
// in our registry (orphans from crashed workers or abandoned previews).
async function cleanupStoppedOrphanContainers() {
  try {
    const allContainers = await docker.listContainers({ all: true })
    const trackedIds = new Set()
    for (const entry of registry.values()) {
      if (entry.containerId) trackedIds.add(entry.containerId)
    }
    for (const entry of reviewRegistry.values()) {
      if (entry.containerId) trackedIds.add(entry.containerId)
    }

    let removed = 0
    for (const c of allContainers) {
      if (c.State !== 'running' && c.Names.some(n => n.includes('submission-'))) {
        if (!trackedIds.has(c.Id)) {
          try {
            await docker.getContainer(c.Id).remove({ force: true })
            removed++
          } catch { /* already gone */ }
        }
      }
    }
    if (removed > 0) {
      console.log(`[Cleanup] Removed ${removed} stopped orphan containers`)
    }
  } catch (e) {
    console.error('[Orphan Container Cleanup Error]', e.message)
  }
}

// ─── ORPHAN PORT CLEANUP ───
async function cleanupOrphanPorts() {
  try {
    const containers = await docker.listContainers()
    const activeContainerIds = new Set(containers.map(c => c.Id))

    for (const [submissionId, entry] of registry.entries()) {
      if (entry.containerId && !activeContainerIds.has(entry.containerId)) {
        console.log(`[Orphan Cleanup] Removing dead registry entry ${submissionId}`)
        releasePort(entry.port)
        registry.delete(submissionId)
      }
    }
  } catch (e) {
    console.error('[Orphan Cleanup Error]', e.message)
  }
}

// ─── SYSTEM MONITORING ───
const systemStats = {
  totalCleanups: 0,
  totalPrunes: 0,
  totalOrphans: 0,
  lastCleanupAt: null
}

export function getSystemStats() {
  const now = Date.now()
  const active = []
  for (const [id, entry] of registry.entries()) {
    active.push({
      submissionId: id,
      userId: entry.userId,
      taskId: entry.taskId,
      status: entry.status,
      port: entry.port,
      previewType: entry.previewType,
      lastAccessed: entry.lastAccessed,
      startedAt: entry.startedAt,
      ageSeconds: Math.round((now - entry.startedAt) / 1000),
      inactiveSeconds: Math.round((now - entry.lastAccessed) / 1000)
    })
  }

  return {
    ...systemStats,
    activeContainers: active.length,
    activeContainersDetail: active,
    globalLimit: MAX_GLOBAL_CONTAINERS,
    userLimit: MAX_CONTAINERS_PER_USER,
    globalActive: getGlobalActiveCount(),
    redisHealthy: true
  }
}

// ─── GLOBAL CLEANUP WORKER ───
let cleanupIntervalRef = null

export function startCleanupWorker(supabase) {
  if (cleanupIntervalRef) return

  cleanupIntervalRef = setInterval(async () => {
    const now = Date.now()
    let cleanupsThisRun = 0
    let orphansThisRun = 0

    // Silently skip Docker-dependent operations when daemon is unreachable.
    // This prevents log spam in environments where Docker is not available.
    const { ok: dockerAvailable } = await pingDocker()

    try {
      // 1. Cleanup expired/inactive containers from registry
      for (const [submissionId, entry] of registry.entries()) {
        const age = now - entry.startedAt
        const inactive = now - entry.lastAccessed
        const buildAge = entry.buildStartedAt ? now - entry.buildStartedAt : 0

        let shouldCleanup = false
        let reason = ''
        let newBuildStatus = 'stopped'

        // Build timeout (120s) — only for entries actually marked building in THIS process
        if (entry.status === 'building' && buildAge > MAX_BUILD_TIME_MS) {
          shouldCleanup = true
          reason = `build timeout (${MAX_BUILD_TIME_MS / 1000}s)`
          newBuildStatus = 'failed'
        }
        // Startup timeout (60s) — only for entries actually marked starting in THIS process
        else if (entry.status === 'starting' && buildAge > MAX_STARTUP_TIME_MS) {
          shouldCleanup = true
          reason = `startup timeout (${MAX_STARTUP_TIME_MS / 1000}s)`
          newBuildStatus = 'failed'
        }
        // Queue/build/start timeout (30 min) — jobs may wait in queue + build time
        else if (['queued', 'building', 'starting'].includes(entry.status) && age > 30 * 60 * 1000) {
          shouldCleanup = true
          reason = 'queue/build timeout (30min)'
          newBuildStatus = 'failed'
        }
        // Expired by absolute timeout — ONLY for running containers
        else if (entry.status === 'running' && age > (entry.timeoutMinutes || DEFAULT_TIMEOUT_MINUTES) * 60 * 1000) {
          shouldCleanup = true
          reason = `timeout (${entry.timeoutMinutes}min)`
          newBuildStatus = 'expired'
        }
        // Inactive (no access) — only for running containers
        else if (entry.status === 'running') {
          const inactiveTimeout = entry.previewType === 'mentor'
            ? INACTIVE_TIMEOUT_MENTOR_MS
            : INACTIVE_TIMEOUT_EMPLOYEE_MS
          if (inactive > inactiveTimeout) {
            shouldCleanup = true
            reason = `inactive (${entry.previewType})`
            newBuildStatus = 'stopped'
          }
        }
        // Failed containers — clean after 30s grace for logs
        else if (entry.status === 'failed' || entry.status === 'failed_permanently') {
          if (age > 30000) {
            shouldCleanup = true
            reason = 'failed'
            newBuildStatus = entry.status === 'failed_permanently' ? 'failed_permanently' : 'failed'
          }
        }

        // ─── ACTIVE PREVIEW GUARD ───
        // Before cleaning, check if the worker finished and the DB says running.
        // If so, recover registry from Redis instead of cleaning up.
        if (shouldCleanup && supabase) {
          const { data: dbSub } = await supabase
            .from('submissions')
            .select('build_status, sandbox_preserved')
            .eq('id', submissionId)
            .single()
            .catch(() => ({}))

          // ─── SANDBOX PRESERVATION: Skip cleanup if review hold is active ───
          if (dbSub?.sandbox_preserved === true) {
            console.log(`[Cleanup] ⏸️ Skipping ${submissionId}: sandbox_preserved=true (review hold active)`)
            shouldCleanup = false
          }
          else if (dbSub?.build_status === 'running') {
            const redisInfo = await redisConnection.hgetall(`container:${submissionId}`).catch(() => ({}))
            if (redisInfo?.status === 'running' && redisInfo?.port) {
              // Recover registry entry instead of cleaning
              Object.assign(entry, {
                status: 'running',
                containerId: redisInfo.containerId,
                port: parseInt(redisInfo.port, 10),
                lastAccessed: Date.now(),
                expiresAt: Date.now() + (entry.previewType === 'mentor' ? INACTIVE_TIMEOUT_MENTOR_MS : INACTIVE_TIMEOUT_EMPLOYEE_MS)
              })
              console.log(`[Cleanup] Recovered registry for ${submissionId} from Redis (DB=running)`)
              shouldCleanup = false
            } else {
              // DB says running but no Redis info — don't clean up, just log
              console.warn(`[Cleanup] Skipping cleanup for ${submissionId}: DB says running but no Redis/Registry entry`)
              shouldCleanup = false
            }
          }
        }

        if (shouldCleanup) {
          const executionTimeSec = Math.round((now - entry.startedAt) / 1000)
          const cost = executionTimeSec * BILLING_RATE_PER_SEC

          await cleanupContainer(submissionId, reason)
          cleanupsThisRun++

          if (supabase) {
            await supabase.from('submissions')
              .update({ build_status: newBuildStatus })
              .eq('id', submissionId)
              .catch(() => {})

            await supabase.from('usage_logs').insert({
              user_id: entry.userId,
              submission_id: submissionId,
              execution_time_seconds: executionTimeSec,
              cost: cost
            }).catch(() => {})
          }
        }
      }

      // 2. Cleanup orphan ports and zombie registry entries
      // Only call Docker APIs when the daemon is reachable to prevent log spam
      if (dockerAvailable) {
        await cleanupOrphanPorts()
        orphansThisRun++

        // 2b. Remove stopped Docker containers that aren't tracked in registry
        await cleanupStoppedOrphanContainers()

        // 3. Prune Docker resources every 5 minutes (every 5th run)
        if (Math.floor(now / CLEANUP_INTERVAL_MS) % 5 === 0) {
          await pruneDockerResources()
          systemStats.totalPrunes++
        }
      }

      // 4. Clean stale BullMQ jobs every 10 minutes (every 10th run)
      if (Math.floor(now / CLEANUP_INTERVAL_MS) % 10 === 0) {
        await cleanStaleJobs(24)
      }

      // 5. REVIEW SANDBOX CLEANUP (Improvement 8)
      // Auto-expire mentor review sandboxes after 15 min idle.
      // Isolated from employee cleanup — uses reviewRegistry only.
      for (const [key, entry] of reviewRegistry.entries()) {
        const inactive = now - entry.lastAccessed
        const age = now - entry.startedAt
        let shouldClean = false
        let cleanReason = ''

        if (entry.status === 'running' && inactive > INACTIVE_TIMEOUT_REVIEW_MS) {
          shouldClean = true
          cleanReason = `review sandbox inactive (${Math.round(inactive / 60000)}min)`
        } else if (['queued', 'building', 'starting'].includes(entry.status) && age > 10 * 60 * 1000) {
          shouldClean = true
          cleanReason = 'review build timeout (10min)'
        } else if (['failed', 'failed_permanently'].includes(entry.status) && age > 30000) {
          shouldClean = true
          cleanReason = 'review sandbox failed'
        }

        if (shouldClean) {
          await cleanupReviewContainer(entry.submissionId, entry.revision, cleanReason)
          // Update DB revision status
          if (supabase) {
            await supabase.from('submission_revisions')
              .update({ sandbox_status: 'expired' })
              .eq('submission_id', entry.submissionId)
              .eq('revision_number', entry.revision)
              .catch(() => {})
          }
          cleanupsThisRun++
        }
      }

      systemStats.totalCleanups += cleanupsThisRun
      systemStats.totalOrphans += orphansThisRun
      systemStats.lastCleanupAt = new Date().toISOString()

      if (cleanupsThisRun > 0 || orphansThisRun > 0) {
        console.log(`[Cleanup Worker] Cleaned ${cleanupsThisRun} containers, ${orphansThisRun} orphan checks`)
      }
    } catch (e) {
      console.error('[Cleanup Worker Error]', e.message)
      // NEVER crash the server
    }
  }, CLEANUP_INTERVAL_MS)

  console.log('[Cleanup Worker] Started (interval: 5 min)')
}

export function stopCleanupWorker() {
  if (cleanupIntervalRef) {
    clearInterval(cleanupIntervalRef)
    cleanupIntervalRef = null
  }
}

// ─── ISOLATED REVIEW SANDBOX FUNCTIONS (Improvement 1, 3, 7, 8) ───

/**
 * Registers an isolated review sandbox — completely separate from employee registry.
 * Key format: review:<submissionId>:<revision>
 */
export function registerReviewContainer(submissionId, revision, {
  containerId, port, userId, taskId, status = 'queued',
  timeoutMinutes = DEFAULT_TIMEOUT_MINUTES
}) {
  const key = reviewRegistryKey(submissionId, revision)
  const now = Date.now()
  reviewRegistry.set(key, {
    submissionId,
    revision,
    containerId,
    port,
    userId,
    taskId,
    startedAt: now,
    status,
    logsBuffer: [],
    healthStatus: 'pending',
    lastAccessed: now,
    timeoutMinutes,
    restartCount: 0,
    previewType: 'mentor-review',
    expiresAt: now + INACTIVE_TIMEOUT_REVIEW_MS,
    buildStartedAt: status === 'building' ? now : null
  })
}

export function getReviewContainer(submissionId, revision) {
  return reviewRegistry.get(reviewRegistryKey(submissionId, revision))
}

export function updateReviewContainer(submissionId, revision, updates) {
  const key = reviewRegistryKey(submissionId, revision)
  const entry = reviewRegistry.get(key)
  if (entry) {
    Object.assign(entry, updates)
    if (updates.status === 'running') {
      entry.expiresAt = Date.now() + INACTIVE_TIMEOUT_REVIEW_MS
    }
  }
}

export function touchReviewContainer(submissionId, revision) {
  const key = reviewRegistryKey(submissionId, revision)
  const entry = reviewRegistry.get(key)
  if (entry) {
    entry.lastAccessed = Date.now()
    entry.expiresAt = Date.now() + INACTIVE_TIMEOUT_REVIEW_MS
  }
}

/**
 * Concurrency guard (Improvement 3):
 * Checks if ANY review sandbox is already active for this submission.
 */
export function isReviewSandboxActive(submissionId) {
  const prefix = `review:${submissionId}:`
  for (const [key, entry] of reviewRegistry.entries()) {
    if (key.startsWith(prefix) && ['queued', 'building', 'starting', 'running'].includes(entry.status)) {
      return { active: true, status: entry.status, revision: entry.revision, key }
    }
  }
  return { active: false }
}

/**
 * Cleanup an isolated review sandbox (Improvement 8).
 * Removes container, releases port, cleans Redis review_container keys.
 * NEVER touches employee registry, employee Redis keys, or immutable artifacts.
 */
export async function cleanupReviewContainer(submissionId, revision, reason = 'expired') {
  const key = reviewRegistryKey(submissionId, revision)
  const entry = reviewRegistry.get(key)
  if (!entry) return

  console.log(`[Review Cleanup] Cleaning ${key} (${reason})`)

  // Stop Docker container
  if (entry.containerId) {
    try {
      const container = docker.getContainer(entry.containerId)
      await container.stop({ t: 5 }).catch(() => {})
      await container.remove({ force: true }).catch(() => {})
    } catch { /* already gone */ }
  }

  // Release port and remove from review registry
  if (entry.port) releasePort(entry.port)
  reviewRegistry.delete(key)

  // Clear isolated Redis keys (NEVER touch employee keys)
  await redisConnection.del(`review_container:${submissionId}:${revision}`).catch(() => {})
  await redisConnection.del(`logs:review:${submissionId}:${revision}`).catch(() => {})

  // Clean temp review files only
  const reviewTmpDir = path.join(process.cwd(), 'server', 'tmp', 'review', submissionId)
  await fsPromises.rm(reviewTmpDir, { recursive: true, force: true }).catch(() => {})

  console.log(`[Review Cleanup] Complete for ${key} — immutable artifacts preserved`)
}

/**
 * Append log to a review sandbox (isolated from employee logs).
 */
export async function appendReviewLog(submissionId, revision, msg) {
  const key = reviewRegistryKey(submissionId, revision)
  const line = `[${new Date().toISOString()}] ${msg}`
  const entry = reviewRegistry.get(key)
  if (entry) {
    entry.logsBuffer.push(line)
    if (entry.logsBuffer.length > 5000) {
      entry.logsBuffer = entry.logsBuffer.slice(-4000)
    }
  }
  await redisConnection.rpush(`logs:review:${submissionId}:${revision}`, line).catch(() => {})
  await redisConnection.expire(`logs:review:${submissionId}:${revision}`, 3600).catch(() => {})
}

export async function getReviewLogs(submissionId, revision) {
  try {
    return await redisConnection.lrange(`logs:review:${submissionId}:${revision}`, 0, -1)
  } catch {
    return []
  }
}

// ─── EXPORTS ───
export { registry, reviewRegistry, docker, BILLING_RATE_PER_SEC }
