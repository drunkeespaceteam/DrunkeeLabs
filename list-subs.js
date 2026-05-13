import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data: subs } = await supabase.from('submissions').select('id').eq('is_winner', true).limit(5);
  console.log(JSON.stringify(subs, null, 2));
}
run();
