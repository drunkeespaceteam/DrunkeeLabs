const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '../.env' })

// Need the service role key to create a bucket, but we might only have anon key in .env.
// Wait, the backend has process.env.SUPABASE_KEY. Let's use the backend's .env which is inside server/.env.
require('dotenv').config({ path: './server/.env' })

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY // Service role key
)

async function setup() {
  const { data, error } = await supabase.storage.listBuckets()
  if (error) {
    console.error('Error listing buckets:', error)
    return
  }

  const exists = data.find(b => b.name === 'task-images')
  if (!exists) {
    console.log('Bucket "task-images" not found, creating...')
    const { data: newBucket, error: createError } = await supabase.storage.createBucket('task-images', {
      public: true,
      allowedMimeTypes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'],
      fileSizeLimit: 2097152 // 2MB
    })
    if (createError) {
      console.error('Error creating bucket:', createError)
    } else {
      console.log('Bucket created successfully.')
    }
  } else {
    console.log('Bucket "task-images" already exists.')
    // Let's ensure it's public
    await supabase.storage.updateBucket('task-images', { public: true })
  }
}

setup()
