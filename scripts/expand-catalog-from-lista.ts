// ============================================
// Expand Catalog: LISTA_FILMES_SERIES.txt → canonical_titles com TMDB
// ============================================
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import 'dotenv/config'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const TMDB_API_KEY = process.env.TMDB_API_KEY || 'YOUR_TMDB_KEY'

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

const LISTA_PATH = '/home/carneiro888/Documentos/M3U/LISTA_FILMES_SERIES.txt'

// Mapa de streamings
const STREAMING_MAP: Record<string, string> = {
  'GLOBOPLAY': 'globoplay',
  'NETFLIX': 'netflix',
  'AMAZON': 'amazon',
  'HBO': 'hbo',
  'DISNEY': 'disney',
  'PARAMOUNT': 'paramount',
  'APPLE': 'apple'
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function cleanTitle(raw: string): string {
  return raw
    .replace(/\s+S\d+E\d+$/i, '')
    .replace(/\s+\(\d{4}\)/, '')
    .trim()
}

async function searchTMDB(title: string, type: 'movie' | 'series'): Promise<any | null> {
  const endpoint = type === 'movie' ? 'search/movie' : 'search/tv'
  const url = `https://api.themoviedb.org/3/${endpoint}?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}&language=pt-BR`
  
  try {
    const res = await fetch(url)
    const data = await res.json()
    if (data.results && data.results.length > 0) {
      const first = data.results[0]
      return {
        tmdb_id: first.id,
        title: first.title || first.name,
        year: (first.release_date || first.first_air_date || '').slice(0, 4),
        rating: first.vote_average,
        overview: first.overview,
        poster: first.poster_path,
        backdrop: first.backdrop_path
      }
    }
  } catch (e) {
    console.warn(`[TMDB] Erro ao buscar "${title}":`, e)
  }
  return null
}

async function expandCatalog() {
  console.log('[Expand] Lendo LISTA_FILMES_SERIES.txt...')
  const content = readFileSync(LISTA_PATH, 'utf-8')
  const lines = content.split('\n')

  let currentStreaming = 'unknown'
  const uniqueTitles = new Map<string, { title: string; streaming: string; type: 'movie' | 'series' }>()

  for (const line of lines) {
    const trimmed = line.trim()
    
    // Detecta cabeçalho de streaming
    const streamingMatch = trimmed.match(/🟩|🔴|🔵|🟡|🟠|🟣/)
    if (streamingMatch) {
      for (const [key, value] of Object.entries(STREAMING_MAP)) {
        if (trimmed.toUpperCase().includes(key)) {
          currentStreaming = value
          break
        }
      }
      continue
    }

    // Ignora linhas vazias e separadores
    if (!trimmed || trimmed.startsWith('=')) continue

    // Extrai título limpo
    const cleanedTitle = cleanTitle(trimmed)
    if (!cleanedTitle) continue

    const slug = slugify(cleanedTitle)
    const key = `${currentStreaming}:${slug}`

    // Detecta tipo (série tem episódio, filme não)
    const type = /S\d+E\d+/i.test(trimmed) ? 'series' : 'movie'

    if (!uniqueTitles.has(key)) {
      uniqueTitles.set(key, { title: cleanedTitle, streaming: currentStreaming, type })
    }
  }

  console.log(`[Expand] ${uniqueTitles.size} títulos únicos extraídos`)

  // Busca no TMDB e insere no Supabase
  let inserted = 0
  let skipped = 0
  let notFound = 0

  for (const [key, { title, streaming, type }] of uniqueTitles) {
    const slug = slugify(title)
    const id = `${streaming}-${slug}`

    // Verifica se já existe
    const { data: existing } = await supabase
      .from('canonical_titles')
      .select('id')
      .eq('id', id)
      .single()

    if (existing) {
      skipped++
      continue
    }

    // Busca no TMDB
    console.log(`[TMDB] Buscando: ${title} (${type})`)
    const tmdbData = await searchTMDB(title, type)

    if (!tmdbData) {
      notFound++
      console.warn(`[TMDB] ❌ Não encontrado: ${title}`)
      continue
    }

    // Insere no Supabase
    const record = {
      id,
      slug,
      title: tmdbData.title,
      alt_titles: [title.toLowerCase()],
      type,
      streaming,
      match_hints: [slug],
      tmdb_id: tmdbData.tmdb_id,
      year: tmdbData.year,
      rating: tmdbData.rating,
      overview: tmdbData.overview,
      poster: tmdbData.poster,
      backdrop: tmdbData.backdrop
    }

    const { error } = await supabase.from('canonical_titles').insert(record)
    if (error) {
      console.error(`[Supabase] Erro ao inserir ${title}:`, error.message)
    } else {
      inserted++
      console.log(`[Supabase] ✅ ${inserted}/${uniqueTitles.size} - ${title}`)
    }

    // Rate limit TMDB (40 req/10s)
    await new Promise(resolve => setTimeout(resolve, 250))
  }

  console.log(`\n[Expand] Finalizado:`)
  console.log(`  ✅ Inseridos: ${inserted}`)
  console.log(`  ⏭️  Já existiam: ${skipped}`)
  console.log(`  ❌ Não encontrados no TMDB: ${notFound}`)
}

expandCatalog().catch(console.error)
