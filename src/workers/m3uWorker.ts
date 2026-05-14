/**
 * m3uWorker — v2
 *
 * Main thread envia:  { type: 'process', content: string, catalog: any[] }
 * Worker responde:    { type: 'progress', phase, percent, message }
 *                     { type: 'done',    matched, unmatched, liveTV, stats }
 *                     { type: 'error',   message }
 *
 * Pipeline:
 *   1. Parse M3U → RawChannel[]   (yield a cada 10k linhas)
 *   2. normalizeStreams             (dedup URL, 4 pipelines: live/movie/series/show)
 *   3. Series dedup                (streaming-specific > genérico Legendadas)
 *   4. Match contra catálogo       (O(1) — índice construído 1x em m3uProcessor)
 *   5. Movie merge by canonical_id ("Velozes e Furiosos" PT + "Fast and Furious" EN → 1 card)
 *   6. Sort 4K first               (canais com stream[0].q === '4K' sobem)
 */

import { normalizeStreams, buildCatalogIndex, lookupChannel, slugify } from '../lib/m3uProcessor'
import type { RawChannel, Channel } from '../lib/m3uProcessor'

type MatchedChannel = Channel & { canonical_id: string }

const QUALITY_ORDER = ['4K', 'FHD', 'HD', 'SD', 'UNKNOWN']

function progress(phase: string, percent: number, message: string) {
  self.postMessage({ type: 'progress', phase, percent, message })
}

self.onmessage = async (e: MessageEvent<{ type: string; content: string; catalog: any[] }>) => {
  if (e.data.type !== 'process') return

  try {
    const { content, catalog } = e.data

    // ── Fase 1: Parse M3U ────────────────────────────────────────────────────
    progress('parsing', 0, 'Lendo M3U...')

    const raw: RawChannel[] = []
    let currentExtinf: string | null = null
    let cursor = 0
    let lineCount = 0
    const PARSE_CHUNK = 10_000

    while (cursor < content.length) {
      const nl  = content.indexOf('\n', cursor)
      const end = nl >= 0 ? nl : content.length
      const line = content.slice(cursor, end).trim()
      cursor = nl >= 0 ? nl + 1 : content.length
      lineCount++

      if (line.startsWith('#EXTINF:')) {
        currentExtinf = line
      } else if (line && !line.startsWith('#') && currentExtinf) {
        const name  = currentExtinf.match(/,(.+)$/)?.[1]?.trim() || ''
        const group = currentExtinf.match(/group-title="([^"]+)"/)?.[1] || null
        const logo  = currentExtinf.match(/tvg-logo="([^"]+)"/)?.[1]  || null
        if (name) raw.push({ name, url: line, group, logo })
        currentExtinf = null
      }

      if (lineCount % PARSE_CHUNK === 0) {
        const pct = Math.round((cursor / content.length) * 38)
        progress('parsing', pct, `${raw.length.toLocaleString()} entradas lidas...`)
        await new Promise(r => setTimeout(r, 0))
      }
    }

    progress('parsing', 38, `${raw.length.toLocaleString()} entradas brutas`)
    await new Promise(r => setTimeout(r, 0))

    // ── Fase 2: normalizeStreams ──────────────────────────────────────────────
    // Dedup de URLs, 4 pipelines (live/movie/series/show), sort 4K-first por canal
    progress('normalizing', 40, 'Organizando canais por tipo...')
    await new Promise(r => setTimeout(r, 0))

    const channels = normalizeStreams(raw)

    progress('normalizing', 57, `${channels.length.toLocaleString()} canais únicos — deduplicando séries...`)
    await new Promise(r => setTimeout(r, 0))

    // ── Fase 3: Series dedup — streaming declarado > genérico ────────────────
    // "Series | HBO Max" tem prioridade sobre "Series | Legendadas" para o mesmo título
    const knownStreamingSlugs = new Set<string>()
    for (const ch of channels) {
      if (ch.contentType === 'series' && ch.streaming) {
        knownStreamingSlugs.add(slugify(ch.name))
      }
    }

    const dedupedChannels: Channel[] = channels.filter(ch => {
      if (ch.contentType !== 'series') return true
      if (ch.streaming) return true
      return !knownStreamingSlugs.has(slugify(ch.name))
    })

    progress('normalizing', 60, `${dedupedChannels.length.toLocaleString()} canais após dedup de séries`)
    await new Promise(r => setTimeout(r, 0))

    // ── Separar live TV antes do match ────────────────────────────────────────
    const liveTV:    Channel[] = []
    const toMatch:   Channel[] = []

    for (const ch of dedupedChannels) {
      if (ch.contentType === 'live') liveTV.push(ch)
      else toMatch.push(ch)
    }

    // ── Fase 4: Match contra catálogo ─────────────────────────────────────────
    // Índice construído 1x → O(catalog) setup, O(1) lookup por canal
    progress('matching', 62, `Indexando ${catalog.length} títulos do catálogo...`)
    const catalogIndex = buildCatalogIndex(catalog)
    await new Promise(r => setTimeout(r, 0))

    const preMatched: Array<{ ch: Channel; canonicalId: string }> = []
    const unmatched:  Channel[] = []
    const MATCH_CHUNK = 500

    for (let i = 0; i < toMatch.length; i++) {
      const ch = toMatch[i]
      const canonicalId = lookupChannel(ch.name, ch.streaming, catalogIndex)
      if (canonicalId) {
        preMatched.push({ ch, canonicalId })
      } else {
        unmatched.push(ch)
      }

      if (i % MATCH_CHUNK === 0 && i > 0) {
        const pct = 60 + Math.round((i / toMatch.length) * 30)
        progress('matching', pct, `${preMatched.length.toLocaleString()} matched...`)
        await new Promise(r => setTimeout(r, 0))
      }
    }

    progress('matching', 91, `${preMatched.length} matched — mesclando versões de filmes...`)
    await new Promise(r => setTimeout(r, 0))

    // ── Fase 5: Movie merge por canonical_id ─────────────────────────────────
    // Mesmo filme com títulos diferentes (PT dublado + EN legendado) → 1 card com seletor
    const movieMergeMap = new Map<string, MatchedChannel>()
    const matched: MatchedChannel[] = []

    for (const { ch, canonicalId } of preMatched) {
      if (ch.contentType !== 'movie') {
        matched.push({ ...ch, canonical_id: canonicalId })
        continue
      }

      const existing = movieMergeMap.get(canonicalId)
      if (!existing) {
        movieMergeMap.set(canonicalId, { ...ch, streams: [...ch.streams], canonical_id: canonicalId })
      } else {
        // Merge streams: adiciona combinações qualidade/dubType que ainda não existem
        for (const ns of ch.streams) {
          const dup = existing.streams.find(s => s.q === ns.q && s.dubType === ns.dubType)
          if (!dup) {
            existing.streams.push(ns)
          } else if (ns.u !== dup.u && !(dup.fallback || []).includes(ns.u)) {
            dup.fallback = [...(dup.fallback || []), ns.u]
          }
        }
        // Merge gêneros
        for (const genre of ch.genres) {
          if (!existing.genres.includes(genre)) existing.genres.push(genre)
        }
        if (!existing.genre && ch.genre) existing.genre = ch.genre
      }
    }

    // Flush merge map → matched com sort final: 4K > FHD > HD > SD, D antes de L
    for (const merged of movieMergeMap.values()) {
      merged.streams.sort((a, b) => {
        const qa = QUALITY_ORDER.indexOf(a.q) >= 0 ? QUALITY_ORDER.indexOf(a.q) : 99
        const qb = QUALITY_ORDER.indexOf(b.q) >= 0 ? QUALITY_ORDER.indexOf(b.q) : 99
        if (qa !== qb) return qa - qb
        return (a.dubType === 'D' ? 0 : 1) - (b.dubType === 'D' ? 0 : 1)
      })
      matched.push(merged)
    }

    // ── Fase 6: Sort final — canais 4K sobem para o topo ─────────────────────
    matched.sort((a, b) => {
      const a4k = a.streams[0]?.q === '4K' ? 0 : 1
      const b4k = b.streams[0]?.q === '4K' ? 0 : 1
      return a4k - b4k
    })

    progress('matching', 99, 'Finalizando...')
    await new Promise(r => setTimeout(r, 0))

    const movieCount  = matched.filter(c => c.contentType === 'movie').length
    const seriesCount = matched.filter(c => c.contentType === 'series').length
    const showCount   = matched.filter(c => c.contentType === 'show' || c.contentType === 'standup').length

    self.postMessage({
      type: 'done',
      matched,
      unmatched,
      liveTV,
      stats: {
        parsed:     raw.length,
        normalized: channels.length,
        deduped:    dedupedChannels.length,
        matched:    matched.length,
        movies:     movieCount,
        series:     seriesCount,
        shows:      showCount,
        unmatched:  unmatched.length,
        liveTV:     liveTV.length,
      },
    })

  } catch (err) {
    self.postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    })
  }
}
