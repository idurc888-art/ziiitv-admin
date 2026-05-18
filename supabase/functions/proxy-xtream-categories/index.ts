import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: cors })

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Verify user session
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: cors })

    const url    = new URL(req.url)
    const pid    = url.searchParams.get('playlist_id')
    if (!pid) return new Response(JSON.stringify({ error: 'Missing playlist_id' }), { status: 400, headers: cors })

    const { data: playlist } = await supabase
      .from('playlists')
      .select('url_original')
      .eq('id', pid)
      .eq('user_id', user.id)
      .single()

    if (!playlist) return new Response(JSON.stringify({ error: 'Playlist not found' }), { status: 404, headers: cors })

    const pu       = new URL(playlist.url_original)
    const host     = pu.origin
    const username = pu.searchParams.get('username') ?? ''
    const password = pu.searchParams.get('password') ?? ''
    const api      = `${host}/player_api.php?username=${username}&password=${password}`

    const controller = new AbortController()
    const timeout    = setTimeout(() => controller.abort(), 12000)

    const [live, vod, series] = await Promise.all([
      fetch(`${api}&action=get_live_categories`,    { signal: controller.signal }).then(r => r.json()).catch(() => []),
      fetch(`${api}&action=get_vod_categories`,     { signal: controller.signal }).then(r => r.json()).catch(() => []),
      fetch(`${api}&action=get_series_categories`,  { signal: controller.signal }).then(r => r.json()).catch(() => []),
    ])

    clearTimeout(timeout)

    return new Response(JSON.stringify({ live, vod, series }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message ?? String(err) }), {
      status: 500,
      headers: cors,
    })
  }
})
