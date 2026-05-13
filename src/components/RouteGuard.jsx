import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import LoadingScreen from './LoadingScreen'
import { normalizeRole } from '../utils/roles'

// Requires authentication — redirects to /login if not logged in
export function RequireAuth({ children }) {
  const { isAuthenticated, loading } = useAuth()
  if (loading) return <LoadingScreen />
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return children
}

// Requires specific role — redirects to correct dashboard if wrong role
export function RequireRole({ role, children }) {
  const { isAuthenticated, role: userRole, loading } = useAuth()

  if (loading) return <LoadingScreen />
  if (!isAuthenticated) return <Navigate to="/login" replace />

  const activeRole = normalizeRole(userRole)
  const expectedRole = role === 'employee' ? 'user' : role

  if (activeRole !== expectedRole) {
    // Redirect to correct dashboard based on active role
    const redirect = activeRole === 'admin' ? '/admin' : activeRole === 'mentor' ? '/mentor/dashboard' : '/dashboard'
    return <Navigate to={redirect} replace />
  }

  return children
}

// Redirect authenticated users away from auth pages
export function RedirectIfAuth({ children }) {
  const { isAuthenticated, role, loading } = useAuth()

  if (loading) return <LoadingScreen />
  if (isAuthenticated) {
    const normalized = normalizeRole(role)
    const redirect = normalized === 'admin' ? '/admin' : normalized === 'mentor' ? '/mentor/dashboard' : '/dashboard'
    return <Navigate to={redirect} replace />
  }

  return children
}
// Requires admin role
export function RequireAdmin({ children }) {
  const { isAuthenticated, role: userRole, loading } = useAuth()

  if (loading) return <LoadingScreen />
  if (!isAuthenticated) return <Navigate to="/login" replace />

  if (normalizeRole(userRole) !== 'admin') {
    const redirect = normalizeRole(userRole) === 'mentor' ? '/mentor/dashboard' : '/dashboard'
    return <Navigate to={redirect} replace />
  }

  return children
}
