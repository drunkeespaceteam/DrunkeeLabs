import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

dotenv.config({ path: path.join(__dirname, '.env') })

const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_KEY // service role key

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials in .env')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function createBucket() {
  console.log('Checking for submissions bucket...')
  
  const { data: buckets, error: listError } = await supabase.storage.listBuckets()
  
  if (listError) {
    console.error('Failed to list buckets:', listError.message)
    return
  }

  const exists = buckets.find(b => b.name === 'submissions')
  if (exists) {
    console.log('Bucket "submissions" already exists.')
    return
  }

  console.log('Creating "submissions" bucket...')
  const { data, error } = await supabase.storage.createBucket('submissions', {
    public: true,
    allowedMimeTypes: ['application/zip'],
    fileSizeLimit: 52428800 // 50MB
  })

  if (error) {
    console.error('Failed to create bucket:', error.message)
  } else {
    console.log('Successfully created "submissions" bucket:', data)
  }
}

createBucket()
