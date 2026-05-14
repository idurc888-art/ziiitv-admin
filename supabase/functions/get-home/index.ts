import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

const TMDB_IMG = (path: string | null, size: string) =>
  path ? (path.startsWith('http') ? path : `https://image.tmdb.org/t/p/${size}${path}`) : null

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const url = new URL(req.url)
    const deviceId = url.searchParams.get('device_id') || ''

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data: sections } = await supabase
      .from('home_sections')
      .select('*')
      .eq('active', true)
      .order('sort_order')

    if (!sections?.length) {
      return new Response(JSON.stringify({ sections: [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const result = await Promise.all(sections.map(async (section: any) => {
      let items: any[] = []

      if (section.type === 'continue_watching') {
        if (!deviceId) return { ...section, items: [] }

        const { data: history } = await supabase
          .from('watch_history')
          .select('canonical_id, channel_name, progress_pct, watched_at')
          .eq('device_id', deviceId)
          .not('canonical_id', 'is', null)
          .order('watched_at', { ascending: false })
          .limit(20)

        const ids = [...new Set((history || []).map((r: any) => r.canonical_id))]
        if (ids.length > 0) {
          const { data: canonical } = await supabase
            .from('canonical_titles')
            .select('id, title, poster, backdrop, type')
            .in('id', ids)

          const byId = new Map((canonical || []).map((c: any) => [c.id, c]))
          items = (history || [])
            .map((r: any) => {
              const c = byId.get(r.canonical_id)
              if (!c) return null
              return {
                canonical_id: c.id,
                title: c.title,
                poster: TMDB_IMG(c.poster, 'w342'),
                backdrop: TMDB_IMG(c.backdrop, 'w780'),
                type: c.type,
                progress_pct: r.progress_pct,
                watched_at: r.watched_at,
              }
            })
            .filter(Boolean)
        }

      } else if (section.type === 'editorial') {
        const { data } = await supabase
          .from('section_items')
          .select(`
            sort_order, title_override, poster_override, backdrop_override,
            canonical:canonical_titles (id, title, poster, backdrop, type, rating)
          `)
          .eq('section_id', section.id)
          .eq('active', true)
          .order('sort_order')

        items = (data || []).map((item: any) => {
          const c = item.canonical
          return {
            canonical_id: c?.id || null,
            title: item.title_override || c?.title || '',
            poster: item.poster_override || TMDB_IMG(c?.poster, 'w342'),
            backdrop: item.backdrop_override || TMDB_IMG(c?.backdrop, 'w780'),
            type: c?.type || null,
            rating: c?.rating || null,
          }
        })

      } else if (section.type === 'canonical') {
        let query = supabase
          .from('canonical_titles')
          .select('id, title, poster, backdrop, type, rating, year, streaming')
          .not('poster', 'is', null)
          .order('rating', { ascending: false })
          .limit(30)

        if (section.source) query = query.eq('type', section.source)

        const { data } = await query
        items = (data || []).map((c: any) => ({
          canonical_id: c.id,
          title: c.title,
          poster: TMDB_IMG(c.poster, 'w342'),
          backdrop: TMDB_IMG(c.backdrop, 'w780'),
          type: c.type,
          rating: c.rating,
          year: c.year,
          streaming: c.streaming,
        }))
      }

      return {
        id: section.id,
        title: section.title,
        subtitle: section.subtitle,
        type: section.type,
        source: section.source,
        items,
      }
    }))

    return new Response(JSON.stringify({ sections: result }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
