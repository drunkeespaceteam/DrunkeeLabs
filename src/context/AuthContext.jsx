import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { supabase, db } from '../lib/supabase'
import { normalizeRole } from '../utils/roles'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)        // Supabase auth user
  const [profile, setProfile] = useState(null)   // users table row (name, role, etc.)
  const [loading, setLoading] = useState(true)   // initial auth resolution
  const [error, setError] = useState(null)

  // Fetch user profile from users table
  const fetchProfile = useCallback(async (userId) => {
    const { data, error: err } = await db.getProfile(userId)
    if (err) {
      console.warn('Profile fetch failed:', err.message)
      // Profile might not exist yet (just signed up, insert pending)
      return null
    }
    return data
  }, [])

  // Listen to auth state changes
  useEffect(() => {
    let mounted = true

    // Safety timeout: force loading to false if Supabase hangs
    const safetyTimer = setTimeout(() => {
      if (mounted) {
        console.warn('Auth init timed out after 3 seconds. Forcing loading to false.')
        setLoading(false)
      }
    }, 3000)

    const handleSession = async (session) => {
      if (!session?.user) {
        if (mounted) {
          setUser(null)
          setProfile(null)
          setLoading(false)
          clearTimeout(safetyTimer)
        }
        return
      }

      if (mounted) setUser(session.user)
      
      let prof = await fetchProfile(session.user.id)
      
      // Auto-recovery
      if (!prof && mounted) {
        console.warn('Profile missing in DB! Auto-recovering...')
        const { error: recoverError } = await db.createProfile({
          id: session.user.id,
          name: session.user.user_metadata?.name || 'User',
          email: session.user.email,
          role: session.user.user_metadata?.role || 'user'
        })
        if (recoverError) console.error('DATABASE ERROR DURING RECOVERY:', recoverError)
        prof = await fetchProfile(session.user.id)
      }
      
      if (mounted) {
        setProfile(prof)
        setLoading(false)
        clearTimeout(safetyTimer)
      }
    }

    // Subscribe to auth changes. This automatically fires an INITIAL_SESSION event in v2!
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('onAuthStateChange:', event, session?.user?.id)
      
      if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        handleSession(session)
      } else if (event === 'SIGNED_OUT') {
        if (mounted) {
          setUser(null)
          setProfile(null)
          setLoading(false)
        }
      }
    })

    return () => {
      mounted = false
      clearTimeout(safetyTimer)
      subscription.unsubscribe()
    }
  }, [fetchProfile])

  // Sign up
  const signUp = useCallback(async ({ email, password, name, role }) => {
    setError(null)
    try {
      // 1. Create auth user with role in metadata
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { name, role }, // stored in auth.users.raw_user_meta_data
        },
      })

      if (authError) throw authError
      if (!authData.user) throw new Error('Signup failed — no user returned')

      // 2. Insert profile into users table
      const { error: profileError } = await db.createProfile({
        id: authData.user.id,
        name,
        email,
        role,
      })

      if (profileError) {
        console.error('DATABASE ERROR DURING SIGNUP:', profileError)
      }

      // 3. Set local state
      setUser(authData.user)
      setProfile({ id: authData.user.id, name, email, role: normalizeRole(role) })

      return { user: authData.user, role: normalizeRole(role), error: null }
    } catch (err) {
      const message = err.message || 'Signup failed'
      setError(message)
      return { user: null, role: null, error: message }
    }
  }, [])

  // Sign in
  const signIn = useCallback(async ({ email, password }) => {
    setError(null)
    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (authError) throw authError
      if (!data.user) throw new Error('Login failed')

      setUser(data.user)

      // Fetch role from users table
      const prof = await fetchProfile(data.user.id)
      setProfile(prof)

      const role = normalizeRole(prof?.role || data.user.user_metadata?.role)

      return { user: data.user, role, error: null }
    } catch (err) {
      const message = err.message || 'Login failed'
      setError(message)
      return { user: null, role: null, error: message }
    }
  }, [fetchProfile])

  // Sign out
  const signOut = useCallback(async () => {
    // Fire and forget the network request so it never blocks the UI
    supabase.auth.signOut().catch(err => console.error('Sign out error:', err))
    
    // Instantly clear local state
    setUser(null)
    setProfile(null)
  }, [])

  // Clear error
  const clearError = useCallback(() => setError(null), [])

  const value = {
    user,
    profile,
    loading,
    error,
    isAuthenticated: !!user,
    role: normalizeRole(profile?.role || user?.user_metadata?.role),
    signUp,
    signIn,
    signOut,
    clearError,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
