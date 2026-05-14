import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const QUALITY_ORDER = ['4K', 'FHD', 'HD', 'SD', 'UNKNOWN']

const detectQuality = (name: string) => {
  const n = name.toUpperCase()
  if (/\b4K\b|\bUHD\b|\b2160P?\b/.test(n)) return '4K'
  if (/\bFHD\b|\bFULL[\s.-]?HD\b|\b1080P?\b/.test(n)) return 'FHD'
  if (/\bHD\b|\b720P?\b/.test(n)) return 'HD'
  if (/\bSD\b|\b480P?\b|\b360P?\b/.test(n)) return 'SD'
  return 'UNKNOWN'
}

const cleanChannelName = (raw: string) => 
  raw
    .replace(/\|{2,}[^|]+\|{2,}/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\{[^}]*\}/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/\b(4K|UHD|2160[Pp]?|FHD|FULL[\s.-]?HD|1080[Pp]?|HD|720[Pp]?|SD|480[Pp]?|360[Pp]?|H\.?265|H\.?264|HEVC|AVC|VOD|LEG|DUB|DUBLADO|LEGENDADO|PT-BR|BR|VIP|PREMIUM|PLUS)\b/gi, '')
    .replace(/\b(CH|CANAL)?\s*\d{1,4}\b/gi, '')
    .replace(/\b(19|20)\d{2}\b/g, '')
    .replace(/\b(S|T|EP|PARTE|PART|VOL)\s*\d+\b/gi, '')
    .replace(/[|_.\-–—:]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase())

const slugify = (name: string) =>
  name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

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

const normalizeStreams = (rawChannels: any[]) => {
  const map = new Map()
  
  for (const raw of rawChannels) {
    const cleanName = cleanChannelName(raw.name)
    if (!cleanName || cleanName.length < 2) continue
    
    const quality = detectQuality(raw.name)
    const id = slugify(cleanName)
    const stream = { u: raw.url, q: quality }
    
    if (map.has(id)) {
      const existing = map.get(id)
      if (!existing.streams.some((s: any) => s.u === raw.url)) {
        existing.streams.push(stream)
        if (!existing.logo && raw.logo) existing.logo = raw.logo
      }
    } else {
      map.set(id, { id, name: cleanName, logo: raw.logo || '', group: raw.group, streams: [stream] })
    }
  }
  
  for (const ch of map.values()) {
    ch.streams.sort((a: any, b: any) => QUALITY_ORDER.indexOf(a.q) - QUALITY_ORDER.indexOf(b.q))
  }
  
  return [...map.values()]
}

const matchChannel = (name: string, catalog: any[], logIndex: { count: number }) => {
  const norm = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
  
  for (const c of catalog) {
    const titleNorm = c.title.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
    const hints = [
      titleNorm,
      ...(c.alt_titles || []).map((t: string) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()),
      ...(c.match_hints || []).map((h: string) => h.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim())
    ]

    // 1. Exact Match Primeiramente
    for (const hint of hints) {
      if (norm === hint) {
        if (logIndex.count < 20) {
          console.log(`[Match ${logIndex.count}] ${name} → ${c.id} (Exact)`)
          logIndex.count++
        }
        return c.id
      }
    }

    // 2. Includes Fallback
    for (const hint of hints) {
      if (norm.includes(hint) || hint.includes(norm)) {
        const diff = Math.abs(norm.length - hint.length)
        const max = Math.max(norm.length, hint.length)
        
        // Exigir pelo menos 10 caracteres na string de busca para includes
        if (hint.length >= 10 || norm.length >= 10) {
          // Rejeitar diferença maior que 40%
          if ((diff / max) <= 0.40) {
            if (logIndex.count < 20) {
              console.log(`[Match ${logIndex.count}] ${name} → ${c.id} (Includes: ${hint})`)
              logIndex.count++
            }
            return c.id
          }
        }
      }
    }
  }
  return null
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' } })
  }

  try {
    console.log('[process-playlist] Starting...')
    const { playlist_id, storage_path, url } = await req.json()
    console.log('[process-playlist] Body received:', JSON.stringify({ playlist_id, storage_path, url }))
    
    if (!playlist_id || (!storage_path && !url)) {
      return new Response(JSON.stringify({ error: 'Missing playlist_id and (storage_path or url)' }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!, 
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    console.log('[process-playlist] Updating status to processing...')
    await supabase.from('playlists').update({ status: 'processing' }).eq('id', playlist_id)

    let content: string

    if (storage_path) {
      console.log('[process-playlist] Downloading from storage:', storage_path)
      const { data: fileData, error: downloadError } = await supabase.storage
        .from('playlists')
        .download(storage_path)

      if (downloadError) throw new Error(`Failed to download file: ${downloadError.message}`)

      content = await fileData.text()
    } else {
      console.log('[process-playlist] Fetching from URL:', url)
      const res = await fetch(url, {
        signal: AbortSignal.timeout(30000),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': '*/*'
        }
      })
      if (!res.ok) throw new Error(`Failed to fetch M3U: ${res.status}`)
      content = await res.text()
    }

    console.log('[process-playlist] M3U content size:', content.length, 'bytes')
    
    const raw = parseM3U(content)
    console.log('[process-playlist] Parsed', raw.length, 'raw channels')
    
    const normalized = normalizeStreams(raw)
    console.log('[process-playlist] Normalized to', normalized.length, 'unique channels')

    // Buscar catálogo para matching
    console.log('[process-playlist] Loading catalog...')
    const { data: catalog } = await supabase
      .from('canonical_titles')
      .select('id, title, alt_titles, match_hints')
    
    console.log('[process-playlist] Catalog loaded:', catalog?.length || 0, 'titles')

    // Fazer matching
    console.log('[process-playlist] Matching channels...')
    const matched = []
    const logIndex = { count: 0 }
    for (const ch of normalized) {
      const canonical_id = matchChannel(ch.name, catalog || [], logIndex)
      if (canonical_id) {
        matched.push({ ...ch, canonical_id })
      }
    }
    console.log('[process-playlist] Matched', matched.length, '/', normalized.length, 'channels')

    const { data: pl } = await supabase.from('playlists').select('user_id').eq('id', playlist_id).single()
    if (!pl) throw new Error('Playlist not found')

    console.log('[process-playlist] Inserting matched channels...')
    
    // Inserir em batches pequenos
    let inserted = 0
    for (let i = 0; i < matched.length; i += 100) {
      const batch = matched.slice(i, i + 100).map(ch => ({
        playlist_id,
        user_id: pl.user_id,
        name: ch.name,
        streams: ch.streams,
        group_name: ch.group,
        logo_url: ch.logo,
        canonical_id: ch.canonical_id
      }))
      
      const { error } = await supabase.from('channels').insert(batch)
      if (error) {
        console.error('[process-playlist] Insert error:', error)
      } else {
        inserted += batch.length
        console.log('[process-playlist] Inserted', inserted, '/', matched.length)
      }
    }

    await supabase.from('playlists').update({ 
      status: 'ready', 
      channel_count: inserted, 
      processed_at: new Date().toISOString() 
    }).eq('id', playlist_id)
    
    console.log('[process-playlist] Done! Matched', matched.length, '/', normalized.length, '- Inserted', inserted)

    return new Response(JSON.stringify({ 
      success: true, 
      matched: matched.length,
      inserted, 
      total: raw.length 
    }), { 
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } 
    })
  } catch (error: any) {
    console.error('[process-playlist] Error:', error)
    console.error('[process-playlist] Stack:', error.stack)
    
    // Tentar atualizar playlist para error
    try {
      const { playlist_id } = await req.json()
      if (playlist_id) {
        const supabase = createClient(
          Deno.env.get('SUPABASE_URL')!, 
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        )
        await supabase.from('playlists').update({ 
          status: 'error',
          error_message: error.message 
        }).eq('id', playlist_id)
      }
    } catch {}
    
    return new Response(JSON.stringify({ 
      error: error.message,
      stack: error.stack 
    }), { 
      status: 500, 
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } 
    })
  }
})
