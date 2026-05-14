/**
 * Auto-vincula TODOS os canais pendentes ao TMDB (igual ao motor do admin).
 * Roda em background, retomável — pula canais já vinculados automaticamente.
 *
 * Uso:
 *   npx tsx scripts/auto-link-all.ts
 *   npx tsx scripts/auto-link-all.ts --type movie   (só filmes)
 *   npx tsx scripts/auto-link-all.ts --type tv      (só séries)
 *   npx tsx scripts/auto-link-all.ts --dry-run      (mostra sem salvar)
 */

import { createClient } from '@supabase/supabase-js'
import { getDetailedTMDBData } from '../src/lib/tmdbFetch'

const SUPABASE_URL = 'https://xkhlentrhydviqfgqdhv.supabase.co'
const SUPABASE_KEY = 'sb_secret_1ZD7ZVjGoVYke2XbNuEvvA_3tcnIR4_'
const TMDB_KEY     = 'b68afbadedebf0889f00a0cf577d3e5a'

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const isDryRun  = process.argv.includes('--dry-run')
const typeArg   = process.argv.includes('--type') ? process.argv[process.argv.indexOf('--type') + 1] : null
const TYPES     = typeArg ? [typeArg] : ['movie', 'series']

// ── Jaro-Winkler ───────────────────────────────────────────────────────────
function jaro(s1: string, s2: string): number {
  if (s1 === s2) return 1
  const l1 = s1.length, l2 = s2.length
  const dist = Math.max(Math.floor(Math.max(l1, l2) / 2) - 1, 0)
  const m1 = new Array(l1).fill(false), m2 = new Array(l2).fill(false)
  let matches = 0, t = 0
  for (let i = 0; i < l1; i++) {
    for (let j = Math.max(0, i - dist); j < Math.min(i + dist + 1, l2); j++) {
      if (m2[j] || s1[i] !== s2[j]) continue
      m1[i] = m2[j] = true; matches++; break
    }
  }
  if (!matches) return 0
  let k = 0
  for (let i = 0; i < l1; i++) {
    if (!m1[i]) continue
    while (!m2[k]) k++
    if (s1[i] !== s2[k]) t++
    k++
  }
  return (matches / l1 + matches / l2 + (matches - t / 2) / matches) / 3
}
function similarity(a: string, b: string): number {
  const s1 = a.toLowerCase().trim(), s2 = b.toLowerCase().trim()
  const j = jaro(s1, s2)
  const p = Math.min([...s1].findIndex((c, i) => c !== s2[i]), 4)
  return j + p * 0.1 * (1 - j)
}
function cleanName(name: string): string {
  return name
    .replace(/\b(4K|UHD|HD|SD|FHD|DUB|LEG|DUBLADO|LEGENDADO|NACIONAL|PT-BR|BR|ORIGINAL|VIP|PLUS)\b/gi, '')
    .replace(/S\d{1,2}E\d{1,3}/gi, '').replace(/T\d{1,2}E\d{1,3}/gi, '')
    .replace(/\(\d{4}\)/g, '').replace(/\[\d{4}\]/g, '')
    .replace(/^\d{1,4}\s*[-:.)]\s*/, '').replace(/\s+/g, ' ').trim()
}
// ──────────────────────────────────────────────────────────────────────────

function delay(ms: number) { return new Promise(r => setTimeout(r, ms)) }

async function searchTmdb(name: string, type: string): Promise<any | null> {
  const url = `https://api.themoviedb.org/3/search/multi?api_key=${TMDB_KEY}&query=${encodeURIComponent(name)}&language=pt-BR&page=1`
  const res = await fetch(url)
  if (!res.ok) return null
  const data = await res.json()

  const tmdbType = type === 'series' ? 'tv' : 'movie'
  let results = (data.results || []).filter((r: any) => r.media_type !== 'person' && r.media_type === tmdbType)
  if (!results.length) results = (data.results || []).filter((r: any) => r.media_type !== 'person')
  if (!results.length) return null

  let best = results[0], bestScore = 0
  for (const r of results.slice(0, 5)) {
    const sc = Math.max(
      similarity(name, (r.title || r.name || '').toLowerCase()),
      similarity(name, (r.original_title || r.original_name || '').toLowerCase())
    )
    if (sc > bestScore) { bestScore = sc; best = r }
  }

  return bestScore >= 0.82 ? { result: best, score: bestScore } : null
}

async function main() {
  console.log(`\n⚡ Auto-Link TMDB — Todos os Pendentes${isDryRun ? ' [DRY RUN]' : ''}`)
  console.log(`📋 Tipos: ${TYPES.join(', ')}`)
  console.log('─'.repeat(60))

  // Conta total
  const { count } = await supabase
    .from('channels')
    .select('*', { count: 'exact', head: true })
    .in('content_type', TYPES)
    .is('canonical_id', null)

  console.log(`🎯 Total pendente: ${count?.toLocaleString()}\n`)

  let processed = 0, linked = 0, skipped = 0, errors = 0
  const PAGE = 50
  let page = 0

  while (true) {
    const { data: channels, error } = await supabase
      .from('channels')
      .select('id, name, content_type')
      .in('content_type', TYPES)
      .is('canonical_id', null)
      .range(page * PAGE, (page + 1) * PAGE - 1)
      .order('name')

    if (error) { console.error('DB error:', error.message); break }
    if (!channels?.length) break

    for (const ch of channels) {
      processed++
      const searchName = cleanName(ch.name)

      if (!searchName || searchName.length < 3) { skipped++; continue }

      const pct = `[${String(processed).padStart(6)}/${count}]`

      try {
        const match = await searchTmdb(searchName, ch.content_type)

        if (!match) {
          skipped++
          if (processed % 100 === 0) {
            console.log(`${pct} ∘ ${String(skipped).padStart(4)} pulados | ${String(linked).padStart(4)} vinculados`)
          }
          await delay(280)
          continue
        }

        const { result: best } = match
        const title     = best.title || best.name || ''
        const year      = (best.release_date || best.first_air_date || '').slice(0, 4)
        const slug      = title.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
        const streamVal = best.media_type === 'tv' ? 'serie' : 'filme'
        const canonicalId = `${streamVal}-${slug}`

        if (isDryRun) {
          console.log(`${pct} ✓ SERIA: "${ch.name}" → "${title}" (${year}) [${Math.round(match.score * 100)}%]`)
          linked++
          await delay(280)
          continue
        }

        const details = await getDetailedTMDBData(best.id, best.media_type === 'tv' ? 'series' : 'movie')

        await supabase.from('canonical_titles').upsert({
          id: canonicalId, slug, title,
          streaming: streamVal,
          type: best.media_type === 'tv' ? 'series' : 'movie',
          tmdb_id: best.id, year,
          rating: best.vote_average,
          overview: best.overview,
          poster:   best.poster_path   ? `https://image.tmdb.org/t/p/w342${best.poster_path}`   : null,
          backdrop: best.backdrop_path ? `https://image.tmdb.org/t/p/w780${best.backdrop_path}` : null,
          ...(details || {})
        }, { onConflict: 'id' })

        await supabase.from('channels').update({
          canonical_id: canonicalId,
          content_type: best.media_type === 'tv' ? 'series' : 'movie',
        }).eq('id', ch.id)

        linked++
        const gen = (details?.genres || []).slice(0, 1).join('') || ''
        console.log(`${pct} ✓  "${title}" (${year}) ${gen ? `| ${gen}` : ''}`)

      } catch (e: any) {
        errors++
        console.log(`  ✗ Erro: ${ch.name} — ${e.message}`)
      }

      await delay(300)
    }

    page++

    // Relatório parcial a cada página
    const pct2 = count ? Math.round((processed / count) * 100) : 0
    console.log(`\n📊 Progresso: ${processed.toLocaleString()}/${count?.toLocaleString()} (${pct2}%) | ✓ ${linked} vinculados | ∘ ${skipped} pulados | ✗ ${errors} erros\n`)

    if (!channels || channels.length < PAGE) break
  }

  console.log('\n' + '═'.repeat(60))
  console.log(`✅ Concluído!`)
  console.log(`   Vinculados: ${linked}`)
  console.log(`   Pulados:    ${skipped}`)
  console.log(`   Erros:      ${errors}`)
  console.log(`   Total:      ${processed}\n`)
}

main().catch(console.error)
