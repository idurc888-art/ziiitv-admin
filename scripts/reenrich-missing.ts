/**
 * Re-enriquece títulos que já têm tmdb_id mas ainda não têm
 * director/genres/castinfo/age_rating/duration/trailer_url.
 *
 * Uso:
 *   npx tsx scripts/reenrich-missing.ts
 *   npx tsx scripts/reenrich-missing.ts --dry-run   (só mostra o que faria)
 *   npx tsx scripts/reenrich-missing.ts --limit 50  (processa no máximo 50)
 */

import { createClient } from '@supabase/supabase-js'
import { getDetailedTMDBData } from '../src/lib/tmdbFetch'

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://xkhlentrhydviqfgqdhv.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'sb_secret_1ZD7ZVjGoVYke2XbNuEvvA_3tcnIR4_'

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const isDryRun = process.argv.includes('--dry-run')
const limitArg = process.argv.indexOf('--limit')
const MAX = limitArg !== -1 ? parseInt(process.argv[limitArg + 1]) : Infinity

async function main() {
  console.log(`\n🔄  Re-enriquecimento de títulos existentes${isDryRun ? ' [DRY RUN]' : ''}`)
  console.log('─'.repeat(60))

  // Busca todos com tmdb_id mas sem director (campo marcador do deep fetch)
  let page = 0
  const PAGE_SIZE = 200
  const pending: any[] = []

  while (true) {
    const { data, error } = await supabase
      .from('canonical_titles')
      .select('id, title, tmdb_id, type')
      .not('tmdb_id', 'is', null)
      .is('director', null)
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

    if (error) { console.error('Erro ao buscar:', error.message); break }
    if (!data?.length) break
    pending.push(...data)
    if (data.length < PAGE_SIZE) break
    page++
  }

  const total = Math.min(pending.length, MAX)
  console.log(`📋  Encontrados: ${pending.length} títulos sem dados profundos`)
  console.log(`🎯  Processando: ${total}\n`)

  let ok = 0, skip = 0, fail = 0

  for (let i = 0; i < total; i++) {
    const row = pending[i]
    const pct = `[${String(i + 1).padStart(4)}/${total}]`

    if (isDryRun) {
      console.log(`${pct} SERIA: ${row.title} (tmdb:${row.tmdb_id}, type:${row.type})`)
      continue
    }

    try {
      const details = await getDetailedTMDBData(row.tmdb_id, row.type as any)

      if (!details) {
        console.log(`${pct} ⚠  Sem dados   — ${row.title}`)
        skip++
        await delay(300)
        continue
      }

      // Atualiza apenas os campos profundos (não mexe em poster/backdrop/overview)
      const { error } = await supabase
        .from('canonical_titles')
        .update({
          genres:      details.genres,
          castinfo:    details.castinfo,
          director:    details.director,
          age_rating:  details.age_rating,
          duration:    details.duration,
          trailer_url: details.trailer_url,
        })
        .eq('id', row.id)

      if (error) {
        console.log(`${pct} ✗  Erro DB      — ${row.title}: ${error.message}`)
        fail++
      } else {
        const gen = (details.genres || []).slice(0, 2).join(', ') || '—'
        const dir = details.director || '—'
        console.log(`${pct} ✓  ${row.title} | ${gen} | dir: ${dir}`)
        ok++
      }
    } catch (e: any) {
      console.log(`${pct} ✗  Exceção      — ${row.title}: ${e.message}`)
      fail++
    }

    // Throttle para não bater nos limites da API TMDB (40 req/10s)
    await delay(300)
  }

  console.log('\n' + '─'.repeat(60))
  console.log(`✅  Atualizados: ${ok}`)
  console.log(`⚠   Sem dados:  ${skip}`)
  console.log(`✗   Falhas:     ${fail}`)
  console.log(`📊  Total:      ${total}\n`)
}

function delay(ms: number) { return new Promise(r => setTimeout(r, ms)) }

main().catch(console.error)
