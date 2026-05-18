import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

async function fetchCat(url: string): Promise<{ data: any; status: number; raw: string }> {
  try {
    const r   = await fetch(url, { signal: AbortSignal.timeout(12000) })
    const raw = await r.text()
    let data: any = []
    try { data = JSON.parse(raw) } catch { /* not JSON */ }
    return { data, status: r.status, raw: raw.slice(0, 300) }
  } catch (e: any) {
    return { data: [], status: 0, raw: e?.message ?? String(e) }
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: cors })

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: cors })

    const url = new URL(req.url)
    const pid = url.searchParams.get('playlist_id')
    if (!pid) return new Response(JSON.stringify({ error: 'Missing playlist_id' }), { status: 400, headers: cors })

    const { data: playlist } = await supabase
      .from('playlists')
      .select('url_original')
      .eq('id', pid)
      .eq('user_id', user.id)
      .single()

    if (!playlist) return new Response(JSON.stringify({ error: 'Playlist not found' }), { status: 404, headers: cors })

    const pu       = new URL(playlist.url_original)
    const host     = pu.origin
    const username = pu.searchParams.get('username') ?? ''
    const password = pu.searchParams.get('password') ?? ''
    const api      = `${host}/player_api.php?username=${username}&password=${password}`

    console.log(`[proxy-xtream] fetching from ${host} for user ${username}`)

    const [liveRes, vodRes, seriesRes] = await Promise.all([
      fetchCat(`${api}&action=get_live_categories`),
      fetchCat(`${api}&action=get_vod_categories`),
      fetchCat(`${api}&action=get_series_categories`),
    ])

    console.log(`[proxy-xtream] live status=${liveRes.status} isArray=${Array.isArray(liveRes.data)} raw=${liveRes.raw}`)
    console.log(`[proxy-xtream] vod  status=${vodRes.status}  isArray=${Array.isArray(vodRes.data)}`)
    console.log(`[proxy-xtream] series status=${seriesRes.status} isArray=${Array.isArray(seriesRes.data)}`)

    const live   = Array.isArray(liveRes.data)   ? liveRes.data   : []
    const vod    = Array.isArray(vodRes.data)     ? vodRes.data    : []
    const series = Array.isArray(seriesRes.data)  ? seriesRes.data : []

    // Debug info if nothing came back
    const debug = (live.length + vod.length + series.length === 0) ? {
      liveRaw:   liveRes.raw,
      vodRaw:    vodRes.raw,
      seriesRaw: seriesRes.raw,
      liveStatus:   liveRes.status,
      vodStatus:    vodRes.status,
      seriesStatus: seriesRes.status,
    } : undefined

    return new Response(JSON.stringify({ live, vod, series, debug }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message ?? String(err) }), {
      status: 500,
      headers: cors,
    })
  }
})
