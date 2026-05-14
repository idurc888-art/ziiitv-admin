// TMDB helper para o admin — sem cache IndexedDB (browser moderno, não Tizen)
// Rate limit TMDB free tier: 40 req/10s

const API_KEY = 'b68afbadedebf0889f00a0cf577d3e5a'
const BASE = 'https://api.themoviedb.org/3'
const IMG = 'https://image.tmdb.org/t/p'

export interface TMDBData {
  tmdb_id: number
  title: string
  poster: string
  backdrop: string
  overview: string
  rating: number
  year: string
}

// ─── fetch com retry em 429 ──────────────────────────────────────────────────
async function tmdbFetch(url: string, attempt = 0): Promise<any | null> {
  try {
    const res = await fetch(url)
    if (res.status === 429) {
      if (attempt >= 3) return null
      await new Promise(r => setTimeout(r, 2000 * (attempt + 1)))
      return tmdbFetch(url, attempt + 1)
    }
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

// ─── Busca um título pelo nome + tipo ─────────────────────────────────────────
export async function searchTMDB(
  query: string,
  type: 'movie' | 'tv'
): Promise<TMDBData | null> {
  const endpoint = type === 'movie' ? '/search/movie' : '/search/tv'
  const data = await tmdbFetch(
    `${BASE}${endpoint}?api_key=${API_KEY}&query=${encodeURIComponent(query)}&language=pt-BR`
  )
  const item = data?.results?.[0]
  if (!item) return null

  return {
    tmdb_id:  item.id,
    title:    item.title || item.name || query,
    poster:   item.poster_path   ? `${IMG}/w342${item.poster_path}`   : '',
    backdrop: item.backdrop_path ? `${IMG}/w780${item.backdrop_path}` : '',
    overview: item.overview || '',
    rating:   item.vote_average || 0,
    year:     (item.release_date || item.first_air_date || '').substring(0, 4),
  }
}

// Tenta o tipo certo primeiro, fallback no oposto
export async function searchTMDBAuto(
  query: string,
  contentType: 'movie' | 'series'
): Promise<TMDBData | null> {
  const primary:  'movie' | 'tv' = contentType === 'movie' ? 'movie' : 'tv'
  const fallback: 'movie' | 'tv' = contentType === 'movie' ? 'tv'    : 'movie'
  return (await searchTMDB(query, primary)) ?? (await searchTMDB(query, fallback))
}

// ─── Processa lista em batches respeitando rate limit ─────────────────────────
// maxConcurrent=8 + 300ms entre batches = ~26 req/s (dentro dos 40/10s)
export async function enrichBatch<T extends { name: string; contentType: 'movie' | 'series' }>(
  items: T[],
  onProgress: (done: number, total: number) => void,
  maxConcurrent = 8,
  delayMs = 300
): Promise<Map<string, TMDBData | null>> {
  const results = new Map<string, TMDBData | null>()
  let done = 0

  for (let i = 0; i < items.length; i += maxConcurrent) {
    const batch = items.slice(i, i + maxConcurrent)
    const resolved = await Promise.all(
      batch.map(item => searchTMDBAuto(item.name, item.contentType).then(r => ({ item, r })))
    )
    for (const { item, r } of resolved) {
      results.set(item.name, r)
      done++
    }
    onProgress(done, items.length)
    if (i + maxConcurrent < items.length) {
      await new Promise(r => setTimeout(r, delayMs))
    }
  }

  return results
}
