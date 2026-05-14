require('dotenv').config({ path: './.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
  const { count, error } = await supabase
    .from('channels')
    .select('*', { count: 'exact', head: true })
    .not('canonical_id', 'is', null);
    
  const { count: total } = await supabase
    .from('channels')
    .select('*', { count: 'exact', head: true });

  console.log('Total de canais:', total);
  console.log('Canais com canonical_id:', count);
}
check();
