const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: './server/.env' })

const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_KEY // We updated this to service role key

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
})

async function createAdmin() {
  const email = 'sahidh.drunkeeadmin@gmail.com'
  const password = 'pass-123456'
  const name = 'Nexus Admin'

  console.log(`Creating admin: ${email}...`)

  // 1. Create user in Supabase Auth
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name, role: 'admin' }
  })

  if (authError) {
    if (authError.message.includes('already registered')) {
      console.log('User already exists in Auth. Checking profile...')
      // We'll proceed to update the role in the next step anyway
    } else {
      console.error('Auth Error:', authError)
      return
    }
  }

  const userId = authData?.user?.id || (await supabase.from('users').select('id').eq('email', email).single()).data?.id

  if (!userId) {
    console.error('Could not find or create user ID.')
    return
  }

  // 2. Upsert profile with admin role
  const { error: profileError } = await supabase
    .from('users')
    .upsert({
      id: userId,
      email,
      name,
      role: 'admin',
      kyc_status: 'verified'
    })

  if (profileError) {
    console.error('Profile Error:', profileError)
  } else {
    console.log('Admin user created/updated successfully!')
  }
}

createAdmin()
