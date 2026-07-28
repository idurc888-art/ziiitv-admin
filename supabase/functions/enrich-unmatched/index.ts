import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!
const SUPABASE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const TMDB_KEY      = Deno.env.get('TMDB_API_KEY')!

const DB_PAGE       = 5000  // canais por página do banco
const MAX_TMDB      = 300   // máx TMDB calls por invocação (evita timeout)
const TMDB_DELAY_MS = 260   // ~3.8 req/s → seguro abaixo do limite 40/10s
const TMDB_IMG      = 'https://image.tmdb.org/t/p/'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function slugify(name: string): string {
  return name.toLowerCase()
    .replace(/['''ʼ]/g, '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function stripEpisode(name: string): string {
  return name
    .replace(/\bS\d{1,2}E\d{1,4}\b/gi, '')
    .replace(/\bT\d{1,2}E\d{1,4}\b/gi, '')
    .replace(/\bEP?\d{1,4}\b/gi, '')
    .trim()
}

async function db(path: string, method = 'GET', body?: unknown, extra: Record<string,string> = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
      ...extra,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok && res.status !== 206) {
    const text = await res.text()
    throw new Error(`DB ${method} ${path} → ${res.status}: ${text.slice(0, 200)}`)
  }
  const text = await res.text()
  return text ? JSON.parse(text) : []
}

async function tmdbSearch(query: string, type: 'series' | 'movie'): Promise<Record<string,unknown> | null> {
  const endpoint = type === 'series' ? 'search/tv' : 'search/movie'
  const url = `https://api.themoviedb.org/3/${endpoint}?api_key=${TMDB_KEY}&query=${encodeURIComponent(query)}&language=pt-BR&include_adult=false`
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const data = await res.json() as { results?: Record<string,unknown>[] }
    return data.results?.[0] ?? null
  } catch { return null }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { playlist_id, offset = 0 } = await req.json() as {
      playlist_id: string
      offset?: number
    }

    if (!playlist_id) throw new Error('playlist_id obrigatório')

    // 1. Busca canais sem canonical_id desta playlist (séries + filmes)
    const channels: Array<{id: string; name: string; content_type: string; streaming: string | null}> =
      await db(
        `channels?playlist_id=eq.${playlist_id}&canonical_id=is.null&content_type=in.(series,movie)&select=id,name,content_type,streaming&limit=${DB_PAGE}&offset=${offset}`
      )

    if (channels.length === 0) {
      return new Response(JSON.stringify({ done: true, processed: 0, matched: 0 }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    // 2. Agrupa por (slug_base, content_type) — dedup de episódios
    const titleMap = new Map<string, {
      slug: string
      baseName: string
      contentType: string
      channelIds: string[]
    }>()

    for (const ch of channels) {
      const base = ch.content_type === 'series' ? stripEpisode(ch.name) : ch.name
      if (!base || base.length < 2) continue
      const slug = slugify(base)
      if (!slug) continue
      const key = `${ch.content_type}:${slug}`
      if (titleMap.has(key)) {
        titleMap.get(key)!.channelIds.push(ch.id)
      } else {
        titleMap.set(key, { slug, baseName: base, contentType: ch.content_type, channelIds: [ch.id] })
      }
    }

    // 3. Todos os títulos únicos desta página — sem limite artificial
    const entries = [...titleMap.values()]
    const totalUnique = entries.length

    // 4. Verifica slug_identity_map em batch
    const slugsToCheck = entries.map(e => e.slug)
    const cached: Array<{slug: string; canonical_id: string}> = slugsToCheck.length > 0
      ? await db(`slug_identity_map?slug=in.(${slugsToCheck.map(s => `"${s}"`).join(',')})&select=slug,canonical_id`)
      : []
    const cacheMap = new Map(cached.map(c => [c.slug, c.canonical_id]))

    // 5. Processa cada título único (para no MAX_TMDB para não estourar timeout)
    const updates: Array<{channelIds: string[]; canonicalId: string}> = []
    const newCanonicals: unknown[] = []
    const newSlugs: unknown[] = []
    let tmdbHits = 0
    let cacheHits = 0
    let tmdbCallsMade = 0

    for (const entry of entries) {
      // 5a. Cache hit
      const cached = cacheMap.get(entry.slug)
      if (cached) {
        updates.push({ channelIds: entry.channelIds, canonicalId: cached })
        cacheHits++
        continue
      }

      // 5b. Busca em canonical_titles por slug
      const existing: Array<{id: string}> = await db(
        `canonical_titles?slug=eq.${encodeURIComponent(entry.slug)}&select=id&limit=1`
      )
      if (existing.length > 0) {
        const cid = existing[0].id
        updates.push({ channelIds: entry.channelIds, canonicalId: cid })
        newSlugs.push({ slug: entry.slug, canonical_id: cid, content_type: entry.contentType, source: 'catalog' })
        cacheHits++
        continue
      }

      // 5c. TMDB search — para se atingiu o limite de calls desta invocação
      if (tmdbCallsMade >= MAX_TMDB) continue
      await new Promise(r => setTimeout(r, TMDB_DELAY_MS))
      const result = await tmdbSearch(entry.baseName, entry.contentType as 'series' | 'movie')
      tmdbCallsMade++
      if (!result) continue

      const tmdbTitle    = (entry.contentType === 'series' ? result.name : result.title) as string || entry.baseName
      const tmdbSlug     = slugify(tmdbTitle)
      const prefix       = entry.contentType === 'series' ? 'serie' : 'filme'
      const canonicalId  = `${prefix}-${tmdbSlug}`

      // Verifica se canonical_title já existe (pelo tmdb_id ou pelo slug gerado)
      const existBySlug: Array<{id: string}> = await db(
        `canonical_titles?slug=eq.${encodeURIComponent(tmdbSlug)}&select=id&limit=1`
      )

      if (existBySlug.length > 0) {
        const cid = existBySlug[0].id
        updates.push({ channelIds: entry.channelIds, canonicalId: cid })
        newSlugs.push({ slug: entry.slug, canonical_id: cid, content_type: entry.contentType, source: 'tmdb' })
        if (entry.slug !== tmdbSlug) {
          newSlugs.push({ slug: tmdbSlug, canonical_id: cid, content_type: entry.contentType, source: 'tmdb' })
        }
        tmdbHits++
        continue
      }

      // Cria novo canonical_title
      const dateField  = entry.contentType === 'series' ? result.first_air_date : result.release_date
      const year       = dateField ? String(dateField).slice(0, 4) : null
      const posterPath = result.poster_path as string | null
      const backdropPath = result.backdrop_path as string | null

      const canonical = {
        id:            canonicalId,
        slug:          tmdbSlug,
        title:         tmdbTitle,
        original_title: entry.contentType === 'series' ? result.original_name : result.original_title,
        alt_titles:    entry.slug !== tmdbSlug ? [entry.baseName] : [],
        match_hints:   [],
        type:          entry.contentType === 'series' ? 'series' : 'movie',
        streaming:     entry.contentType === 'series' ? 'serie' : 'filme',
        tmdb_id:       result.id as number,
        year,
        rating:        result.vote_average as number ?? null,
        overview:      result.overview as string ?? null,
        poster:        posterPath ? `${TMDB_IMG}w342${posterPath}` : null,
        backdrop:      backdropPath ? `${TMDB_IMG}w780${backdropPath}` : null,
        genres:        [],
        priority:      false,
        vote_count:    result.vote_count as number ?? null,
        popularity:    result.popularity as number ?? null,
      }

      newCanonicals.push(canonical)
      updates.push({ channelIds: entry.channelIds, canonicalId: canonicalId })
      newSlugs.push({ slug: entry.slug, canonical_id: canonicalId, content_type: entry.contentType, source: 'tmdb' })
      if (entry.slug !== tmdbSlug) {
        newSlugs.push({ slug: tmdbSlug, canonical_id: canonicalId, content_type: entry.contentType, source: 'tmdb' })
      }
      tmdbHits++
    }

    // 6. Salva novos canonical_titles em batch
    if (newCanonicals.length > 0) {
      await db('canonical_titles', 'POST', newCanonicals, { Prefer: 'return=minimal' })
    }

    // 7. Atualiza slug_identity_map em batch — dedup por slug antes de inserir
    if (newSlugs.length > 0) {
      const slugsSeen = new Map<string, unknown>()
      for (const s of newSlugs) {
        if (!slugsSeen.has((s as any).slug)) slugsSeen.set((s as any).slug, s)
      }
      const dedupedSlugs = [...slugsSeen.values()]
      for (let i = 0; i < dedupedSlugs.length; i += 300) {
        await db('slug_identity_map', 'POST', dedupedSlugs.slice(i, i + 300), { Prefer: 'return=minimal,resolution=ignore-duplicates' })
      }
    }

    // 8. Atualiza channels com canonical_id em batch por canonical
    let channelsUpdated = 0
    // Agrupa por canonical_id para minimizar requests
    const byCanonical = new Map<string, string[]>()
    for (const u of updates) {
      const existing = byCanonical.get(u.canonicalId) ?? []
      byCanonical.set(u.canonicalId, [...existing, ...u.channelIds])
    }

    for (const [canonicalId, ids] of byCanonical) {
      for (let i = 0; i < ids.length; i += 300) {
        const batch = ids.slice(i, i + 300)
        await db(
          `channels?id=in.(${batch.join(',')})`,
          'PATCH',
          { canonical_id: canonicalId, enriched: true }
        )
        channelsUpdated += batch.length
      }
    }

    // Avança para a próxima página de canais do banco
    const hasMore = channels.length === DB_PAGE
    const nextOffset = hasMore ? offset + DB_PAGE : null

    return new Response(JSON.stringify({
      done:             !hasMore,
      processed:        entries.length,
      totalUnique,
      matched:          updates.length,
      channelsUpdated,
      cacheHits,
      tmdbHits,
      newCanonicals:    newCanonicals.length,
      nextOffset,
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } })

  } catch (err) {
    console.error('[enrich-unmatched]', err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
