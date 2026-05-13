const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = 'https://rogvbbzxzwawrqqvifnr.supabase.co'
const supabaseServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJvZ3ZiYnp4endhd3JxcXZpZm5yIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzM5MTIxOSwiZXhwIjoyMDkyOTY3MjE5fQ.2Hl2W-2xAn6Vtd4xYpAnLTXScC_eElRTR8sb8zquI6M'

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function resetAdmin() {
  const email = 'sahidh.drunkeeadmin@gmail.com'
  const password = 'pass-123456'

  console.log(`Resetting admin password for: ${email}...`)

  // 1. Find user by email
  const { data: users, error: findError } = await supabase.auth.admin.listUsers()
  const user = users.users.find(u => u.email === email)

  if (!user) {
    console.log('User not found in Auth. Creating new...')
    const { data: newData, error: createError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true
    })
    if (createError) console.error('Create Error:', createError)
    else console.log('User created successfully.')
  } else {
    console.log('User found. Updating password...')
    const { data: updateData, error: updateError } = await supabase.auth.admin.updateUserById(user.id, {
      password: password
    })
    if (updateError) console.error('Update Error:', updateError)
    else console.log('Password updated successfully.')
  }
}

resetAdmin()
