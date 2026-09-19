/**
 * Vincula canais da playlist à NOSSA base (canonical_titles) SEM duplicar.
 * Ordem por canal:
 *   1. tenta casar por slug/título na base existente -> vincula canonical_id
 *   2. se não casar, busca no TMDB externo -> cria registro NOVO (só se não existir)
 * Retomável: pula canais que já têm canonical_id.
 */
import { createClient } from '@supabase/supabase-js'
import { getDetailedTMDBData } from '../src/lib/tmdbFetch'

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://xkhlentrhydviqfgqdhv.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const TMDB_KEY = process.env.VITE_TMDB_API_KEY || 'b68afbadedebf0889f00a0cf577d3e5a'

const PLAYLIST_ID = process.argv.find(a => a.startsWith('--playlist='))?.split('=')[1]
  || '592a499b-efa6-4f72-8bc1-052b6f6de5b7'
const DRY_RUN = process.argv.includes('--dry-run')

const sb = createClient(SUPABASE_URL, SUPABASE_KEY)

function cleanForSearch(name: string): string {
  return name
    .replace(/\b(4K|UHD|HD|SD|FHD|DUB|LEG|DUBLADO|LEGENDADO|NACIONAL|PT-BR|BR|ORIGINAL|VIP|PLUS)\b/gi, '')
    .replace(/S\d{1,2}E\d{1,3}/gi, '')
    .replace(/T\d{1,2}E\d{1,3}/gi, '')
    .replace(/\(\d{4}\)/g, '').replace(/\[\d{4}\]/g, '')
    .replace(/^\d{1,4}\s*[-:.)]\s*/, '')
    .replace(/\s+/g, ' ').trim()
}
function slugKey(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}
function jaro(s1: string, s2: string): number {
  if (s1 === s2) return 1
  const l1 = s1.length, l2 = s2.length
  const dist = Math.max(Math.floor(Math.max(l1, l2) / 2) - 1, 0)
  const m1 = new Array(l1).fill(false), m2 = new Array(l2).fill(false)
  let matches = 0, t = 0
  for (let i = 0; i < l1; i++) for (let j = Math.max(0, i - dist); j < Math.min(i + dist + 1, l2); j++) {
    if (m2[j] || s1[i] !== s2[j]) continue
    m1[i] = m2[j] = true; matches++; break
  }
  if (!matches) return 0
  let k = 0
  for (let i = 0; i < l1; i++) { if (!m1[i]) continue; while (!m2[k]) k++; if (s1[i] !== s2[k]) t++; k++ }
  return (matches / l1 + matches / l2 + (matches - t / 2) / matches) / 3
}
function similarity(a: string, b: string): number {
  const s1 = a.toLowerCase().trim(), s2 = b.toLowerCase().trim()
  const j = jaro(s1, s2)
  const p = Math.min([...s1].findIndex((c, i) => c !== s2[i]), 4)
  return j + p * 0.1 * (1 - j)
}
const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

// Carrega a base INTEIRA uma vez (slug -> id) para o passo 1 (sem TMDB)
async function loadBaseMap() {
  const bySlug = new Map<string, string>()
  let p = 0
  while (true) {
    const { data } = await sb.from('canonical_titles').select('id, slug').range(p * 1000, (p + 1) * 1000 - 1)
    if (!data || !data.length) break
    for (const c of data) if (!bySlug.has(c.slug)) bySlug.set(c.slug, c.id)
    if (data.length < 1000) break
    p++
  }
  return bySlug
}

async function main() {
  console.log(`\n⚡ Vincular à NOSSA BASE (sem duplicar)${DRY_RUN ? ' [DRY RUN]' : ''}`)
  console.log(`📋 Playlist: ${PLAYLIST_ID}`)
  console.log('─'.repeat(60))

  const baseMap = await loadBaseMap()
  console.log(`📚 Base carregada: ${baseMap.size} slugs\n`)

  // total pendente
  const { count } = await sb.from('channels').select('*', { count: 'exact', head: true })
    .eq('playlist_id', PLAYLIST_ID).is('canonical_id', null)
  console.log(`🎯 Pendentes: ${count?.toLocaleString()}\n`)

  let linkedBase = 0, linkedTmdb = 0, skipped = 0, errors = 0
  const PAGE = 200
  let page = 0

  while (true) {
    const { data: channels } = await sb.from('channels')
      .select('id, name, content_type')
      .eq('playlist_id', PLAYLIST_ID)
      .is('canonical_id', null)
      .range(page * PAGE, (page + 1) * PAGE - 1)
      .order('name')

    if (!channels || !channels.length) break

    for (const ch of channels) {
      const searchName = cleanForSearch(ch.name)
      if (!searchName || searchName.length < 2) { skipped++; continue }

      // ── Passo 1: casar com a base (slug) — NÃO cria nada ─────────────
      const slug = slugKey(searchName)
      const existingId = baseMap.get(slug)
      if (existingId) {
        if (!DRY_RUN) {
          const { error } = await sb.from('channels').update({ canonical_id: existingId }).eq('id', ch.id)
          if (error) { errors++; console.log(`  ✗ ${ch.name}: ${error.message}`); continue }
        }
        linkedBase++
        if (linkedBase % 200 === 0) console.log(`  [base] ${linkedBase} vinculados | ${linkedTmdb} via TMDB | ${skipped} pulados`)
        continue
      }

      // ── Passo 2: busca TMDB externa (só o que não está na base) ──────
      try {
        const type = ch.content_type === 'series' ? 'tv' : 'movie'
        const url = `https://api.themoviedb.org/3/search/multi?api_key=${TMDB_KEY}&query=${encodeURIComponent(searchName)}&language=pt-BR&page=1`
        const res = await fetch(url)
        if (!res.ok) { skipped++; await delay(250); continue }
        const data = await res.json()
        let results = (data.results || []).filter((r: any) => r.media_type !== 'person' && r.media_type === type)
        if (!results.length) results = (data.results || []).filter((r: any) => r.media_type !== 'person')
        if (!results.length) { skipped++; await delay(250); continue }

        let best = results[0], bestScore = 0
        for (const r of results.slice(0, 5)) {
          const sc = Math.max(
            similarity(searchName, (r.title || r.name || '').toLowerCase()),
            similarity(searchName, (r.original_title || r.original_name || '').toLowerCase())
          )
          if (sc > bestScore) { bestScore = sc; best = r }
        }
        if (bestScore < 0.82) { skipped++; await delay(250); continue }

        const title = best.title || best.name || ''
        const year = (best.release_date || best.first_air_date || '').slice(0, 4)
        const newSlug = slugKey(title)
        const stream = best.media_type === 'tv' ? 'serie' : 'filme'

        // só cria se o slug ainda não existe (evita duplicar)
        const existingNewId = baseMap.get(newSlug)
        const canonicalId = existingNewId ?? `${stream}-${newSlug}`

        if (!existingNewId) {
          const details = await getDetailedTMDBData(best.id, best.media_type === 'tv' ? 'series' : 'movie')
          if (!DRY_RUN) {
            await sb.from('canonical_titles').upsert({
              id: canonicalId, slug: newSlug, title,
              streaming: stream,
              type: best.media_type === 'tv' ? 'series' : 'movie',
              tmdb_id: best.id, year,
              rating: best.vote_average,
              overview: best.overview,
              poster: best.poster_path ? `https://image.tmdb.org/t/p/w342${best.poster_path}` : null,
              backdrop: best.backdrop_path ? `https://image.tmdb.org/t/p/w780${best.backdrop_path}` : null,
              ...(details || {})
            }, { onConflict: 'id' })
          }
          baseMap.set(newSlug, canonicalId)
        }

        if (!DRY_RUN) {
          await sb.from('channels').update({ canonical_id: canonicalId }).eq('id', ch.id)
        }
        linkedTmdb++
        if (linkedTmdb % 50 === 0) console.log(`  [tmdb] ${linkedTmdb} novos | ✓ "${title}" (${year})`)

      } catch (e: any) {
        errors++
        if (errors % 20 === 0) console.log(`  ✗ ${e.message}`)
      }
      await delay(250)
    }

    console.log(`📊 página ${page + 1} | base:${linkedBase} tmdb:${linkedTmdb} pulados:${skipped} erros:${errors}`)
    if (channels.length < PAGE) break
    page++
  }

  console.log('\n' + '═'.repeat(60))
  console.log(`✅ Concluído!`)
  console.log(`   Vinculados à base: ${linkedBase}`)
  console.log(`   Novos via TMDB:    ${linkedTmdb}`)
  console.log(`   Pulados:           ${skipped}`)
  console.log(`   Erros:             ${errors}\n`)
}

main().catch(console.error)
