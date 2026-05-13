import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: 'server/.env' });
if (!process.env.SUPABASE_URL) dotenv.config({ path: '.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const taskId = '9ac8a0df-5fa4-4eee-a93e-9b7cb4f5ee4b';
  
  const { data: sub } = await supabase.from('submissions').select('*').eq('task_id', taskId).eq('is_winner', true).single();
  if(!sub) { console.log('no winner'); return; }
  
  const { data: task } = await supabase.from('tasks').select('*').eq('id', sub.task_id).single();
  
  const res = await fetch(`http://localhost:3001/api/submissions/${sub.id}/pause-review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mentorId: task.mentor_id,
      reason: 'dhkdahfkvadd',
      category: 'clarification_needed',
      durationHours: 24
    })
  });
  console.log('Status:', res.status);
  console.log('Body:', await res.json());
}
run();
