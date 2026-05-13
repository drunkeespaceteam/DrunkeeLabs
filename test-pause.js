import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const mentorId = '00000000-0000-0000-0000-000000000000'; // dummy uuid or we can query an existing user
  const { data: user } = await supabase.from('users').select('id').limit(1).single();
  if(!user) return console.log('no user');

  const { data: task, error: err1 } = await supabase.from('tasks').insert({
    mentor_id: user.id,
    title: 'Test',
    description: 'Test',
    reward: 100,
    category: 'web',
    difficulty: 'easy'
  }).select().single();
  
  if(err1) return console.log('Task insert fail:', err1);

  const { data: sub, error: err2 } = await supabase.from('submissions').insert({
    task_id: task.id,
    user_id: user.id,
    is_winner: true,
    delivery_status: 'submitted'
  }).select().single();

  if(err2) return console.log('Sub insert fail:', err2);

  console.log('Hitting API...');
  const res = await fetch(`http://localhost:3001/api/submissions/${sub.id}/pause-review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mentorId: user.id,
      reason: 'Testing pause',
      category: 'other',
      durationHours: 24
    })
  });
  console.log('Status:', res.status);
  console.log('Body:', await res.json());
}
run();
