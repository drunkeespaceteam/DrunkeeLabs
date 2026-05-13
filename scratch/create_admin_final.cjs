const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = 'https://rogvbbzxzwawrqqvifnr.supabase.co'
const supabaseServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJvZ3ZiYnp4endhd3JxcXZpZm5yIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzM5MTIxOSwiZXhwIjoyMDkyOTY3MjE5fQ.2Hl2W-2xAn6Vtd4xYpAnLTXScC_eElRTR8sb8zquI6M'

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function createAdmin() {
  const email = 'sahidh.drunkeeadmin@gmail.com'
  const password = 'pass-123456'
  const name = 'Nexus Admin'

  console.log(`Creating admin: ${email}...`)

  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name, role: 'admin' }
  })

  if (authError && !authError.message.includes('already registered')) {
    console.error('Auth Error:', authError)
    return
  }

  const userId = authData?.user?.id || (await supabase.from('users').select('id').eq('email', email).single()).data?.id

  const { error: profileError } = await supabase
    .from('users')
    .upsert({
      id: userId,
      email,
      name,
      role: 'admin',
      kyc_status: 'verified'
    })

  if (profileError) console.error('Profile Error:', profileError)
  else console.log('Admin user created successfully!')
}

createAdmin()
