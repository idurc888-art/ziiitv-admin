// ============================================
// Seed Script: Popular canonical_titles
// ============================================
// Lê catalog.ts do ziiiTV e popula canonical_titles no Supabase
// Roda 1x pelo admin

import { createClient } from '@supabase/supabase-js'
import { CANONICAL_CATALOG } from '../../src/data/catalog'
import 'dotenv/config'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

async function seedCatalog() {
  console.log(`[Seed] Populando ${CANONICAL_CATALOG.length} títulos...`)

  const records = CANONICAL_CATALOG.map(item => ({
    id: item.id,
    slug: item.slug,
    title: item.title,
    alt_titles: item.altTitles || [],
    type: item.type,
    streaming: item.streaming,
    match_hints: item.matchHints || [],
    genres: [],
    tmdb_id: item.tmdbId,
    year: item.year?.toString(),
    rating: item.rating,
    overview: item.overview,
    poster: item.poster,
    backdrop: item.backdrop
  }))

  // Remove duplicatas por slug
  const uniqueRecords = Array.from(
    new Map(records.map(r => [r.slug, r])).values()
  )

  console.log(`[Seed] ${records.length} títulos → ${uniqueRecords.length} únicos`)

  // Insere 1 por vez para evitar conflitos
  let success = 0
  let skipped = 0

  for (const record of uniqueRecords) {
    const { error } = await supabase.from('canonical_titles').upsert(record)
    if (error) {
      skipped++
    } else {
      success++
    }
  }

  console.log(`[Seed] ✅ ${success} inseridos, ${skipped} já existiam`)
}

seedCatalog().catch(console.error)
