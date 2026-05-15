import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

interface Entry { id: string; streaming: string | null }

function buildIndex(catalog: any[]) {
  const bySlug = new Map<string, Entry>()
  const byAlt  = new Map<string, Entry>()
  const byHint = new Map<string, Entry>()

  for (const c of catalog) {
    const entry: Entry = { id: c.id, streaming: c.streaming || null }
    const s = slugify(c.title)
    if (!bySlug.has(s)) bySlug.set(s, entry)

    for (const alt of (c.alt_titles || [])) {
      const as = slugify(alt)
      if (!bySlug.has(as) && !byAlt.has(as)) byAlt.set(as, entry)
    }

    for (const hint of (c.match_hints || [])) {
      if (hint.length >= 6) {
        const hs = slugify(hint)
        if (!bySlug.has(hs) && !byAlt.has(hs) && !byHint.has(hs)) byHint.set(hs, entry)
      }
    }
  }

  return { bySlug, byAlt, byHint, raw: catalog }
}

type Index = ReturnType<typeof buildIndex>

function ok(e: Entry, streaming: string | null) {
  return !streaming || !e.streaming || e.streaming === streaming
}

function lookup(name: string, streaming: string | null, idx: Index): string | null {
  const s = slugify(name)

  const e1 = idx.bySlug.get(s); if (e1 && ok(e1, streaming)) return e1.id
  const e2 = idx.byAlt.get(s);  if (e2 && ok(e2, streaming)) return e2.id
  const e3 = idx.byHint.get(s); if (e3 && ok(e3, streaming)) return e3.id

  const tokens = s.split('-').filter(t => t.length >= 3)
  if (tokens.length >= 2) {
    const pool = streaming
      ? idx.raw.filter((c: any) => !c.streaming || c.streaming === streaming)
      : idx.raw

    for (const c of pool) {
      const ct = slugify(c.title).split('-').filter((t: string) => t.length >= 3)
      if (ct.length >= 2 && ct.every((t: string) => tokens.includes(t))) return c.id
    }
    for (const c of pool) {
      for (const alt of (c.alt_titles || [])) {
        const at = slugify(alt).split('-').filter((t: string) => t.length >= 3)
        if (at.length >= 2 && at.every((t: string) => tokens.includes(t))) return c.id
      }
    }
  }

  // Retry sem filtro de streaming
  if (streaming) {
    const ef = idx.bySlug.get(s) ?? idx.byAlt.get(s) ?? idx.byHint.get(s)
    if (ef) return ef.id
  }

  return null
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), { status: 401, headers: CORS })
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authErr } = await admin.auth.getUser(token)
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS })
    }

    const { playlist_id } = await req.json()
    if (!playlist_id) {
      return new Response(JSON.stringify({ error: 'playlist_id required' }), { status: 400, headers: CORS })
    }

    // ── 1. Carrega canonical_titles no servidor (sem timeout de browser) ──────
    const PAGE = 1000
    let catalog: any[] = []
    let from = 0
    while (true) {
      const { data, error } = await admin
        .from('canonical_titles')
        .select('id, title, alt_titles, match_hints, streaming')
        .range(from, from + PAGE - 1)
      if (error || !data || data.length === 0) break
      catalog = catalog.concat(data)
      if (data.length < PAGE) break
      from += PAGE
    }

    const idx = buildIndex(catalog)

    // ── 2. Carrega canais sem canonical_id desta playlist ─────────────────────
    let channels: any[] = []
    from = 0
    while (true) {
      const { data, error } = await admin
        .from('channels')
        .select('id, name, streaming')
        .eq('playlist_id', playlist_id)
        .is('canonical_id', null)
        .range(from, from + PAGE - 1)
      if (error || !data || data.length === 0) break
      channels = channels.concat(data)
      if (data.length < PAGE) break
      from += PAGE
    }

    // ── 3. Matching + batch UPDATE via stored procedure ───────────────────────
    const updates: { id: string; canonical_id: string }[] = []
    for (const ch of channels) {
      const cid = lookup(ch.name, ch.streaming, idx)
      if (cid) updates.push({ id: ch.id, canonical_id: cid })
    }

    let linked = 0
    if (updates.length > 0) {
      const BATCH = 2000
      for (let i = 0; i < updates.length; i += BATCH) {
        const { error } = await admin.rpc('link_channels_to_catalog', {
          p_updates: updates.slice(i, i + BATCH),
        })
        if (error) throw error
        linked += Math.min(BATCH, updates.length - i)
      }
    }

    return new Response(
      JSON.stringify({ success: true, catalog_size: catalog.length, total: channels.length, linked }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } }
    )

  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
    )
  }
})
