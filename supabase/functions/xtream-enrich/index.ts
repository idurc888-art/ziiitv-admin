import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface VodMeta {
  backdrop: string | null
  plot: string | null
  rating: number | null
  year: string | null
  tmdb_id: number | null
  cast: string | null
  director: string | null
}

function resolveBackdrop(backdropRaw: any): string | null {
  const raw = Array.isArray(backdropRaw) ? backdropRaw[0] : backdropRaw
  if (!raw || typeof raw !== 'string') return null
  if (raw.startsWith('http')) return raw  // já é URL completa
  return `https://image.tmdb.org/t/p/w780${raw}`
}

async function fetchVodInfo(base: string, username: string, password: string, vodId: string): Promise<VodMeta | null> {
  try {
    const url = `${base}/player_api.php?username=${username}&password=${password}&action=get_vod_info&vod_id=${vodId}`
    const res = await fetch(url)
    if (!res.ok) { console.error(`[vod_info] HTTP ${res.status} para vod_id=${vodId}`); return null }
    const data = await res.json()
    const info = data?.info
    if (!info) { console.error(`[vod_info] sem info para vod_id=${vodId}`, JSON.stringify(data).slice(0,200)); return null }

    return {
      backdrop: resolveBackdrop(info.backdrop_path),
      plot: info.plot || info.description || null,
      rating: info.rating ? parseFloat(String(info.rating)) : null,
      year: info.release_date ? String(info.release_date).slice(0, 4) : (info.releasedate ? String(info.releasedate).slice(0, 4) : null),
      tmdb_id: info.tmdb_id ? parseInt(String(info.tmdb_id)) : (info.tmdb ? parseInt(String(info.tmdb)) : null),
      cast: info.cast || info.actors || null,
      director: info.director || null,
    }
  } catch (e) {
    console.error(`[vod_info] erro vod_id=${vodId}:`, e)
    return null
  }
}

async function fetchSeriesInfo(base: string, username: string, password: string, seriesId: string): Promise<VodMeta | null> {
  try {
    const url = `${base}/player_api.php?username=${username}&password=${password}&action=get_series_info&series_id=${seriesId}`
    const res = await fetch(url)
    if (!res.ok) return null
    const data = await res.json()
    const info = data?.info
    if (!info) return null

    return {
      backdrop: resolveBackdrop(info.backdrop_path),
      plot: info.plot || null,
      rating: info.rating ? parseFloat(String(info.rating)) : null,
      year: info.release_date ? String(info.release_date).slice(0, 4) : (info.releasedate ? String(info.releasedate).slice(0, 4) : null),
      tmdb_id: info.tmdb_id ? parseInt(String(info.tmdb_id)) : null,
      cast: info.cast || null,
      director: null,
    }
  } catch (e) {
    console.error(`[series_info] erro series_id=${seriesId}:`, e)
    return null
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { base_url, username, password, items } = await req.json() as {
      base_url: string
      username: string
      password: string
      items: Array<{ id: string; type: 'movie' | 'series' }>
    }

    if (!base_url || !username || !password || !Array.isArray(items) || items.length === 0) {
      return new Response(JSON.stringify({ error: 'base_url, username, password e items são obrigatórios' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Máximo de 50 itens por chamada para não explodir o timeout
    const batch = items.slice(0, 50)

    // Processa em paralelo com chunks de 10
    const results: Record<string, VodMeta | null> = {}
    const chunkSize = 10

    for (let i = 0; i < batch.length; i += chunkSize) {
      const chunk = batch.slice(i, i + chunkSize)
      await Promise.all(chunk.map(async (item) => {
        const meta = item.type === 'series'
          ? await fetchSeriesInfo(base_url, username, password, item.id)
          : await fetchVodInfo(base_url, username, password, item.id)
        results[item.id] = meta
      }))
    }

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message ?? String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
