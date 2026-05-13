const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = 'https://rogvbbzxzwawrqqvifnr.supabase.co'
const supabaseServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJvZ3ZiYnp4endhd3JxcXZpZm5yIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzM5MTIxOSwiZXhwIjoyMDkyOTY3MjE5fQ.2Hl2W-2xAn6Vtd4xYpAnLTXScC_eElRTR8sb8zquI6M'

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function debugUser() {
  const email = 'sahidh.drunkeeadmin@gmail.com'
  const { data: { users }, error } = await supabase.auth.admin.listUsers()
  const user = users.find(u => u.email === email)
  
  if (user) {
    console.log('User Details:', {
      id: user.id,
      email: user.email,
      confirmed_at: user.confirmed_at,
      last_sign_in_at: user.last_sign_in_at,
      raw_user_meta_data: user.raw_user_meta_data
    })
  } else {
    console.log('User not found in Auth.')
  }
}

debugUser()
