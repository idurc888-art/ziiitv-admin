import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function checkCode() {
  // 1. Verificar código
  const { data: code, error: codeError } = await supabase
    .from('pairing_codes')
    .select('*')
    .eq('code', 'ZIII-5XT6')
    .single()

  console.log('\n=== CÓDIGO ZIII-5XT6 ===')
  console.log(JSON.stringify(code, null, 2))
  if (codeError) console.log('Erro:', codeError.message)

  if (!code) {
    console.log('\n❌ Código não encontrado!')
    return
  }

  // 2. Verificar canais do usuário
  const { data: channels, error: channelsError } = await supabase
    .from('channels')
    .select('id, name, canonical_id, streaming, content_type')
    .eq('user_id', code.user_id)
    .limit(10)

  console.log('\n=== CANAIS (primeiros 10) ===')
  console.log(JSON.stringify(channels, null, 2))
  if (channelsError) console.log('Erro:', channelsError.message)

  // 3. Contar total
  const { count } = await supabase
    .from('channels')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', code.user_id)

  console.log(`\n=== TOTAL: ${count} canais ===`)
}

checkCode().catch(console.error)
