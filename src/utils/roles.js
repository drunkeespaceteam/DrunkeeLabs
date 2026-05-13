/** Normalize app role for comparisons (DB or metadata may use mixed case). */
export function normalizeRole(role) {
  const r = String(role || '').trim().toLowerCase()
  if (r === 'admin') return 'admin'
  if (r === 'mentor') return 'mentor'
  return 'user'
}
