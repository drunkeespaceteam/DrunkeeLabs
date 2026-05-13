/**
 * Queue Cleanup Script
 * Clears stale, duplicate, and completed/failed jobs from BullMQ.
 *
 * Usage: node server/scripts/clearQueue.js
 */

import { Queue } from 'bullmq'
import { createConnection } from '../redisClient.js'

const redisConnection = createConnection('Redis-ClearQueue')
const sandboxQueue = new Queue('sandbox-execution', { connection: redisConnection })

async function clearQueue() {
  console.log('[Queue Cleanup] Starting BullMQ queue cleanup...')

  const completedCount = await sandboxQueue.clean(0, 1000, 'completed')
  console.log(`[Queue Cleanup] Removed ${completedCount} completed jobs`)

  const failedCount = await sandboxQueue.clean(0, 1000, 'failed')
  console.log(`[Queue Cleanup] Removed ${failedCount} failed jobs`)

  const delayedCount = await sandboxQueue.clean(0, 1000, 'delayed')
  console.log(`[Queue Cleanup] Removed ${delayedCount} delayed jobs`)

  const waitingCount = await sandboxQueue.clean(0, 1000, 'waiting')
  console.log(`[Queue Cleanup] Removed ${waitingCount} waiting jobs`)

  await sandboxQueue.drain()
  console.log('[Queue Cleanup] Queue drained (all waiting jobs removed)')

  const activeJobs = await sandboxQueue.getJobs(['active'])
  console.log(`[Queue Cleanup] Active jobs remaining: ${activeJobs.length}`)
  for (const job of activeJobs) {
    console.log(`  - active job: ${job.id} (submission-${job.data?.submissionId || 'unknown'})`)
  }

  const counts = await sandboxQueue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed')
  console.log('[Queue Cleanup] Final queue counts:', counts)

  console.log('[Queue Cleanup] Done.')
  process.exit(0)
}

clearQueue().catch(err => {
  console.error('[Queue Cleanup Error]', err)
  process.exit(1)
})
