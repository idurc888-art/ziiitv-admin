import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

// Limites por content_type para não explodir o payload (293k canais no total)
// TMDB-enriched: sem limite (geralmente poucos)
// Live: sem limite (geralmente poucos)
// Series / Movie sem TMDB: top N por streaming — suficiente para a home
const MAX_UNENRICHED = 8000

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const url = new URL(req.url)
    const code = url.searchParams.get('code')

    if (!code) {
      return new Response(JSON.stringify({ error: 'Missing code parameter' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // Valida código
    const { data: pairing, error: pairingError } = await supabase
      .from('pairing_codes')
      .select('user_id, expires_at, playlist_id')
      .eq('code', code)
      .single()

    if (pairingError || !pairing) {
      return new Response(JSON.stringify({ error: 'Invalid code' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (new Date(pairing.expires_at) < new Date()) {
      return new Response(JSON.stringify({ error: 'Code expired' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    await supabase.from('pairing_codes').update({ last_used_at: new Date().toISOString() }).eq('code', code)

    // Playlist Xtream: retorna URL M3U para a TV buscar diretamente (IP residencial)
    if (pairing.playlist_id) {
      const { data: playlist } = await supabase
        .from('playlists')
        .select('url_original, presentation_mode')
        .eq('id', pairing.playlist_id)
        .single()

      if (playlist?.url_original && playlist.url_original.includes('get.php?username=')) {
        const presentationMode: string = (playlist as any).presentation_mode ?? 'auto'
        let homeSections: any[] = []

        if (presentationMode === 'curated') {
          // Busca seções da home ativa
          const { data: activeHome } = await supabase
            .from('homes')
            .select('id')
            .eq('is_active', true)
            .single()

          if (activeHome?.id) {
            const { data: sections } = await supabase
              .from('home_sections')
              .select('id, title, type, sort_order, active, config')
              .eq('home_id', activeHome.id)
              .eq('active', true)
              .order('sort_order')
            homeSections = sections ?? []
          }
        }

        return new Response(JSON.stringify({
          xtream: true,
          m3u_url: playlist.url_original,
          presentation_mode: presentationMode,
          home_sections: homeSections,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }

    const SELECT_FIELDS = `
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
    `

    const baseQuery = () => {
      let q = supabase
        .from('channels')
        .select(SELECT_FIELDS)
        .eq('user_id', pairing.user_id)
        .eq('active', true)
      // Se o código for por playlist, filtra só canais daquela playlist
      if (pairing.playlist_id) {
        q = q.eq('playlist_id', pairing.playlist_id)
      }
      return q
    }

    // ── 1. Canais TMDB-enriched (canonical_id preenchido) — todos ────────────
    const enrichedChannels: any[] = []
    {
      let page = 0
      const pageSize = 1000
      while (true) {
        const { data, error } = await baseQuery()
          .not('canonical_id', 'is', null)
          .range(page * pageSize, (page + 1) * pageSize - 1)
        if (error) throw error
        if (!data || data.length === 0) break
        enrichedChannels.push(...data)
        if (data.length < pageSize) break
        page++
      }
    }

    // ── 2. Live TV sem canonical_id ──────────────────────────────────────────
    const liveChannels: any[] = []
    {
      let page = 0
      const pageSize = 1000
      while (true) {
        const { data, error } = await baseQuery()
          .is('canonical_id', null)
          .eq('content_type', 'live')
          .range(page * pageSize, (page + 1) * pageSize - 1)
        if (error) throw error
        if (!data || data.length === 0) break
        liveChannels.push(...data)
        if (data.length < pageSize) break
        page++
      }
    }

    // ── 3. Séries e filmes sem TMDB — top N ordenados por streaming ──────────
    // Retorna canais com streaming identificado primeiro (melhor para a UI)
    const unenrichedChannels: any[] = []
    {
      let page = 0
      const pageSize = 1000
      while (unenrichedChannels.length < MAX_UNENRICHED) {
        const { data, error } = await baseQuery()
          .is('canonical_id', null)
          .in('content_type', ['series', 'movie'])
          .order('streaming', { ascending: false, nullsFirst: false })
          .range(page * pageSize, (page + 1) * pageSize - 1)
        if (error) throw error
        if (!data || data.length === 0) break
        unenrichedChannels.push(...data)
        if (data.length < pageSize) break
        page++
        if (unenrichedChannels.length >= MAX_UNENRICHED) break
      }
    }

    const allChannels = [...enrichedChannels, ...liveChannels, ...unenrichedChannels]

    return new Response(JSON.stringify({ channels: allChannels }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error?.message ?? String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
