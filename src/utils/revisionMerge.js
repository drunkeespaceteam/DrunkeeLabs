/**
 * Same merge rules as server/index.js — keep in sync when changing.
 * Prefer real submission_revisions rows; fill gaps from submissions.revision_delivery_log;
 * last resort: current_revision + latest_artifact_url on the submission row.
 */
export function mergeSubmissionRevisionSources(submissionId, tableRows, deliveryLog, submissionRow) {
  const byRev = new Map()
  for (const r of tableRows || []) {
    const n = Number(r.revision_number)
    if (!Number.isFinite(n)) continue
    byRev.set(n, { ...r, _mergedSource: r._mergedSource || 'table' })
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

export function isPersistedRevisionRowId(id) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(id || ''))
}
