const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '../server/.env' })

const supabase = createClient(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY)

async function test() {
  try {
    const { data, error } = await supabase.from('tasks').select('*').limit(1)
    if (error) {
      console.error('Error fetching tasks:', error)
    } else {
      console.log('Columns in tasks table:', Object.keys(data[0] || {}))
    }
    
    const { data: pData, error: pError } = await supabase.from('pending_tasks').select('*').limit(1)
    if (pError) {
      console.error('Error fetching pending_tasks:', pError)
    } else {
      console.log('Columns in pending_tasks table:', Object.keys(pData[0] || {}))
    }
  } catch (e) {
    console.error('Exception:', e)
  }
}

test()
