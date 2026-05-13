/**
 * Centralized Execution State Manager
 * Single source of truth for all sandbox execution state.
 * Persists to Redis + DB. Enforces state machine transitions.
 * Provides per-submission Redis locks to prevent race conditions.
 */

import { redisConnection } from './containerManager.js'

// ─── STATE MACHINE ───
// Valid states and allowed transitions
export const STATES = {
  UPLOADED: 'uploaded',
  QUEUED: 'queued',
  EXTRACTING: 'extracting',
  VALIDATING: 'validating',
  BUILDING: 'building',
  STARTING: 'starting',
  HEALTH_CHECK: 'health_check',
  RUNNING: 'running',
  FAILED: 'failed',
  FAILED_PERMANENTLY: 'failed_permanently',
  EXPIRED: 'expired',
  STOPPED: 'stopped',
  CLEANUP: 'cleanup'
}

const VALID_TRANSITIONS = {
  uploaded:          ['queued', 'failed'],
  queued:            ['extracting', 'building', 'failed', 'stopped'],
  extracting:        ['validating', 'failed'],
  validating:        ['building', 'failed'],
  building:          ['starting', 'failed', 'failed_permanently'],
  starting:          ['health_check', 'failed', 'failed_permanently'],
  health_check:      ['running', 'failed', 'failed_permanently'],
  running:           ['stopped', 'expired', 'failed', 'cleanup'],
  failed:            ['queued', 'cleanup'],
  failed_permanently:['cleanup'],
  expired:           ['queued', 'cleanup'],
  stopped:           ['queued', 'cleanup'],
  cleanup:           []
}

// Redis key prefix
const KEY = (id) => `exec:${id}`
const LOCK_KEY = (id) => `lock:submission:${id}`

// Lock TTL — max time a worker can hold a lock (seconds)
const LOCK_TTL_SECONDS = 180

/**
 * Acquire a per-submission Redis lock.
 * Returns true if lock acquired, false if already locked by another process.
 */
export async function acquireLock(submissionId, ttlSeconds = LOCK_TTL_SECONDS) {
  try {
    const result = await redisConnection.set(
      LOCK_KEY(submissionId),
      String(process.pid),
      'NX',
      'EX',
      ttlSeconds
    )
    const acquired = result === 'OK'
    if (acquired) {
      console.log(`[Lock] Acquired lock:submission:${submissionId} PID=${process.pid}`)
    } else {
      const holder = await redisConnection.get(LOCK_KEY(submissionId)).catch(() => 'unknown')
      console.log(`[Lock] BLOCKED lock:submission:${submissionId} — held by PID=${holder}`)
    }
    return acquired
  } catch (err) {
    console.error('[Lock] acquireLock error:', err.message)
    return true // If Redis down, allow through (graceful degradation)
  }
}

/**
 * Release a per-submission Redis lock.
 */
export async function releaseLock(submissionId) {
  try {
    await redisConnection.del(LOCK_KEY(submissionId))
    console.log(`[Lock] Released lock:submission:${submissionId}`)
  } catch (err) {
    console.error('[Lock] releaseLock error:', err.message)
  }
}

/**
 * Persist execution state to Redis.
 * Redis is the fast shared store between server and worker processes.
 */
export async function persistToRedis(submissionId, data) {
  try {
    const payload = {}
    for (const [k, v] of Object.entries(data)) {
      if (v !== undefined && v !== null) payload[k] = String(v)
    }
    if (Object.keys(payload).length === 0) return
    await redisConnection.hmset(KEY(submissionId), payload)
    await redisConnection.expire(KEY(submissionId), 7200) // 2 hours TTL
  } catch (err) {
    console.error(`[ESM] Redis persist error for ${submissionId}:`, err.message)
  }
}

/**
 * Get execution state from Redis.
 */
export async function getFromRedis(submissionId) {
  try {
    const data = await redisConnection.hgetall(KEY(submissionId))
    if (!data || Object.keys(data).length === 0) return null
    return {
      status: data.status,
      previewUrl: data.previewUrl,
      containerId: data.containerId,
      port: data.port ? parseInt(data.port, 10) : null,
      restartCount: data.restartCount ? parseInt(data.restartCount, 10) : 0,
      updatedAt: data.updatedAt ? parseInt(data.updatedAt, 10) : null,
      lastAccessed: data.lastAccessed ? parseInt(data.lastAccessed, 10) : null,
      userId: data.userId,
      taskId: data.taskId
    }
  } catch {
    return null
  }
}

/**
 * Update execution state — validates transition, persists to Redis and DB.
 * This is the ONLY function that should change execution state.
 */
export async function setState(submissionId, newState, extra = {}, supabase = null) {
  const currentRedis = await getFromRedis(submissionId)
  const currentState = currentRedis?.status

  // Validate transition if we have a current state
  if (currentState && currentState !== newState) {
    const allowed = VALID_TRANSITIONS[currentState] || []
    if (!allowed.includes(newState)) {
      console.warn(`[ESM] ILLEGAL transition ${currentState} → ${newState} for ${submissionId}. Allowing anyway.`)
    } else {
      console.log(`[ESM] State: ${currentState} → ${newState} [${submissionId}]`)
    }
  } else {
    console.log(`[ESM] State: (${currentState || 'none'}) → ${newState} [${submissionId}]`)
  }

  const now = Date.now()

  // Build Redis payload
  const redisPayload = {
    status: newState,
    updatedAt: now,
    ...extra
  }

  // Persist to Redis immediately
  await persistToRedis(submissionId, redisPayload)

  // Also persist to legacy container: key for backwards compatibility
  if (extra.port || extra.containerId || extra.previewUrl) {
    try {
      const legacyPayload = {}
      if (extra.containerId) legacyPayload.containerId = extra.containerId
      if (extra.port) legacyPayload.port = String(extra.port)
      if (extra.previewUrl) legacyPayload.previewUrl = extra.previewUrl
      legacyPayload.status = newState
      legacyPayload.updatedAt = String(now)
      await redisConnection.hmset(`container:${submissionId}`, legacyPayload)
      await redisConnection.expire(`container:${submissionId}`, 7200)
    } catch {}
  }

  // Persist to DB when state matters for the frontend
  if (supabase) {
    const DB_STATES = ['queued', 'extracting', 'validating', 'building', 'starting',
                       'health_check', 'running', 'failed', 'failed_permanently', 'expired', 'stopped']
    if (DB_STATES.includes(newState)) {
      const dbUpdate = { build_status: newState }
      if (extra.previewUrl !== undefined) dbUpdate.preview_url = extra.previewUrl
      if (extra.runtimeType !== undefined) dbUpdate.runtime_type = extra.runtimeType
      if (extra.logs !== undefined) dbUpdate.logs = extra.logs

      const { error } = await supabase
        .from('submissions')
        .update(dbUpdate)
        .eq('id', submissionId)

      if (error) {
        console.error(`[ESM] DB update failed for ${submissionId} state=${newState}:`, error.message)
      }
    }
  }

  return { submissionId, state: newState, ...extra }
}

/**
 * Touch last_accessed (for heartbeat / keep-alive).
 */
export async function touchLastAccessed(submissionId) {
  try {
    await redisConnection.hset(KEY(submissionId), 'lastAccessed', String(Date.now()))
  } catch {}
}

/**
 * Get the effective status of a submission from all sources.
 * Priority: Redis exec: key > legacy container: key > fallback
 */
export async function getEffectiveState(submissionId) {
  const redisState = await getFromRedis(submissionId)
  if (redisState?.status) {
    return redisState
  }

  // Fallback to legacy container: key
  try {
    const legacy = await redisConnection.hgetall(`container:${submissionId}`)
    if (legacy?.status) {
      return {
        status: legacy.status,
        previewUrl: legacy.previewUrl,
        containerId: legacy.containerId,
        port: legacy.port ? parseInt(legacy.port, 10) : null
      }
    }
  } catch {}

  return null
}

/**
 * Clear all execution state for a submission (on cleanup).
 */
export async function clearState(submissionId) {
  try {
    await redisConnection.del(KEY(submissionId))
    await redisConnection.del(LOCK_KEY(submissionId))
    await redisConnection.del(`container:${submissionId}`)
    await redisConnection.del(`logs:${submissionId}`)
    console.log(`[ESM] Cleared all state for ${submissionId}`)
  } catch (err) {
    console.error(`[ESM] clearState error for ${submissionId}:`, err.message)
  }
}

/**
 * Recover all running submissions from Redis on server restart.
 * Returns array of { submissionId, state }
 */
export async function recoverRunningFromRedis() {
  try {
    const keys = await redisConnection.keys('exec:*')
    const running = []
    for (const key of keys) {
      const submissionId = key.replace('exec:', '')
      const data = await getFromRedis(submissionId)
      if (data?.status === 'running' && data?.port) {
        running.push({ submissionId, ...data })
      }
    }
    if (running.length > 0) {
      console.log(`[ESM] Recovered ${running.length} running submissions from Redis`)
    }
    return running
  } catch (err) {
    console.error('[ESM] recoverRunningFromRedis error:', err.message)
    return []
  }
}

/**
 * Human-readable label for each state — used by frontend.
 */
export function getStateLabel(state) {
  const labels = {
    uploaded:          'Uploading ZIP...',
    queued:            'Waiting in Queue...',
    extracting:        'Extracting Files...',
    validating:        'Validating Project...',
    building:          'Building Container...',
    starting:          'Starting Runtime...',
    health_check:      'Checking Health...',
    running:           'Live Preview',
    failed:            'Build Failed',
    failed_permanently:'Build Failed',
    expired:           'Session Expired',
    stopped:           'Session Ended',
    cleanup:           'Cleaning Up...'
  }
  return labels[state] || state || 'Unknown'
}
