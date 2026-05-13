const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = 'https://rogvbbzxzwawrqqvifnr.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJvZ3ZiYnp4endhd3JxcXZpZm5yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczOTEyMTksImV4cCI6MjA5Mjk2NzIxOX0.TE2jCkspLaUwBtM1J4Sio2ydlzt6zLUvXIVepQ98lyo'

const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function testSignIn() {
  const email = 'sahidh.drunkeeadmin@gmail.com'
  const password = 'sahidh123'

  console.log(`Testing sign-in for: ${email}...`)

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  })

  if (error) {
    console.error('Sign-in failed:', error.message)
  } else {
    console.log('Sign-in successful!', {
      id: data.user.id,
      email: data.user.email
    })
  }
}

testSignIn()
