import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

// Limites por content_type para não explodir o payload (293k canais no total)
const MAX_UNENRICHED = 8000

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const url = new URL(req.url)
    const code = url.searchParams.get('code')
    const cursorValue = Number.parseInt(url.searchParams.get('cursor') ?? '0', 10)
    const cursor = Number.isFinite(cursorValue) && cursorValue >= 0 ? cursorValue : 0
    const requestedImportId = url.searchParams.get('import_id')

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

    // ── Playlist Xtream: retorna URL M3U para a TV buscar diretamente (IP residencial) ──
    if (pairing.playlist_id) {
      const { data: playlist } = await supabase
        .from('playlists')
        .select('url_original, presentation_mode, home_id, active_import_id')
        .eq('id', pairing.playlist_id)
        .single()

      if (playlist?.active_import_id) {
        if (requestedImportId && requestedImportId !== playlist.active_import_id) {
          return new Response(JSON.stringify({ error: 'Playlist version changed', restart: true }), {
            status: 409,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        }
        const pageSize = 750
        const { data, error } = await supabase.rpc('service_get_active_playlist_items', {
          p_playlist_id: pairing.playlist_id,
          p_offset: cursor,
          p_limit: pageSize,
        })
        if (error) throw error
        const channels: any[] = data ?? []

        let homeId: string | null = playlist.home_id ?? null
        if (!homeId) {
          const { data: activeHome } = await supabase.from('homes').select('id').eq('is_active', true).maybeSingle()
          homeId = activeHome?.id ?? null
        }
        let homeSections: any[] = []
        if (homeId) {
          const { data } = await supabase.from('home_sections')
            .select('id, title, type, sort_order, active, config')
            .eq('home_id', homeId).eq('active', true).order('sort_order')
          homeSections = data ?? []
        }

        return new Response(JSON.stringify({
          contract_version: 'playlist-v2',
          import_id: playlist.active_import_id,
          next_cursor: channels.length === pageSize ? cursor + channels.length : null,
          presentation_mode: playlist.presentation_mode ?? 'auto',
          home_sections: homeSections,
          channels,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      if (playlist?.url_original && playlist.url_original.includes('get.php?username=')) {
        const presentationMode: string = (playlist as any).presentation_mode ?? 'auto'

        if (presentationMode === 'curated') {
          // ── Curado: TV usa home sections + API Xtream diretamente ─────────
          const playlistHomeId: string | null = (playlist as any).home_id ?? null
          let homeId: string | null = playlistHomeId

          if (!homeId) {
            const { data: activeHome } = await supabase
              .from('homes')
              .select('id')
              .eq('is_active', true)
              .single()
            homeId = activeHome?.id ?? null
          }

          let homeSections: any[] = []
          if (homeId) {
            const { data: sections } = await supabase
              .from('home_sections')
              .select('id, title, type, sort_order, active, config')
              .eq('home_id', homeId)
              .eq('active', true)
              .order('sort_order')
            homeSections = sections ?? []
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

        // ── Auto: usa channels do banco SE playlist foi processada/enriquecida ─
        const { count: channelCount } = await supabase
          .from('channels')
          .select('id', { count: 'exact', head: true })
          .eq('playlist_id', pairing.playlist_id)
          .eq('active', true)
          .not('canonical_id', 'is', null)
          .limit(1)

        if (!channelCount || channelCount < 10) {
          return new Response(JSON.stringify({
            xtream: true,
            m3u_url: playlist.url_original,
            presentation_mode: 'auto',
            home_sections: [],
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        }
        // playlist enriquecida → cai no SELECT abaixo
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
