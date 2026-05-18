import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function ok(body: object) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { code, entries, replace } = await req.json()

    if (!code || !Array.isArray(entries)) {
      return ok({ success: false, error: 'code e entries são obrigatórios' })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Valida código e obtém playlist_id
    const { data: pairing, error: pairingError } = await supabase
      .from('pairing_codes')
      .select('user_id, expires_at, playlist_id')
      .eq('code', code)
      .single()

    if (pairingError || !pairing || !pairing.playlist_id) {
      return ok({ success: false, error: 'Código inválido ou sem playlist associada' })
    }

    if (new Date(pairing.expires_at) < new Date()) {
      return ok({ success: false, error: 'Código expirado' })
    }

    const playlistId = pairing.playlist_id

    // Na primeira batch (replace=true), limpa o catálogo anterior
    if (replace) {
      await supabase
        .from('playlist_content')
        .delete()
        .eq('playlist_id', playlistId)
    }

    if (entries.length === 0) {
      return ok({ success: true, inserted: 0 })
    }

    // Garante campos obrigatórios e injeta playlist_id
    const rows = entries.map((e: any) => ({
      playlist_id:   playlistId,
      name:          String(e.name || '').slice(0, 500),
      logo_url:      String(e.logo_url || ''),
      group_title:   String(e.group_title || ''),
      content_type:  ['live', 'movie', 'series'].includes(e.content_type) ? e.content_type : 'live',
      stream_id:     String(e.stream_id || ''),
      episode_count: Number(e.episode_count) || 1,
      synced_at:     new Date().toISOString(),
    }))

    const { error: insertError } = await supabase
      .from('playlist_content')
      .upsert(rows, { onConflict: 'playlist_id,content_type,name', ignoreDuplicates: false })

    if (insertError) throw insertError

    // Atualiza contadores na playlist (só na última batch)
    if (replace !== false) {
      const { count } = await supabase
        .from('playlist_content')
        .select('*', { count: 'exact', head: true })
        .eq('playlist_id', playlistId)

      await supabase
        .from('playlists')
        .update({ last_synced_at: new Date().toISOString(), content_count: count ?? 0 })
        .eq('id', playlistId)
    }

    return ok({ success: true, inserted: rows.length })
  } catch (err: any) {
    return ok({ success: false, error: err?.message ?? String(err) })
  }
})
