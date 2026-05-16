import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const generateCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = 'ZIII-'
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return code
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), { status: 401, headers: corsHeaders })
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })
    }

    const body = await req.json().catch(() => ({}))
    const playlist_id: string | null = body.playlist_id ?? null

    // Verifica se já existe código ativo para esta playlist específica
    let existingQuery = supabase
      .from('pairing_codes')
      .select('code')
      .eq('user_id', user.id)
      .gt('expires_at', new Date().toISOString())

    if (playlist_id) {
      existingQuery = existingQuery.eq('playlist_id', playlist_id)
    } else {
      existingQuery = existingQuery.is('playlist_id', null)
    }

    const { data: existing } = await existingQuery.single()

    if (existing) {
      return new Response(JSON.stringify({ code: existing.code }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Gera novo código único
    let code = generateCode()
    let attempts = 0
    while (attempts < 10) {
      const { data: collision } = await supabase
        .from('pairing_codes')
        .select('code')
        .eq('code', code)
        .single()
      if (!collision) break
      code = generateCode()
      attempts++
    }

    const row: Record<string, any> = {
      code,
      user_id: user.id,
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    }
    if (playlist_id) row.playlist_id = playlist_id

    const { error } = await supabase.from('pairing_codes').insert(row)
    if (error) throw error

    return new Response(JSON.stringify({ code }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
