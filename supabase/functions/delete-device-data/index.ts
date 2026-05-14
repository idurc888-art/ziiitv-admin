import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { device_id } = await req.json()
    if (!device_id) return new Response(JSON.stringify({ error: 'device_id required' }), { status: 400, headers: corsHeaders })

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } }
    )

    // 1. Busca tv_session para obter user_id e playlist_url
    const { data: session } = await supabase
      .from('tv_sessions')
      .select('user_id, playlist_url')
      .eq('device_id', device_id)
      .single()

    if (session?.user_id && session?.playlist_url) {
      // 2. Encontra playlists associadas a esse user + url
      const { data: playlists } = await supabase
        .from('playlists')
        .select('id')
        .eq('user_id', session.user_id)
        .eq('url_original', session.playlist_url)

      for (const pl of playlists ?? []) {
        // 3. Busca canais da playlist
        const { data: channelRows } = await supabase
          .from('channels')
          .select('id')
          .eq('playlist_id', pl.id)

        const channelIds = channelRows?.map(c => c.id) ?? []

        // 4. Desvincula watch_events (preserva histórico)
        if (channelIds.length > 0) {
          await supabase
            .from('watch_events')
            .update({ channel_id: null })
            .in('channel_id', channelIds)
        }

        // 5. Deleta canais
        await supabase.from('channels').delete().eq('playlist_id', pl.id)

        // 6. Deleta playlist
        await supabase.from('playlists').delete().eq('id', pl.id)
      }
    }

    // 7. Deleta tv_session
    await supabase.from('tv_sessions').delete().eq('device_id', device_id)

    // 8. Deleta pair_tokens do device
    await supabase.from('pair_tokens').delete().eq('device_id', device_id)

    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders })
  }
})
