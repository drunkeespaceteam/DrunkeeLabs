/**
 * BACKFILL SCRIPT: Repair Old Submissions Missing Immutable Artifact Metadata
 *
 * This script finds submissions that are missing `original_zip_url` and repairs them
 * by copying the existing `zip_url` value and setting appropriate `artifact_status`.
 *
 * Run: node server/scripts/backfill_artifacts.js
 */

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Load .env from server/ first, fall back to project root
const envResult = dotenv.config({ path: path.join(__dirname, '..', '.env') })
if (envResult.error) {
  dotenv.config({ path: path.join(__dirname, '..', '..', '.env') })
}

const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('[BACKFILL] Missing SUPABASE_URL or SUPABASE_KEY in .env')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function backfillArtifacts() {
  console.log('[BACKFILL] Starting artifact backfill...')
  console.log('[BACKFILL] Finding submissions missing original_zip_url...')

  // Step 1: Find all submissions missing original_zip_url
  const { data: submissions, error } = await supabase
    .from('submissions')
    .select('id, task_id, user_id, zip_url, original_zip_url, is_winner, artifact_status')
    .is('original_zip_url', null)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('[BACKFILL] Query error:', error.message)
    process.exit(1)
  }

  if (!submissions || submissions.length === 0) {
    console.log('[BACKFILL] ✅ All submissions already have original_zip_url. Nothing to repair.')
    process.exit(0)
  }

  console.log(`[BACKFILL] Found ${submissions.length} submissions to repair.`)

  let repaired = 0
  let skipped = 0
  let storageRecovered = 0

  for (const sub of submissions) {
    const submissionId = sub.id

    // Step 2: Try zip_url first
    if (sub.zip_url) {
      const artifactStatus = sub.is_winner ? 'locked' : 'stored'
      const { error: updateError } = await supabase
        .from('submissions')
        .update({
          original_zip_url: sub.zip_url,
          artifact_status: artifactStatus
        })
        .eq('id', submissionId)

      if (updateError) {
        console.error(`[BACKFILL] ❌ Failed to update ${submissionId}: ${updateError.message}`)
        skipped++
      } else {
        console.log(`[BACKFILL] ✅ Repaired ${submissionId} — zip_url copied, status=${artifactStatus}`)
        repaired++
      }
      continue
    }

    // Step 3: No zip_url — try to find ZIP in Supabase Storage directly
    const storagePath = `${sub.task_id}/${sub.user_id}/${submissionId}.zip`
    console.log(`[BACKFILL] 🔍 Checking storage for ${storagePath}...`)

    const { data: zipBlob, error: dlErr } = await supabase.storage
      .from('submissions')
      .download(storagePath)

    if (dlErr || !zipBlob) {
      console.warn(`[BACKFILL] ⚠️  No ZIP found for ${submissionId} — cannot repair. Skipping.`)
      skipped++
      continue
    }

    // Found in storage — reconstruct the URL
    const { data: { publicUrl } } = supabase.storage.from('submissions').getPublicUrl(storagePath)

    const artifactStatus = sub.is_winner ? 'locked' : 'stored'
    const { error: updateError } = await supabase
      .from('submissions')
      .update({
        zip_url: publicUrl,
        original_zip_url: publicUrl,
        artifact_status: artifactStatus
      })
      .eq('id', submissionId)

    if (updateError) {
      console.error(`[BACKFILL] ❌ Failed to update ${submissionId}: ${updateError.message}`)
      skipped++
    } else {
      console.log(`[BACKFILL] ✅ Recovered ${submissionId} from storage — status=${artifactStatus}`)
      storageRecovered++
      repaired++
    }
  }

  console.log('\n[BACKFILL] ════════════════════════════════════════')
  console.log(`[BACKFILL]   Total submissions scanned: ${submissions.length}`)
  console.log(`[BACKFILL]   Repaired (from zip_url):   ${repaired - storageRecovered}`)
  console.log(`[BACKFILL]   Recovered (from storage):  ${storageRecovered}`)
  console.log(`[BACKFILL]   Skipped (no data found):   ${skipped}`)
  console.log('[BACKFILL] ════════════════════════════════════════')
  console.log('[BACKFILL] Backfill complete.')
}

backfillArtifacts().catch(err => {
  console.error('[BACKFILL] Fatal error:', err)
  process.exit(1)
})
