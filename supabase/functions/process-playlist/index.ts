import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const QUALITY_ORDER = ['4K', 'FHD', 'HD', 'SD', 'UNKNOWN']

function detectQuality(name: string) {
  const n = name.toUpperCase()
  if (/\b4K\b|\bUHD\b|\b2160P?/.test(n)) return '4K'
  if (/\bFHD\b|\bFULL.?HD\b|\b1080P?/.test(n)) return 'FHD'
  if (/\bHD\b|\b720P?/.test(n)) return 'HD'
  if (/\bSD\b|\b480P?|\b360P?/.test(n)) return 'SD'
  return 'UNKNOWN'
}

// Fix #3: normaliza separador de grupo (pipe OU dois-pontos) para prefixo uniforme
function getGroupPrefix(group: string | null): string {
  if (!group) return ''
  return (group.split(/[|:]/)[0] || '').trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
}

// Fix #2: classifica por prefixo do grupo ANTES de limpar o nome
function detectContentType(rawName: string, group: string | null): 'live' | 'movie' | 'series' {
  const prefix = getGroupPrefix(group)
  if (/series?|shows?/.test(prefix)) return 'series'
  if (/filmes?|movies?|\bvod\b/.test(prefix)) return 'movie'
  if (/canais?|live|sport|esport|noticias?|news|abertos?|entret/.test(prefix)) return 'live'
  // Fix #1: testa padrão de episódio no nome BRUTO, antes de qualquer limpeza
  if (/\bS\d{1,2}E\d{1,4}\b/i.test(rawName)) return 'series'
  return 'live'
}

// Fix #1: extrai série + episódio ANTES de cleanChannelName apagar tudo
function extractEpisode(rawName: string): { seriesTitle: string; season: number; episode: number } | null {
  // Fix #5 antecipado: strip [L], [FHD] etc. antes do regex
  const stripped = rawName.replace(/\[[^\]]*\]/g, '').replace(/\s{2,}/g, ' ').trim()
  const m = stripped.match(/^(.+?)\s+S(\d{1,2})E(\d{1,4})\b/i)
  if (!m) return null
  return { seriesTitle: m[1].trim(), season: parseInt(m[2], 10), episode: parseInt(m[3], 10) }
}

function cleanChannelName(raw: string): string {
  return raw
    .replace(/\|{2,}[^|]+\|{2,}/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\{[^}]*\}/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/\b(4K|UHD|2160[Pp]?|FHD|FULL.?HD|1080[Pp]?|HD|720[Pp]?|SD|480[Pp]?|360[Pp]?|H\.?265|H\.?264|HEVC|AVC|VOD|LEG|DUB|DUBLADO|LEGENDADO|PT.BR|BR|VIP|PREMIUM|PLUS)\b/gi, '')
    .replace(/\b(CH|CANAL)?\s*\d{1,4}\b/gi, '')
    .replace(/\b(19|20)\d{2}\b/g, '')
    .replace(/\b(S|T|EP|PARTE|PART|VOL)\s*\d+\b/gi, '')
    .replace(/[|_.\-]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(/\b\w/g, (c: string) => c.toUpperCase())
}

function slugify(name: string): string {
  return name.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function parseM3U(content: string) {
  const lines = content.split('\n')
  const channels: Array<{ name: string; group: string | null; logo: string | null; url: string }> = []
  let current: { name: string; group: string | null; logo: string | null } | null = null
  for (const line of lines) {
    const t = line.trim()
    if (t.startsWith('#EXTINF:')) {
      const name = t.match(/,(.+)$/)?.[1]?.trim() || 'Unknown'
      const group = t.match(/group-title="([^"]+)"/)?.[1]?.trim() || null
      const logo = t.match(/tvg-logo="([^"]+)"/)?.[1] || null
      current = { name, group, logo }
    } else if (t && !t.startsWith('#') && current) {
      channels.push({ ...current, url: t })
      current = null
    }
  }
  return channels
}

function normalizeStreams(rawChannels: Array<{ name: string; group: string | null; logo: string | null; url: string }>) {
  const map = new Map<string, any>()

  for (const raw of rawChannels) {
    // Fix #1 + #2: classifica e extrai episódio ANTES de limpar o nome
    const contentType = detectContentType(raw.name, raw.group)
    const ep = contentType === 'series' ? extractEpisode(raw.name) : null
    const baseName = ep ? ep.seriesTitle : raw.name
    const cleanName = cleanChannelName(baseName)
    if (!cleanName || cleanName.length < 2) continue

    const quality = detectQuality(raw.name)
    const id = slugify(cleanName)
    const stream = ep
      ? { u: raw.url, q: quality, label: `S${String(ep.season).padStart(2,'0')}E${String(ep.episode).padStart(2,'0')}` }
      : { u: raw.url, q: quality }

    if (map.has(id)) {
      const existing = map.get(id)
      if (!existing.streams.some((s: any) => s.u === raw.url)) {
        existing.streams.push(stream)
        if (!existing.logo && raw.logo) existing.logo = raw.logo
      }
      if (ep) {
        if (!existing.seasons) existing.seasons = {}
        if (!existing.seasons[ep.season]) existing.seasons[ep.season] = []
        if (!existing.seasons[ep.season].includes(ep.episode)) existing.seasons[ep.season].push(ep.episode)
      }
    } else {
      map.set(id, {
        id, name: cleanName, logo: raw.logo || '', group: raw.group,
        streams: [stream], contentType,
        seasons: ep ? { [ep.season]: [ep.episode] } : undefined,
      })
    }
  }

  for (const ch of map.values()) {
    ch.streams.sort((a: any, b: any) => QUALITY_ORDER.indexOf(a.q) - QUALITY_ORDER.indexOf(b.q))
  }

  return [...map.values()]
}

function matchChannel(
  name: string,
  catalog: Array<{ id: string; title: string; alt_titles?: string[]; match_hints?: string[] }>,
  logIndex: { count: number }
) {
  const norm = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
  for (const c of catalog) {
    const hints = [
      c.title,
      ...(c.alt_titles || []),
      ...(c.match_hints || []),
    ].map(h => h.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim())

    for (const hint of hints) {
      if (norm === hint) {
        if (logIndex.count < 20) { console.log(`[Match] ${name} → ${c.id} (exact)`); logIndex.count++ }
        return c.id
      }
    }
    for (const hint of hints) {
      if (hint.length >= 10 && (norm.includes(hint) || hint.includes(norm))) {
        const diff = Math.abs(norm.length - hint.length)
        if (diff / Math.max(norm.length, hint.length) <= 0.4) {
          if (logIndex.count < 20) { console.log(`[Match] ${name} → ${c.id} (includes)`); logIndex.count++ }
          return c.id
        }
      }
    }
  }
  return null
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { playlist_id, storage_path, url } = await req.json()

    if (!playlist_id || (!storage_path && !url)) {
      return new Response(JSON.stringify({ error: 'Missing playlist_id and (storage_path or url)' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    await supabase.from('playlists').update({ status: 'processing' }).eq('id', playlist_id)

    let content: string
    if (storage_path) {
      const { data: fileData, error: dlErr } = await supabase.storage.from('playlists').download(storage_path)
      if (dlErr) throw new Error(`Storage download failed: ${dlErr.message}`)
      content = await fileData.text()
    } else {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(30000),
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': '*/*' },
      })
      if (!res.ok) throw new Error(`M3U fetch failed: ${res.status}`)
      content = await res.text()
    }

    console.log('[process-playlist] M3U size:', content.length, 'bytes')
    const raw = parseM3U(content)
    console.log('[process-playlist] Parsed', raw.length, 'raw channels')
    const normalized = normalizeStreams(raw)
    console.log('[process-playlist] Normalized to', normalized.length, 'unique channels')

    const { data: catalog } = await supabase.from('canonical_titles').select('id, title, alt_titles, match_hints')
    console.log('[process-playlist] Catalog:', catalog?.length || 0, 'titles')

    const logIndex = { count: 0 }
    const matched = normalized
      .map(ch => ({ ...ch, canonical_id: matchChannel(ch.name, catalog || [], logIndex) }))
      .filter(ch => ch.canonical_id !== null)
    console.log('[process-playlist] Matched', matched.length, '/', normalized.length)

    const { data: pl } = await supabase.from('playlists').select('user_id').eq('id', playlist_id).single()
    if (!pl) throw new Error('Playlist not found')

    let inserted = 0
    for (let i = 0; i < matched.length; i += 200) {
      const batch = matched.slice(i, i + 200).map(ch => ({
        playlist_id,
        user_id: pl.user_id,
        name: ch.name,
        streams: ch.streams,
        group_name: ch.group,
        logo_url: ch.logo || null,
        canonical_id: ch.canonical_id,
        content_type: ch.contentType,
        seasons: ch.seasons || null,
        active: true,
      }))
      const { error } = await supabase.from('channels').insert(batch)
      if (!error) inserted += batch.length
      else console.error('[process-playlist] Insert error:', error.message)
    }

    await supabase.from('playlists').update({
      status: 'ready',
      channel_count: inserted,
      processed_at: new Date().toISOString(),
    }).eq('id', playlist_id)

    console.log('[process-playlist] Done — inserted', inserted)
    return new Response(JSON.stringify({ success: true, matched: matched.length, inserted, total: raw.length }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })

  } catch (err: any) {
    console.error('[process-playlist] Error:', err.message)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
