const { createClient } = require('@supabase/supabase-js')
require('dotenv').config()

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY // Service role key
)

async function setup() {
  const { data, error } = await supabase.storage.listBuckets()
  if (error) {
    console.error('Error listing buckets:', error)
    return
  }

  const taskImagesExists = data.find(b => b.name === 'task-images')
  if (!taskImagesExists) {
    console.log('Bucket "task-images" not found, creating...')
    const { data: newBucket, error: createError } = await supabase.storage.createBucket('task-images', {
      public: true,
      allowedMimeTypes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'],
      fileSizeLimit: 2097152 // 2MB
    })
    if (createError) {
      console.error('Error creating bucket:', createError)
    } else {
      console.log('Bucket "task-images" created successfully.')
    }
  } else {
    console.log('Bucket "task-images" already exists.')
    await supabase.storage.updateBucket('task-images', { public: true })
  }

  const kycExists = data.find(b => b.name === 'kyc-documents')
  if (!kycExists) {
    console.log('Bucket "kyc-documents" not found, creating...')
    const { data: newBucket, error: createError } = await supabase.storage.createBucket('kyc-documents', {
      public: true,
      allowedMimeTypes: ['image/png', 'image/jpeg', 'image/jpg', 'application/pdf'],
      fileSizeLimit: 5242880 // 5MB
    })
    if (createError) {
      console.error('Error creating bucket:', createError)
    } else {
      console.log('Bucket "kyc-documents" created successfully.')
    }
  } else {
    console.log('Bucket "kyc-documents" already exists.')
    await supabase.storage.updateBucket('kyc-documents', { public: true })
  }
}

setup()
