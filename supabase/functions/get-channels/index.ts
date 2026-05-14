import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const url = new URL(req.url)
    const code = url.searchParams.get('code')
    
    if (!code) {
      return new Response(JSON.stringify({ error: 'Missing code parameter' }), { 
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // Valida código
    const { data: pairing, error: pairingError } = await supabase
      .from('pairing_codes')
      .select('user_id, expires_at')
      .eq('code', code)
      .single()

    if (pairingError || !pairing) {
      return new Response(JSON.stringify({ error: 'Invalid code' }), { 
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (new Date(pairing.expires_at) < new Date()) {
      return new Response(JSON.stringify({ error: 'Code expired' }), { 
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Atualiza last_used_at
    await supabase.from('pairing_codes').update({ last_used_at: new Date().toISOString() }).eq('code', code)

    // Busca apenas canais matched (canonical_id preenchido) paginando
    let allChannels: any[] = []
    let page = 0
    const pageSize = 1000

    while (true) {
      const { data: channels, error } = await supabase
        .from('channels')
        .select(`
          id,
          name,
          streams,
          group_name,
          logo_url,
          canonical_id,
          content_type,
          streaming,
          canonical_titles (
            title,
            type,
            streaming,
            tmdb_id,
            year,
            rating,
            overview,
            poster,
            backdrop,
            genres,
            director,
            age_rating,
            duration,
            trailer_url
          )
        `)
        .eq('user_id', pairing.user_id)
        .eq('active', true)
        .or('canonical_id.not.is.null,content_type.eq.live')
        .range(page * pageSize, (page + 1) * pageSize - 1)

      if (error) throw error
      if (!channels || channels.length === 0) break

      // Strip castinfo (não usado na TV, reduz payload drasticamente)
      allChannels.push(...channels)
      if (channels.length < pageSize) break
      page++
    }

    return new Response(JSON.stringify({ channels: allChannels }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { 
      status: 500, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    })
  }
})
