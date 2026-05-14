import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ─── CONSTANTES ─────────────────────────────────────────────────────────────

const QUALITY_ORDER = ['4K', 'FHD', 'HD', 'SD', 'UNKNOWN']

// FIX #7 — Detectar streaming pelo group-title e nome do canal
const STREAMING_MAP: Record<string, string> = {
  netflix: 'netflix',
  'net flix': 'netflix',
  amazon: 'amazon',
  'prime video': 'amazon',
  'amazon prime': 'amazon',
  'hbo max': 'hbo',
  hbomax: 'hbo',
  hbo: 'hbo',
  'max ': 'hbo',
  disney: 'disney',
  'disney+': 'disney',
  paramount: 'paramount',
  'apple tv': 'apple',
  appletv: 'apple',
  'apple tv+': 'apple',
  globoplay: 'globoplay',
  globo: 'globoplay',
  star: 'disney', // Star+ foi integrado ao Disney+
}

// ─── FIX #1: cleanChannelName melhorado ─────────────────────────────────────
// Casos reais problemáticos encontrados:
// "NETFLIX | Breaking Bad S01 E01 HD" → "Breaking Bad"
// "BR | GLOBO HD |" → ""  (deve ser descartado como canal ao vivo)
// "| DISNEY+ | Moana 2 |FHD|" → "Moana 2"
// "The Batman (2022) [4K] {DUAL}" → "The Batman"
// "SÉRIE | La Casa de Papel T01 E01" → "La Casa de Papel"

const cleanChannelName = (raw: string): string =>
  raw
    // Remove prefixos de streaming: "NETFLIX |", "| DISNEY+ |", etc.
    .replace(/^[\s|]*(?:NETFLIX|AMAZON|PRIME(?:\s+VIDEO)?|HBO(?:\s*MAX)?|DISNEY\+?|PARAMOUNT\+?|APPLE\s*TV\+?|GLOBOPLAY|STAR\+?)[\s|:]*/gi, '')
    // Remove sufixos de streaming depois de | no final
    .replace(/\|\s*(?:NETFLIX|AMAZON|PRIME|HBO|DISNEY|PARAMOUNT|APPLE|GLOBO)\s*$/gi, '')
    // Remove marcadores de série/temporada no início: "SÉRIE |", "SERIE:"
    .replace(/^(?:S[EÉ]RIE|SERIES|FILME|MOVIE)[\s|:]+/gi, '')
    // Remove blocos entre pipes duplos: "||HD||", "||DUAL||"
    .replace(/\|{2,}[^|]+\|{2,}/g, '')
    // Remove colchetes, chaves e parênteses com conteúdo
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\{[^}]*\}/g, '')
    .replace(/\([^)]*\)/g, '')
    // Remove qualidades, codecs e marcadores técnicos
    .replace(/\b(4K|UHD|2160[Pp]?|FHD|FULL[\s.-]?HD|1080[Pp]?|HD|720[Pp]?|SD|480[Pp]?|360[Pp]?|H\.?265|H\.?264|HEVC|AVC|VOD|LEG|DUB|DUBLADO|LEGENDADO|PT-BR|BR|VIP|PREMIUM|PLUS|ULTRA)\b/gi, '')
    // Remove numeração de canal: "CH 1", "CANAL 2", "01"
    .replace(/\b(CH|CANAL)?\s*\d{1,4}\b/gi, '')
    // Remove anos isolados
    .replace(/\b(19|20)\d{2}\b/g, '')
    // FIX #2 — Remove indicadores de episódio/temporada: S01E01, T01E01, EP 01, PARTE 1
    .replace(/\b(S|T)\s*\d{1,2}\s*(E|EP)\s*\d{1,3}\b/gi, '')
    .replace(/\b(EP|PARTE|PART|VOL)\s*\d+\b/gi, '')
    // Remove separadores
    .replace(/[|_.\-–—:]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())

// ─── FIX #2: Detectar tipo de conteúdo (series vs movie) ─────────────────────
// Exemplos reais:
// "Breaking Bad S01 E01" → series, season:1, episode:1
// "La Casa de Papel T02E05" → series, season:2, episode:5
// "Moana 2" → movie (sem indicadores de temporada)
// "The Boys EP 3" → series (tem episódio mas sem temporada = season 1 implícita)

interface EpisodeInfo {
  isSeries: boolean
  season?: number
  episode?: number
}

const detectEpisodeInfo = (raw: string): EpisodeInfo => {
  // Padrão: S01E01, S01 E01, T01E01, T01 E01
  const seMatch = raw.match(/\b[ST]\s*(\d{1,2})\s*[Ex]\s*(\d{1,3})\b/i)
  if (seMatch) {
    return { isSeries: true, season: parseInt(seMatch[1]), episode: parseInt(seMatch[2]) }
  }
  // Padrão: EP 01, EP01, EPISODIO 1
  const epMatch = raw.match(/\b(?:EP|EPIS[OÓ]DIO)\s*(\d{1,3})\b/i)
  if (epMatch) {
    return { isSeries: true, season: 1, episode: parseInt(epMatch[1]) }
  }
  // Padrão: T01 (temporada sem episódio)
  const seasonMatch = raw.match(/\b[TS]\s*(\d{1,2})\b/i)
  if (seasonMatch) {
    return { isSeries: true, season: parseInt(seasonMatch[1]) }
  }
  return { isSeries: false }
}

// ─── FIX #3: Detectar streaming pelo group-title e nome ─────────────────────

const detectStreaming = (name: string, group: string | null): string | null => {
  const combined = `${group || ''} ${name}`.toLowerCase()
  for (const [key, value] of Object.entries(STREAMING_MAP)) {
    if (combined.includes(key)) return value
  }
  return null
}

// ─── FIX #4: detectQuality ────────────────────────────────────────────────────

const detectQuality = (name: string) => {
  const n = name.toUpperCase()
  if (/\b4K\b|\bUHD\b|\b2160P?\b/.test(n)) return '4K'
  if (/\bFHD\b|\bFULL[\s.-]?HD\b|\b1080P?\b/.test(n)) return 'FHD'
  if (/\bHD\b|\b720P?\b/.test(n)) return 'HD'
  if (/\bSD\b|\b480P?\b|\b360P?\b/.test(n)) return 'SD'
  return 'UNKNOWN'
}

// ─── slugify ─────────────────────────────────────────────────────────────────

const slugify = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

// ─── parseM3U ─────────────────────────────────────────────────────────────────

const parseM3U = (content: string) => {
  const lines = content.split('\n')
  const channels = []
  let current: any = null

  for (const line of lines) {
    const t = line.trim()
    if (t.startsWith('#EXTINF:')) {
      const name = t.match(/,(.+)$/)?.[1]?.trim() || 'Unknown'
      const group = t.match(/group-title="([^"]+)"/)?.[1] || null
      const logo = t.match(/tvg-logo="([^"]+)"/)?.[1] || null
      current = { name, group, logo }
    } else if (t && !t.startsWith('#') && current) {
      current.url = t
      channels.push(current)
      current = null
    }
  }
  return channels
}

// ─── FIX #5: normalizeStreams com deduplicação por URL e agrupamento de episódios ──

interface NormalizedChannel {
  id: string
  name: string
  logo: string
  group: string | null
  streams: Array<{ u: string; q: string }>
  streaming: string | null
  content_type: 'movie' | 'series' | null
  seasons: Record<number, number[]> | null // { season: [ep1, ep2, ...] }
  episodeInfo: EpisodeInfo
}

const normalizeStreams = (rawChannels: any[]): NormalizedChannel[] => {
  // FIX #5 — Map keyed por cleanName (sem episódio) para agrupar todas as streams
  const map = new Map<string, NormalizedChannel>()

  for (const raw of rawChannels) {
    const cleanName = cleanChannelName(raw.name)
    if (!cleanName || cleanName.length < 2) continue

    const quality = detectQuality(raw.name)
    const episodeInfo = detectEpisodeInfo(raw.name)
    const streaming = detectStreaming(raw.name, raw.group)
    const id = slugify(cleanName)
    const stream = { u: raw.url, q: quality }

    if (map.has(id)) {
      const existing = map.get(id)!
      // FIX #5 — Deduplicar por URL exata
      if (!existing.streams.some((s) => s.u === raw.url)) {
        existing.streams.push(stream)
      }
      // Atualizar logo se não tinha
      if (!existing.logo && raw.logo) existing.logo = raw.logo
      // FIX #8 — Acumular episódios por temporada
      if (episodeInfo.isSeries && episodeInfo.season !== undefined && episodeInfo.episode !== undefined) {
        if (!existing.seasons) existing.seasons = {}
        if (!existing.seasons[episodeInfo.season]) existing.seasons[episodeInfo.season] = []
        if (!existing.seasons[episodeInfo.season].includes(episodeInfo.episode)) {
          existing.seasons[episodeInfo.season].push(episodeInfo.episode)
        }
      }
      // Preferir conteúdo que tem streaming detectado
      if (!existing.streaming && streaming) existing.streaming = streaming
    } else {
      const seasons: Record<number, number[]> | null =
        episodeInfo.isSeries && episodeInfo.season !== undefined && episodeInfo.episode !== undefined
          ? { [episodeInfo.season]: [episodeInfo.episode] }
          : null

      map.set(id, {
        id,
        name: cleanName,
        logo: raw.logo || '',
        group: raw.group,
        streams: [stream],
        streaming,
        content_type: episodeInfo.isSeries ? 'series' : null, // null para filmes/indeterminado
        seasons,
        episodeInfo,
      })
    }
  }

  // Ordenar streams por qualidade
  for (const ch of map.values()) {
    ch.streams.sort((a, b) => QUALITY_ORDER.indexOf(a.q) - QUALITY_ORDER.indexOf(b.q))
    // Ordenar episódios por temporada/episódio
    if (ch.seasons) {
      for (const season of Object.keys(ch.seasons)) {
        ch.seasons[parseInt(season)].sort((a, b) => a - b)
      }
    }
  }

  return [...map.values()]
}

// ─── FIX #6: matchChannel com threshold mais rigoroso ────────────────────────
// Problema real: "The Boys" estava fazendo match com "The Boys In The Band"
// Fix: só permite includes se a string mais curta tiver pelo menos 70% do tamanho da maior

const normalizeForMatch = (str: string) =>
  str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()

const matchChannel = (
  name: string,
  catalog: any[],
  logIndex: { count: number },
): string | null => {
  const norm = normalizeForMatch(name)

  for (const c of catalog) {
    const hints = [
      normalizeForMatch(c.title),
      ...(c.alt_titles || []).map(normalizeForMatch),
      ...(c.match_hints || []).map(normalizeForMatch),
    ]

    // 1. Exact Match — máxima confiança
    for (const hint of hints) {
      if (norm === hint) {
        if (logIndex.count < 30) {
          console.log(`[Match ${logIndex.count}] "${name}" → ${c.id} (EXACT)`)
          logIndex.count++
        }
        return c.id
      }
    }

    // 2. FIX #6 — Includes com threshold 70% (era 40%, muito permissivo)
    // Exemplo válido: "Breaking Bad" (11) inclui em "Breaking Bad Season 1" (20) → 11/20 = 55% ❌ muito curto
    // "La Casa De Papel" (17) inclui em "La Casa De Papel Season 2" (24) → 17/24 = 71% ✅
    for (const hint of hints) {
      if (norm.includes(hint) || hint.includes(norm)) {
        const shorter = Math.min(norm.length, hint.length)
        const longer = Math.max(norm.length, hint.length)

        // FIX #6 — Mínimo 12 chars E threshold 70%
        if (shorter >= 12 && shorter / longer >= 0.70) {
          if (logIndex.count < 30) {
            console.log(`[Match ${logIndex.count}] "${name}" → ${c.id} (INCLUDES: ${hint}, ratio: ${(shorter / longer).toFixed(2)})`)
            logIndex.count++
          }
          return c.id
        }
      }
    }
  }
  return null
}

// ─── FIX #9: Gerar hash do conteúdo para detectar mudanças ──────────────────

const generateContentHash = async (content: string): Promise<string> => {
  const msgUint8 = new TextEncoder().encode(content.slice(0, 50000)) // primeiros 50KB são suficientes
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32)
}

// ─── SERVE ────────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    })
  }

  let playlist_id: string | undefined

  try {
    console.log('[process-playlist v3] Starting...')
    const body = await req.json()
    playlist_id = body.playlist_id
    const { storage_path, url } = body

    console.log('[process-playlist v3] Body:', JSON.stringify({ playlist_id, storage_path, url }))

    if (!playlist_id || (!storage_path && !url)) {
      return new Response(
        JSON.stringify({ error: 'Missing playlist_id and (storage_path or url)' }),
        { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } },
      )
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    console.log('[process-playlist v3] Setting status → processing')
    await supabase.from('playlists').update({ status: 'processing' }).eq('id', playlist_id)

    // ── Download do conteúdo ──────────────────────────────────────────────────
    let content: string

    if (storage_path) {
      console.log('[process-playlist v3] Downloading from storage:', storage_path)
      const { data: fileData, error: downloadError } = await supabase.storage
        .from('playlists')
        .download(storage_path)
      if (downloadError) throw new Error(`Failed to download file: ${downloadError.message}`)
      content = await fileData.text()
    } else {
      console.log('[process-playlist v3] Fetching from URL:', url)
      const res = await fetch(url, {
        signal: AbortSignal.timeout(30000),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Accept: '*/*',
        },
      })
      if (!res.ok) throw new Error(`Failed to fetch M3U: ${res.status}`)
      content = await res.text()
    }

    console.log('[process-playlist v3] M3U size:', content.length, 'bytes')

    // FIX #9 — Verificar hash para evitar reprocessar lista idêntica
    const contentHash = await generateContentHash(content)
    const { data: existingPl } = await supabase
      .from('playlists')
      .select('content_hash, user_id')
      .eq('id', playlist_id)
      .single()

    if (existingPl?.content_hash === contentHash) {
      console.log('[process-playlist v3] Content unchanged (hash match) — skipping')
      await supabase
        .from('playlists')
        .update({ status: 'ready', processed_at: new Date().toISOString() })
        .eq('id', playlist_id)
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: 'content_unchanged' }),
        { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } },
      )
    }

    // ── Parse e normalização ──────────────────────────────────────────────────
    const raw = parseM3U(content)
    console.log('[process-playlist v3] Parsed', raw.length, 'raw entries')

    const normalized = normalizeStreams(raw)
    console.log('[process-playlist v3] Normalized:', normalized.length, 'unique channels')

    // ── Carregar catálogo ─────────────────────────────────────────────────────
    console.log('[process-playlist v3] Loading catalog...')
    const { data: catalog } = await supabase
      .from('canonical_titles')
      .select('id, title, alt_titles, match_hints, type')

    console.log('[process-playlist v3] Catalog:', catalog?.length || 0, 'titles')

    // ── Match ─────────────────────────────────────────────────────────────────
    console.log('[process-playlist v3] Matching...')
    const matched: any[] = []
    const unmatched: any[] = []
    const logIndex = { count: 0 }

    for (const ch of normalized) {
      const canonical_id = matchChannel(ch.name, catalog || [], logIndex)
      if (canonical_id) {
        // FIX #7 — Usar streaming do catálogo se não detectado pela lista
        const catalogEntry = catalog?.find((c) => c.id === canonical_id)
        matched.push({
          ...ch,
          canonical_id,
          content_type: ch.content_type || (catalogEntry?.type === 'series' ? 'series' : 'movie'),
          streaming: ch.streaming || null,
        })
      } else {
        unmatched.push(ch.name)
      }
    }

    console.log(
      `[process-playlist v3] Matched: ${matched.length}/${normalized.length} | Unmatched: ${unmatched.length}`,
    )
    if (unmatched.length > 0 && unmatched.length <= 50) {
      console.log('[process-playlist v3] Unmatched samples:', unmatched.slice(0, 20))
    }

    const userId = existingPl?.user_id
    if (!userId) throw new Error('Playlist user_id not found')

    // FIX #10 — Limpar channels antigos desta playlist antes de inserir
    console.log('[process-playlist v3] Clearing old channels for playlist...')
    await supabase.from('channels').delete().eq('playlist_id', playlist_id)

    // ── Insert em batches ─────────────────────────────────────────────────────
    console.log('[process-playlist v3] Inserting...')
    let inserted = 0
    const BATCH_SIZE = 200

    for (let i = 0; i < matched.length; i += BATCH_SIZE) {
      const batch = matched.slice(i, i + BATCH_SIZE).map((ch) => ({
        playlist_id,
        user_id: userId,
        name: ch.name,
        streams: ch.streams,
        group_name: ch.group,
        logo_url: ch.logo || null,
        canonical_id: ch.canonical_id,
        streaming: ch.streaming || null,
        // FIX #8 — content_type e seasons
        content_type: ch.content_type,
        seasons: ch.seasons ? ch.seasons : null,
      }))

      const { error } = await supabase.from('channels').insert(batch)
      if (error) {
        console.error('[process-playlist v3] Insert error (batch', i, '):', error.message)
      } else {
        inserted += batch.length
      }
    }

    console.log('[process-playlist v3] Inserted:', inserted)

    // ── Finalizar playlist ────────────────────────────────────────────────────
    await supabase
      .from('playlists')
      .update({
        status: 'ready',
        channel_count: inserted,
        processed_at: new Date().toISOString(),
        content_hash: contentHash,
        error_message: null,
      })
      .eq('id', playlist_id)

    console.log('[process-playlist v3] ✅ Done!')

    return new Response(
      JSON.stringify({
        success: true,
        version: 'v3',
        raw: raw.length,
        normalized: normalized.length,
        matched: matched.length,
        inserted,
        unmatched: unmatched.length,
        content_hash: contentHash,
      }),
      { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } },
    )
  } catch (error: any) {
    console.error('[process-playlist v3] ❌ Error:', error.message)
    console.error('[process-playlist v3] Stack:', error.stack)

    if (playlist_id) {
      try {
        const supabase = createClient(
          Deno.env.get('SUPABASE_URL')!,
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
        )
        await supabase
          .from('playlists')
          .update({ status: 'error', error_message: error.message })
          .eq('id', playlist_id)
      } catch {}
    }

    return new Response(
      JSON.stringify({ error: error.message, stack: error.stack }),
      { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } },
    )
  }
})
