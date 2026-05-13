import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '.env') })

const supabaseUrl = process.env.SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseKey = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
const supabase = createClient(supabaseUrl, supabaseKey)

const { data } = await supabase.from('submissions').select('id, task_id, build_status, preview_url, is_final, delivery_status').order('created_at', { ascending: false }).limit(5)
console.log(JSON.stringify(data, null, 2))
