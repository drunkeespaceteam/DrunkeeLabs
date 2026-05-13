import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'
import fs from 'fs'
import fsPromises from 'fs/promises'
import { fileURLToPath } from 'url'
import archiver from 'archiver'
import * as cm from './containerManager.js'
import { docker, pingDocker } from './dockerClient.js'
import { extractZipSafe, prepareProject, buildImage, runContainer, imageExists, removeOldContainersForSubmission, removeOldReviewContainersForRevision, normalizeProjectEncoding } from './sandbox.js'
import { classifyBuildError, formatDiagnosticLog } from './buildDiagnostics.js'
import { acquireLock, releaseLock, setState, persistToRedis, clearState } from './executionStateManager.js'
import { createConnection, validateRedisOnStartup, buildConnectionOptions } from './redisClient.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const envResult = dotenv.config({ path: path.join(__dirname, '.env') })
if (envResult.error) {
  dotenv.config({ path: path.join(__dirname, '..', '.env') })
}

// ─── WORKER SINGLETON GUARD ───
const LOCK_FILE = path.join(__dirname, '.worker.lock')
async function acquireWorkerLock() {
  try {
    const stat = await fsPromises.stat(LOCK_FILE)
    const age = Date.now() - stat.mtimeMs
    if (age > 30000) {
      await fsPromises.writeFile(LOCK_FILE, String(process.pid))
      console.log(`[Worker] Acquired stale lock (previous pid dead). PID=${process.pid}`)
      return true
    }
    const pid = await fsPromises.readFile(LOCK_FILE, 'utf8')
    console.log(`[Worker] Another worker already running (PID=${pid.trim()}). Exiting.`)
    process.exit(0)
  } catch {
    await fsPromises.writeFile(LOCK_FILE, String(process.pid))
    console.log(`[Worker] Lock acquired. PID=${process.pid}`)
    return true
  }
}
async function releaseWorkerLock() {
  try { await fsPromises.unlink(LOCK_FILE) } catch {}
}
process.on('exit', releaseWorkerLock)
process.on('SIGINT', () => { releaseWorkerLock(); process.exit(0) })
process.on('SIGTERM', () => { releaseWorkerLock(); process.exit(0) })

await acquireWorkerLock()

// ─── SNAPSHOT HELPER ───
// Creates a permanent snapshot from the original submitted ZIP file.
// Does NOT require Docker — runs before any container work.
// Uses the original uploaded ZIP (from local disk or Supabase Storage),
// uploads it to the submission-zips bucket, and saves the public URL to DB.
async function createSubmissionSnapshot(submissionId, localZipPath, taskId, userId, supabase) {
  console.log(`[SNAPSHOT] Creating ZIP for submission ${submissionId}...`)

  let zipBuffer = null

  // Try local ZIP first (fastest path)
  if (localZipPath) {
    try {
      await fsPromises.access(localZipPath)
      zipBuffer = await fsPromises.readFile(localZipPath)
      console.log(`[SNAPSHOT] Using local ZIP: ${localZipPath}`)
    } catch {
      console.log(`[SNAPSHOT] Local ZIP not accessible, will download from Supabase Storage...`)
    }
  }

  // Fall back to downloading original ZIP from Supabase Storage
  if (!zipBuffer) {
    const storagePath = `${taskId}/${userId}/${submissionId}.zip`
    console.log(`[SNAPSHOT] Downloading source ZIP from submissions/${storagePath}...`)
    const { data: zipBlob, error: dlErr } = await supabase.storage
      .from('submissions')
      .download(storagePath)
    if (dlErr || !zipBlob) {
      throw new Error(`Could not retrieve source ZIP: ${dlErr?.message || 'download failed'}`)
    }
    const arrayBuffer = await zipBlob.arrayBuffer()
    zipBuffer = Buffer.from(arrayBuffer)
    console.log(`[SNAPSHOT] ZIP created — ${zipBuffer.length} bytes`)
  } else {
    console.log(`[SNAPSHOT] ZIP created — ${zipBuffer.length} bytes`)
  }

  // Upload to permanent submission-zips bucket
  console.log(`[SNAPSHOT] Uploading to Supabase submission-zips bucket...`)
  const { error: uploadError } = await supabase.storage
    .from('submission-zips')
    .upload(`${submissionId}.zip`, zipBuffer, { contentType: 'application/zip', upsert: true })

  if (uploadError) throw new Error(`Snapshot upload failed: ${uploadError.message}`)

  const { data: { publicUrl } } = supabase.storage
    .from('submission-zips')
    .getPublicUrl(`${submissionId}.zip`)

  console.log(`[SNAPSHOT] Upload success — public URL: ${publicUrl}`)
  return publicUrl
}

// Initialize Supabase for the worker
const supabaseKey = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
const supabaseUrl = process.env.SUPABASE_URL || 'https://placeholder.supabase.co'
const supabase = createClient(supabaseUrl, supabaseKey)

console.log('[Worker] Sandbox Execution Worker starting...')
console.log(`[Worker] Instance PID=${process.pid} concurrency=2`)

// ─── STARTUP REDIS VALIDATION ───
// Validation removed at top level to fix circular dependency

// ─── STARTUP DOCKER CONNECTIVITY CHECK ───
const startupPing = await pingDocker()
if (startupPing.ok) {
  console.log(`[Docker] Connected — socketPath=${startupPing.socketPath || 'default'}`)
} else {
  console.warn(`[Docker] WARNING: Docker daemon unreachable at startup — socketPath=${startupPing.socketPath} code=${startupPing.code} error=${startupPing.error}`)
  console.warn(`[Docker] Submissions will be marked failed_permanently until Docker is available.`)
}

/**
 * Isolated mentor revision sandbox — does not mutate submissions.build_status or employee registry.
 */
async function processMentorReviewTestJob(jobData) {
  const { submissionId, userId, taskId, zipPath, revisionNumber, revisionId } = jobData
  const revNum = Number(revisionNumber)
  if (!submissionId || !revisionId || !Number.isFinite(revNum)) {
    console.error('[Review Worker] Invalid job payload', jobData)
    return { success: false, message: 'Invalid mentor-review job' }
  }

  console.log(`[Review Worker] Processing ${submissionId} revision v${revNum}...`)

  const dockerPing = await pingDocker()
  if (!dockerPing.ok) {
    const errMsg = `Docker daemon unreachable [${dockerPing.code}]: ${dockerPing.error}`
    await cm.appendReviewLog(submissionId, revNum, errMsg)
    await supabase.from('submission_revisions').update({
      sandbox_status: 'failed',
      build_logs: errMsg,
      error_category: 'docker_error',
      error_suggestion: 'System issue — try again later'
    }).eq('id', revisionId)
    cm.updateReviewContainer(submissionId, revNum, { status: 'failed' })
    return { success: false, message: errMsg }
  }

  const processingKey = `processing:review:${submissionId}:${revNum}`
  const alreadyProcessing = await cm.redisConnection.get(processingKey).catch(() => null)
  if (alreadyProcessing) {
    console.log(`[Review Worker] Skip — already processing (PID=${alreadyProcessing})`)
    return { success: true, message: 'Already processing' }
  }
  await cm.redisConnection.set(processingKey, String(process.pid), 'EX', 600).catch(() => {})

  await removeOldReviewContainersForRevision(submissionId, revNum)

  const appendLog = (msg) => {
    cm.appendReviewLog(submissionId, revNum, msg)
    console.log(`[Review ${submissionId}:v${revNum}] ${msg}`)
  }

  const previewPath = `/preview/review/${submissionId}/${revNum}`
  const imageTag = `submission-${submissionId}-rev-${revNum}:v1`
  const containerName = `submission-${submissionId}-rev-${revNum}-${Date.now()}`
  const targetDir = path.join(__dirname, 'tmp', 'review', submissionId, `extract-rev${revNum}`)

  let containerId = null
  let hostPort = null
  let phase = 'queued'

  const failRevision = async (err, errPhase) => {
    const logsArr = await cm.getReviewLogs(submissionId, revNum)
    const diagnosis = classifyBuildError(err?.message || String(err), errPhase || phase, logsArr || [])
    const extra = formatDiagnosticLog(diagnosis)
    for (const line of extra) {
      if (line.trim()) await cm.appendReviewLog(submissionId, revNum, line)
    }
    const fullLogs = [...logsArr, ...extra].join('\n')
    const suggestionText = diagnosis.suggestions.slice(0, 5).join(' · ')
    await supabase.from('submission_revisions').update({
      sandbox_status: 'failed',
      build_logs: fullLogs,
      error_category: diagnosis.category,
      error_suggestion: suggestionText,
      preview_url: null
    }).eq('id', revisionId)
    cm.updateReviewContainer(submissionId, revNum, { status: 'failed' })
    if (hostPort) cm.releasePort(hostPort)
    if (containerId) {
      try {
        const c = docker.getContainer(containerId)
        await c.stop({ t: 3 }).catch(() => {})
        await c.remove({ force: true }).catch(() => {})
      } catch { /* */ }
    }
  }

  try {
    phase = 'extracting'
    cm.updateReviewContainer(submissionId, revNum, { status: 'building', buildStartedAt: Date.now() })
    await supabase.from('submission_revisions').update({ sandbox_status: 'building' }).eq('id', revisionId)

    let localZipPath = zipPath
    try {
      await fsPromises.access(localZipPath)
    } catch {
      appendLog('ZIP missing at expected path')
      throw new Error('Revision ZIP not found on server')
    }

    await fsPromises.rm(targetDir, { recursive: true, force: true }).catch(() => {})
    await extractZipSafe(localZipPath, targetDir)
    await normalizeProjectEncoding(targetDir)

    phase = 'validating'
    const extractedFiles = await fsPromises.readdir(targetDir).catch(() => [])
    if (extractedFiles.length === 0) {
      appendLog('[VALIDATION] FAILED: Empty or corrupted archive')
      throw new Error('Validation failed: ZIP archive is empty or corrupted.')
    }

    let runtimeType, internalPort, prepResult
    try {
      prepResult = await prepareProject(targetDir, `${submissionId}-rev${revNum}`)
      runtimeType = prepResult.type
      internalPort = prepResult.port
    } catch (validationErr) {
      appendLog(`[VALIDATION] FAILED: ${validationErr.message}`)
      throw validationErr
    }

    appendLog(`[VALIDATION] Passed — ${runtimeType}`)

    phase = 'building'
    if (await imageExists(imageTag)) {
      appendLog('Docker image already exists. Skipping rebuild.')
    } else {
      appendLog(`Building Docker image (${runtimeType})...`)
      await buildImage(targetDir, imageTag, (log) => {
        if (log.trim()) appendLog(log.trim())
      })
      appendLog('Image built successfully.')
    }

    phase = 'starting'
    hostPort = cm.getAvailablePort()
    appendLog(`Starting container on host port ${hostPort} (internal: ${internalPort})...`)
    const container = await runContainer(imageTag, containerName, hostPort, internalPort, {
      'nexusdev.submissionId': submissionId,
      'nexusdev.userId': userId,
      'nexusdev.taskId': taskId,
      'nexusdev.reviewRevision': String(revNum)
    })
    containerId = container.id
    cm.updateReviewContainer(submissionId, revNum, { containerId, port: hostPort, status: 'starting' })
    cm.attachReviewLogStream(containerId, submissionId, revNum)

    phase = 'health_check'
    appendLog('Running health check...')
    const isHealthy = await cm.healthCheck(hostPort)
    if (!isHealthy) {
      appendLog('Health check failed: App did not respond on assigned port within 20s.')
      throw new Error('Health check failed')
    }

    appendLog('Container is healthy. Review preview is ready.')
    cm.updateReviewContainer(submissionId, revNum, {
      status: 'running',
      containerId,
      port: hostPort
    })

    await cm.redisConnection.hmset(`review_container:${submissionId}:${revNum}`, {
      containerId,
      port: String(hostPort),
      previewUrl: previewPath,
      status: 'running',
      dockerImageTag: imageTag,
      updatedAt: String(Date.now())
    }).catch((err) => console.error(`[Review Worker Redis] ${submissionId}:v${revNum}`, err.message))
    await cm.redisConnection.expire(`review_container:${submissionId}:${revNum}`, 3600).catch(() => {})

    const logsArr = await cm.getReviewLogs(submissionId, revNum)
    const logsText = Array.isArray(logsArr) ? logsArr.join('\n') : ''

    await supabase.from('submission_revisions').update({
      sandbox_status: 'running',
      preview_url: previewPath,
      build_logs: logsText,
      error_category: null,
      error_suggestion: null
    }).eq('id', revisionId)

    await cm.redisConnection.del(processingKey).catch(() => {})
    console.log(`[Review Worker] COMPLETE ${submissionId}:v${revNum} port=${hostPort}`)
    return { success: true, previewUrl: previewPath, hostPort }
  } catch (err) {
    console.error(`[Review Worker Error ${submissionId}:v${revNum}]`, err)
    await failRevision(err, phase)
    await cm.redisConnection.del(processingKey).catch(() => {})
    return { success: false, message: err?.message }
  } finally {
    await fsPromises.rm(targetDir, { recursive: true, force: true }).catch(() => {})
  }
}

export async function processJob(jobData) {
  if (jobData.source === 'mentor-review-test') {
    return processMentorReviewTestJob(jobData)
  }

  const job = { data: jobData, id: jobData.submissionId }
  const { submissionId, userId, taskId, zipPath, taskTimeout } = job.data

  console.log(`[Worker] Processing submission ${submissionId}...`)

  // ─── DOCKER CONNECTIVITY PRE-FLIGHT ───
  // If Docker is unavailable, we still try to snapshot the source ZIP so
  // the mentor can always download the submission — then fail permanently.
  const dockerPing = await pingDocker()
  if (!dockerPing.ok) {
    const errMsg = `Docker daemon unreachable [${dockerPing.code}]: ${dockerPing.error} (socketPath=${dockerPing.socketPath})`
    console.error(`[Worker] ${errMsg}`)

    // Attempt snapshot even though Docker is unavailable
    try {
      console.log(`[SNAPSHOT] Docker unavailable — creating snapshot from uploaded ZIP anyway...`)
      const snapshotUrl = await createSubmissionSnapshot(submissionId, zipPath, taskId, userId, supabase)
      console.log(`[SNAPSHOT] Database updated`)
      await supabase.from('submissions').update({
        build_status: 'failed_permanently',
        logs: errMsg,
        source_zip_url: snapshotUrl,
        snapshot_status: 'saved'
      }).eq('id', submissionId)
      console.log(`[SNAPSHOT] Mentor download ready`)
    } catch (snapErr) {
      console.warn(`[SNAPSHOT] Snapshot failed (non-critical):`, snapErr.message)
      try {
        await supabase.from('submissions').update({
          build_status: 'failed_permanently',
          logs: errMsg,
          snapshot_status: 'failed'
        }).eq('id', submissionId)
      } catch (_) {}
    }

    return { success: false, message: errMsg, dockerUnreachable: true }
  }

  // ─── PER-SUBMISSION REDIS LOCK ───
  const lockAcquired = await acquireLock(submissionId, 300)
  if (!lockAcquired) {
    console.log(`[Worker] Submission ${submissionId} locked by another worker. Skipping.`)
    return { success: true, message: 'Locked by another worker' }
  }

  // ─── ATOMIC DB CLAIM ───
  const { data: claimed } = await supabase
    .from('submissions')
    .update({ build_status: 'building' })
    .eq('id', submissionId)
    .in('build_status', ['queued', 'stopped', 'failed', 'failed_permanently', 'expired'])
    .select()
    .maybeSingle()

  if (!claimed) {
    await releaseLock(submissionId)
    console.log(`[Worker] Submission ${submissionId} already claimed or not ready. Skipping.`)
    return { success: true, message: 'Already claimed or not ready' }
  }

  // The registry already has a reservation from the API endpoint.
  // We rely on the atomic DB claim and Redis locks above to prevent duplicates.

  // ─── REDIS PROCESSING GUARD ───
  const processingKey = `processing:${submissionId}`
  const alreadyProcessing = await cm.redisConnection.get(processingKey).catch(() => null)
  if (alreadyProcessing) {
    await releaseLock(submissionId)
    console.log(`[Worker] Submission ${submissionId} already being processed (Redis guard PID=${alreadyProcessing}). Skipping.`)
    return { success: true, message: 'Already processing (Redis guard)' }
  }
  await cm.redisConnection.set(processingKey, String(process.pid), 'EX', 600).catch(() => {})

  await removeOldContainersForSubmission(submissionId)

  const appendLog = (msg) => {
    cm.appendLog(submissionId, msg)
    console.log(`[Submission ${submissionId}] ${msg}`)
  }

  const stablePreviewUrl = `/preview/${submissionId}`

  let containerId = null
  let hostPort = null
  const targetDir = path.join(__dirname, 'tmp', 'submissions', `${submissionId}-${job.id}`)
  let localZipPath = zipPath
  let workerPhase = 'extracting'

  try {
    // ── PHASE: extracting ──
    await setState(submissionId, 'extracting', { userId, taskId }, supabase)
    cm.updateContainer(submissionId, { status: 'extracting' })

    // If local ZIP is missing, download from Supabase Storage
    try {
      await fsPromises.access(localZipPath)
    } catch {
      appendLog('Local ZIP missing — downloading from persistent storage...')
      const storagePath = `${taskId}/${userId}/${submissionId}.zip`
      const { data: zipBlob, error: dlErr } = await supabase.storage
        .from('submissions')
        .download(storagePath)
      if (dlErr || !zipBlob) {
        throw new Error(`ZIP file not found locally or in storage: ${dlErr?.message || 'download failed'}`)
      }
      const tmpDir = path.join(__dirname, 'tmp', 'uploads')
      await fsPromises.mkdir(tmpDir, { recursive: true })
      localZipPath = path.join(tmpDir, `${submissionId}.zip`)
      const arrayBuffer = await zipBlob.arrayBuffer()
      await fsPromises.writeFile(localZipPath, Buffer.from(arrayBuffer))
      appendLog('Downloaded ZIP from persistent storage.')
    }

    // ── PHASE: snapshot (BEFORE Docker — guaranteed to run regardless of Docker status) ──
    // This is intentionally early so mentors can always download source code
    // even if the container build fails later.
    console.log(`[SNAPSHOT] Creating ZIP...`)
    appendLog('Creating permanent source snapshot...')
    try {
      const snapshotUrl = await createSubmissionSnapshot(submissionId, localZipPath, taskId, userId, supabase)
      await supabase.from('submissions').update({
        source_zip_url: snapshotUrl,
        snapshot_status: 'saved'
      }).eq('id', submissionId)
      console.log(`[SNAPSHOT] Database updated`)
      appendLog('Source snapshot saved permanently.')
      console.log(`[SNAPSHOT] Mentor download ready`)
    } catch (snapErr) {
      console.error(`[SNAPSHOT] Failed (non-critical):`, snapErr.message)
      appendLog(`Snapshot warning: ${snapErr.message}`)
      await supabase.from('submissions').update({ snapshot_status: 'failed' }).eq('id', submissionId).catch(() => {})
    }

    appendLog('Extracting ZIP archive...')
    await fsPromises.rm(targetDir, { recursive: true, force: true }).catch(() => {})
    await extractZipSafe(localZipPath, targetDir)

    await normalizeProjectEncoding(targetDir)

    // ── PHASE: validating ──
    workerPhase = 'validating'
    // ─── STRICT VALIDATION: Fail clearly, NEVER inject fallback UI ───
    await setState(submissionId, 'validating', {}, supabase)
    cm.updateContainer(submissionId, { status: 'validating' })

    appendLog('[VALIDATION] Detecting runtime...')

    // Pre-validation: check extracted files exist
    const extractedFiles = await fsPromises.readdir(targetDir).catch(() => [])
    if (extractedFiles.length === 0) {
      const validationErrors = [{ type: 'empty_archive', message: 'ZIP archive is empty or corrupted. No files were extracted.' }]
      await supabase.from('submissions').update({
        validation_report: { checks: [], warnings: [], errors: validationErrors, score: 0 },
        build_status: 'failed'
      }).eq('id', submissionId)
      appendLog('[VALIDATION] FAILED: Empty or corrupted archive')
      throw new Error('Validation failed: ZIP archive is empty or corrupted.')
    }

    let runtimeType, internalPort, prepResult
    try {
      prepResult = await prepareProject(targetDir, submissionId)
      runtimeType = prepResult.type
      internalPort = prepResult.port
    } catch (validationErr) {
      await supabase.from('submissions').update({
        validation_report: { checks: [], warnings: [], errors: [{ type: 'unsupported_runtime', message: validationErr.message }], score: 0 },
        build_status: 'failed',
        logs: `[VALIDATION] Runtime detection failed: ${validationErr.message}`
      }).eq('id', submissionId)
      appendLog(`[VALIDATION] FAILED: ${validationErr.message}`)
      throw validationErr
    }

    // Validation passed — generate structured report
    const validationReport = {
      runtime: runtimeType,
      pkgManager: prepResult.pkgManager || 'npm',
      checks: [
        { name: 'Archive Integrity', passed: true },
        { name: 'Files Extracted', passed: true, detail: `${extractedFiles.length} files` },
        { name: 'Runtime Detected', passed: true, detail: runtimeType },
        { name: 'Package Manager', passed: true, detail: prepResult.pkgManager || 'npm' }
      ],
      warnings: [],
      score: 100
    }

    if (extractedFiles.includes('node_modules')) {
      validationReport.warnings.push('node_modules detected — remove before uploading for faster builds.')
      validationReport.score -= 10
    }
    if (extractedFiles.includes('.git')) {
      validationReport.warnings.push('.git directory detected — not needed for deployment.')
      validationReport.score -= 5
    }

    await supabase.from('submissions').update({
      runtime_type: runtimeType,
      validation_report: validationReport,
      validation_passed: true
    }).eq('id', submissionId)
    appendLog(`[VALIDATION] Passed — ${runtimeType} (score: ${validationReport.score}/100)`)

    const imageTag = `submission-${submissionId}:v1`
    const containerName = `submission-${submissionId}-${Date.now()}`

    // ── PHASE: building ──
    workerPhase = 'building'
    await setState(submissionId, 'building', { runtimeType }, supabase)
    cm.updateContainer(submissionId, { status: 'building', buildStartedAt: Date.now() })

    if (await imageExists(imageTag)) {
      appendLog('Docker image already exists. Skipping rebuild.')
    } else {
      appendLog(`Building Docker image (${runtimeType})...`)
      await buildImage(targetDir, imageTag, (log) => {
        if (log.trim()) appendLog(log.trim())
      })
      appendLog('Image built successfully.')
    }

    // ── PHASE: starting ──
    appendLog('Allocating port...')
    hostPort = cm.getAvailablePort()

    workerPhase = 'starting'
    await setState(submissionId, 'starting', { port: hostPort }, supabase)
    cm.updateContainer(submissionId, { status: 'starting' })

    appendLog(`Starting container on host port ${hostPort} (internal: ${internalPort})...`)
    const container = await runContainer(imageTag, containerName, hostPort, internalPort, {
      'nexusdev.submissionId': submissionId,
      'nexusdev.userId': userId,
      'nexusdev.taskId': taskId
    })
    containerId = container.id

    cm.updateContainer(submissionId, { containerId, port: hostPort, status: 'starting' })
    cm.attachLogStream(containerId, submissionId, null)

    // ── PHASE: health_check ──
    workerPhase = 'health_check'
    await setState(submissionId, 'health_check', { containerId, port: hostPort }, supabase)
    cm.updateContainer(submissionId, { status: 'health_check' })

    appendLog('Container started. Running health check...')
    const isHealthy = await cm.healthCheck(hostPort)

    if (!isHealthy) {
      appendLog('Health check failed: App did not respond on assigned port within 20s.')
      throw new Error('Startup timeout (Health check failed)')
    }

    appendLog('Container is healthy. Preview is ready.')

    // ── PHASE: running ──
    cm.updateContainer(submissionId, {
      status: 'running',
      dockerImageTag: imageTag,
      containerId,
      port: hostPort
    })

    await persistToRedis(submissionId, {
      status: 'running',
      containerId,
      port: String(hostPort),
      previewUrl: stablePreviewUrl,
      dockerImageTag: imageTag,
      userId,
      taskId
    })

    await cm.redisConnection.hmset(`container:${submissionId}`, {
      containerId,
      port: String(hostPort),
      previewUrl: stablePreviewUrl,
      status: 'running',
      dockerImageTag: imageTag,
      updatedAt: String(Date.now())
    }).catch((err) => console.error(`[Worker Redis Save Error ${submissionId}]`, err.message))
    await cm.redisConnection.expire(`container:${submissionId}`, 3600).catch(() => {})

    let dbUpdateOk = false
    for (let dbAttempt = 1; dbAttempt <= 3; dbAttempt++) {
      try {
        const { data: updatedRow, error: updateError } = await supabase
          .from('submissions')
          .update({
            build_status: 'running',
            preview_url: stablePreviewUrl
          })
          .eq('id', submissionId)
          .select()
          .single()

        if (updateError) {
          console.error(`[Worker DB Update ${submissionId}] Attempt ${dbAttempt} ERROR:`, updateError.message)
          if (dbAttempt < 3) await new Promise(r => setTimeout(r, 1000))
        } else if (!updatedRow) {
          console.error(`[Worker DB Update ${submissionId}] Attempt ${dbAttempt} no row returned`)
          if (dbAttempt < 3) await new Promise(r => setTimeout(r, 1000))
        } else {
          dbUpdateOk = true
          console.log(`[Worker DB Update ${submissionId}] SUCCESS attempt=${dbAttempt} status=running url=${stablePreviewUrl}`)
          break
        }
      } catch (updateCatchErr) {
        console.error(`[Worker DB Update ${submissionId}] Attempt ${dbAttempt} EXCEPTION:`, updateCatchErr?.message)
        if (dbAttempt < 3) await new Promise(r => setTimeout(r, 1000))
      }
    }

    await releaseLock(submissionId)

    if (!dbUpdateOk) {
      console.warn(`[Worker] DB update failed but container is healthy. Container will remain accessible via Redis/registry.`)
      return { success: true, hostPort, containerId, previewUrl: stablePreviewUrl, dbWarning: 'DB update failed but container healthy' }
    }

    console.log(`[Worker] Job ${submissionId} COMPLETE. Container=${containerId} Port=${hostPort} StableURL=${stablePreviewUrl}`)
    return { success: true, hostPort, containerId, previewUrl: stablePreviewUrl }

  } catch (err) {
    const safeErr = err || new Error('Unknown worker error')
    const safeMessage = safeErr.message || String(safeErr)
    console.error(`[Worker Error ${submissionId}]`, safeErr)

    const entry = cm.getContainer(submissionId)
    const restartCount = (entry?.restartCount || 0) + 1
    const maxRestarts = 3

    const logsBefore = await cm.getLogs(submissionId)
    const diagnosis = classifyBuildError(safeMessage, workerPhase, logsBefore)
    for (const line of formatDiagnosticLog(diagnosis)) {
      if (line.trim()) appendLog(line)
    }
    const logsAfter = await cm.getLogs(submissionId)
    const logsText = Array.isArray(logsAfter) ? logsAfter.join('\n') : String(logsAfter)
    const suggestionText = diagnosis.suggestions.slice(0, 5).join(' · ')

    if (restartCount >= maxRestarts) {
      appendLog(`Sandbox failed permanently after ${restartCount} attempts.`)
      cm.updateContainer(submissionId, { status: 'failed_permanently', restartCount })
      await setState(submissionId, 'failed_permanently', { restartCount }, supabase)
      await supabase.from('submissions').update({
        logs: logsText,
        error_category: diagnosis.category,
        error_suggestion: suggestionText
      }).eq('id', submissionId)
      await releaseLock(submissionId)
      return { success: false, message: 'Sandbox failed permanently after multiple attempts.' }
    } else {
      cm.updateContainer(submissionId, { status: 'failed', restartCount })
      await setState(submissionId, 'failed', { restartCount }, supabase)
      await supabase.from('submissions').update({
        logs: logsText,
        error_category: diagnosis.category,
        error_suggestion: suggestionText
      }).eq('id', submissionId)
    }

    if (hostPort) cm.releasePort(hostPort)

    if (containerId) {
      try {
        const c = docker.getContainer(containerId)
        await c.stop({ t: 3 }).catch(() => {})
        await c.remove({ force: true }).catch(() => {})
      } catch { /* container may not exist */ }
    }

    await releaseLock(submissionId)
    throw safeErr

  } finally {
    // Only the temp BUILD folder is deleted — never the Supabase snapshot
    await fsPromises.rm(targetDir, { recursive: true, force: true }).catch(() => {})
    await cm.redisConnection.del(processingKey).catch(() => {})
  }
}

process.on('unhandledRejection', (reason) => {
  console.error('[Worker] Unhandled Rejection:', reason)
})
process.on('uncaughtException', (err) => {
  console.error('[Worker] Uncaught Exception:', err)
})

