import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'placeholder'

if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) {
  console.warn('⚠️ Supabase credentials not found. Check .env.local')
}

/** sessionStorage can throw (private mode, locked-down browsers) and would blank the entire app on import. */
function getAuthStorage() {
  if (typeof window === 'undefined') return undefined
  try {
    const k = '__nexus_sb_storage_test__'
    window.sessionStorage.setItem(k, '1')
    window.sessionStorage.removeItem(k)
    return window.sessionStorage
  } catch {
    const mem = new Map()
    return {
      getItem: (key) => (mem.has(key) ? mem.get(key) : null),
      setItem: (key, value) => {
        mem.set(key, String(value))
      },
      removeItem: (key) => {
        mem.delete(key)
      },
    }
  }
}

export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey,
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
      storageKey: 'nexus-app-auth-v4',
      // Prefer sessionStorage (tab isolation); fall back to in-memory if storage is blocked.
      storage: getAuthStorage(),
    },
    realtime: {
      params: {
        eventsPerSecond: 10,
      },
    },
  }
)

// ─── Database helpers ───

export const db = {
  // Users
  async getProfile(userId) {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .maybeSingle()
    return { data, error }
  },

  async createProfile({ id, name, email, role }) {
    const { data, error } = await supabase
      .from('users')
      .insert([{ id, name, email, role }])
      .select()
      .single()
    return { data, error }
  },

  // Tasks
  async getTasks() {
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .order('is_featured', { ascending: false })
      .order('created_at', { ascending: false })
    return { data: data || [], error }
  },

  async getTasksByMentor(mentorId) {
    const { data, error } = await supabase
      .from('tasks')
      .select('*, submissions(id, user_id, is_final)')
      .eq('mentor_id', mentorId)
      .order('created_at', { ascending: false })

    if (data) {
      data.forEach(task => {
        const finalSubs = (task.submissions || []).filter(s => s.is_final)
        const uniqueUsers = new Set(finalSubs.map(s => s.user_id))
        task.submissions_count = uniqueUsers.size
        // Optional: remove submissions array so we don't pass heavy objects
        delete task.submissions
      })
    }

    return { data: data || [], error }
  },

  async createTask(task) {
    // 1. Create task
    const { data: taskData, error: taskError } = await supabase
      .from('tasks')
      .insert([task])
      .select()
      .single()

    if (taskError) return { data: null, error: taskError }

    // 2. Lock funds in payments table
    const { error: paymentError } = await supabase
      .from('payments')
      .insert([{
        task_id: taskData.id,
        mentor_id: task.mentor_id,
        amount: task.reward,
        status: 'locked'
      }])

    return { data: taskData, error: paymentError || null }
  },

  // Submissions
  async submitSolution({ task_id, user_id, files, score, feedback }) {
    // Check if user already has a submission for this task
    const { data: existingRows } = await supabase
      .from('submissions')
      .select('id, attempt_number, is_final')
      .eq('task_id', task_id)
      .eq('user_id', user_id)
      .order('created_at', { ascending: false })
      .limit(1)

    const existing = existingRows?.[0]

    if (existing?.is_final) {
      return { data: null, error: { message: 'Submission is finalized. Cannot resubmit.' } }
    }

    if (existing) {
      // Update existing submission
      const { data, error } = await supabase
        .from('submissions')
        .update({ files, score, feedback, attempt_number: (existing.attempt_number || 1) + 1 })
        .eq('id', existing.id)
        .select()
        .single()
      return { data, error }
    } else {
      // Insert first submission
      const { data, error } = await supabase
        .from('submissions')
        .insert([{ task_id, user_id, files, score, feedback, attempt_number: 1 }])
        .select()
        .single()
      return { data, error }
    }
  },

  async finalizeSubmission(submissionId, screenshots = null) {
    const updateData = { is_final: true }
    if (screenshots && screenshots.length > 0) updateData.screenshots = screenshots

    const { data, error } = await supabase
      .from('submissions')
      .update(updateData)
      .eq('id', submissionId)
      .select()
      .single()
      
    if (error) console.error('Finalize Submission Error:', error)
    return { data, error }
  },

  async getSubmissionsByTask(taskId) {
    const { data, error } = await supabase
      .from('submissions')
      .select('*, users(name, email)')
      .eq('task_id', taskId)
      .eq('is_final', true)
      .order('score', { ascending: false })
    return { data: data || [], error }
  },

  async getUserTaskStatus(userId, taskId) {
    const { data, error } = await supabase
      .from('submissions')
      .select('*')
      .eq('task_id', taskId)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
    
    return { data: data?.[0] || null, error }
  },

  async getUserSubmissionStatuses(userId) {
    const { data, error } = await supabase
      .from('submissions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      
    // Convert to map: { [taskId]: { isClosed, isWinner, ... } }
    const statusMap = {}
    if (data) {
      data.forEach(sub => {
        if (!statusMap[sub.task_id]) {
          statusMap[sub.task_id] = {
            isClosed: sub.is_final || false,
            isWinner: sub.is_winner || false,
            deliveryStatus: sub.delivery_status,
            score: sub.score
          }
        }
      })
    }
    return { data: statusMap, error }
  },

  async getSubmissionsByUser(userId) {
    const { data, error } = await supabase
      .from('submissions')
      .select('*, tasks(title, category, difficulty)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      
    // Deduplicate by task_id to hide legacy duplicate rows
    const uniqueSubs = []
    const seenTasks = new Set()
    if (data) {
      for (const sub of data) {
        if (!seenTasks.has(sub.task_id)) {
          seenTasks.add(sub.task_id)
          uniqueSubs.push(sub)
        }
      }
    }
    
    return { data: uniqueSubs, error }
  },

  // Workspaces (Auto-save)
  async getWorkspace(userId, taskId) {
    const { data, error } = await supabase
      .from('workspaces')
      .select('*')
      .eq('user_id', userId)
      .eq('task_id', taskId)
      .maybeSingle()
    return { data, error }
  },

  async upsertWorkspace(workspaceData) {
    const { data, error } = await supabase
      .from('workspaces')
      .upsert([workspaceData], { onConflict: 'user_id,task_id' })
      .select()
      .single()
    return { data, error }
  },

  async getRecentWorkspaces(userId) {
    const { data, error } = await supabase
      .from('workspaces')
      .select('*, tasks!inner(title, category, closed)')
      .eq('user_id', userId)
      .eq('tasks.closed', false)
      .order('updated_at', { ascending: false })
      .limit(3)
    return { data: data || [], error }
  },

  async deleteWorkspace(userId, taskId) {
    const { data, error } = await supabase
      .from('workspaces')
      .delete()
      .eq('user_id', userId)
      .eq('task_id', taskId)
    return { data, error }
  },

  async selectWinner(submissionId, taskId, winnerId) {
    // 0. Anti-abuse: Check if task is already closed
    const { data: taskData } = await supabase.from('tasks').select('closed').eq('id', taskId).single()
    if (taskData?.closed) {
      return { data: null, error: { message: 'Task is already closed. Winner cannot be changed.' } }
    }

    // 1. Clear any existing winner for this task
    await supabase
      .from('submissions')
      .update({ is_winner: false, selected_at: null })
      .eq('task_id', taskId)
      .eq('is_winner', true)

    // 2. Set the new winner
    const { data, error } = await supabase
      .from('submissions')
      .update({ is_winner: true, selected_at: new Date().toISOString() })
      .eq('id', submissionId)
      .select()
      .single()

    if (error) return { data: null, error }

    // 3. Release funds
    if (winnerId) {
      await supabase
        .from('payments')
        .update({ winner_id: winnerId, status: 'released', released_at: new Date().toISOString() })
        .eq('task_id', taskId)
    }

    // 4. Mark task as closed
    await supabase
      .from('tasks')
      .update({ closed: true })
      .eq('id', taskId)

    return { data, error: null }
  },

  async getWinnerForTask(taskId) {
    const { data, error } = await supabase
      .from('submissions')
      .select('*, users(name, email)')
      .eq('task_id', taskId)
      .eq('is_winner', true)
      .maybeSingle()
    return { data, error }
  },

  // ─── Payments & Earnings ───
  async getEmployeeEarnings(userId) {
    const { data: payments, error } = await supabase
      .from('payments')
      .select('*')
      .eq('winner_id', userId)
      .eq('status', 'released')
      .order('released_at', { ascending: false })

    if (payments && payments.length > 0) {
      const taskIds = payments.map(p => p.task_id)
      const { data: tasks } = await supabase
        .from('tasks')
        .select('id, title, reward')
        .in('id', taskIds)
        
      payments.forEach(p => {
        p.tasks = tasks?.find(t => t.id === p.task_id) || null
      })
    }

    return { data: payments || [], error }
  },

  async getMentorPayments(mentorId) {
    const { data, error } = await supabase
      .from('payments')
      .select('*')
      .eq('mentor_id', mentorId)
      .order('created_at', { ascending: false })
    return { data: data || [], error }
  },

  // ─── Reputation & Ratings ───
  async getDeveloperReputation(userId) {
    const { data: subs, error } = await supabase
      .from('submissions')
      .select('is_winner, is_final')
      .eq('user_id', userId)
      .eq('is_final', true)
      
    if (error) return { data: null, error }
    
    const completedTasks = subs.filter(s => s.is_winner).length
    const winRate = subs.length > 0 ? Math.round((completedTasks / subs.length) * 100) : 0
    
    return { data: { completedTasks, winRate }, error: null }
  },

  async rateMentor({ task_id, mentor_id, employee_id, rating }) {
    const { data, error } = await supabase
      .from('mentor_ratings')
      .upsert([{ task_id, mentor_id, employee_id, rating }], { onConflict: 'task_id,employee_id' })
      .select()
      .single()
    return { data, error }
  },

  async getMentorRating(mentorId) {
    const { data, error } = await supabase
      .from('mentor_ratings')
      .select('rating')
      .eq('mentor_id', mentorId)
      
    if (error) return { data: null, error }
    
    if (!data || data.length === 0) return { data: { average: 0, count: 0 }, error: null }
    
    const sum = data.reduce((acc, curr) => acc + curr.rating, 0)
    const average = Number((sum / data.length).toFixed(1))
    
    return { data: { average, count: data.length }, error: null }
  },

  async rateEmployee({ task_id, mentor_id, employee_id, rating }) {
    const { data, error } = await supabase
      .from('employee_ratings')
      .upsert([{ task_id, mentor_id, employee_id, rating }], { onConflict: 'task_id,employee_id' })
      .select()
      .single()
    return { data, error }
  },

  async getEmployeeRating(employeeId) {
    const { data, error } = await supabase
      .from('employee_ratings')
      .select('rating')
      .eq('employee_id', employeeId)
      
    if (error) return { data: null, error }
    
    if (!data || data.length === 0) return { data: { average: 0, count: 0 }, error: null }
    
    const sum = data.reduce((acc, curr) => acc + curr.rating, 0)
    const average = Number((sum / data.length).toFixed(1))
    
    return { data: { average, count: data.length }, error: null }
  },
}

// ─── Realtime channels ───

export const realtime = {
  subscribeToSubmissions(taskId, callback) {
    const channel = supabase
      .channel(`submissions:task:${taskId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'submissions',
          filter: `task_id=eq.${taskId}`,
        },
        (payload) => callback(payload)
      )
      .subscribe()

    return () => supabase.removeChannel(channel)
  },

  subscribeToTasks(callback) {
    const channel = supabase
      .channel('tasks:all')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tasks',
        },
        (payload) => callback(payload)
      )
      .subscribe()

    return () => supabase.removeChannel(channel)
  },

  subscribeToUserSubmissions(userId, callback) {
    const channel = supabase
      .channel(`submissions:user:${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'submissions',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => callback(payload)
      )
      .subscribe()

    return () => supabase.removeChannel(channel)
  },
}
