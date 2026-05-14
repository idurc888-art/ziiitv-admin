require('dotenv').config({ path: './.env' });
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function clean() {
  console.log('Deletando canais...');
  await supabase.from('channels').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  console.log('Deletando playlists...');
  await supabase.from('playlists').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  
  const { count } = await supabase.from('channels').select('*', { count: 'exact', head: true });
  console.log(`\nSELECT COUNT(*) FROM channels;\nResultado: ${count}`);
}

clean().catch(console.error);
