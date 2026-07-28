const apiUrl = process.env.SUPABASE_URL?.replace(/\/+$/, '')
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const expectedRef = process.env.QI220_EXPECTED_PROJECT_REF || 'xkhlentrhydviqfgqdhv'
const mode = process.argv[2] || 'pre'

if (!apiUrl || !serviceKey) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
if (!['pre', 'post'].includes(mode)) throw new Error('Usage: node scripts/verify-qi220-remote.mjs pre|post')

const host = new URL(apiUrl).host
if (host !== `${expectedRef}.supabase.co`) {
  throw new Error(`Refusing unexpected project host: ${host}`)
}

const headers = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  Accept: 'application/json',
}

const openApiResponse = await fetch(`${apiUrl}/rest/v1/`, { headers })
if (!openApiResponse.ok) throw new Error(`OpenAPI failed: HTTP ${openApiResponse.status}`)
const openApi = await openApiResponse.json()
const definitions = openApi.definitions ?? openApi.components?.schemas ?? {}
const paths = openApi.paths ?? {}

async function exactCount(table, query = '') {
  const response = await fetch(`${apiUrl}/rest/v1/${table}?select=*&limit=0${query}`, {
    headers: { ...headers, Prefer: 'count=exact' },
  })
  if (!response.ok) throw new Error(`${table} count failed: HTTP ${response.status}`)
  const total = response.headers.get('content-range')?.split('/')[1]
  if (!total || total === '*') throw new Error(`${table} exact count unavailable`)
  return Number(total)
}

const baseline = {
  project_ref: expectedRef,
  playlists: await exactCount('playlists'),
  channels: await exactCount('channels'),
  canonical_titles: await exactCount('canonical_titles'),
  pairing_codes: await exactCount('pairing_codes'),
  homes: await exactCount('homes'),
  home_sections: await exactCount('home_sections'),
}

const requiredTables = [
  'playlist_import_runs', 'normalized_playlist_items', 'canonical_match_decisions',
  'canonical_identity_overrides', 'playlist_import_metrics', 'provider_group_rules',
]
const requiredRpcs = [
  'start_playlist_import', 'store_playlist_source_secret', 'promote_playlist_import',
  'rollback_playlist_import', 'cancel_playlist_import',
  'service_get_active_playlist_items', 'get_active_playlist_group_counts',
]

const tablesPresent = Object.fromEntries(requiredTables.map(name => [name, Boolean(definitions[name])]))
const rpcsPresent = Object.fromEntries(requiredRpcs.map(name => [name, Boolean(paths[`/rpc/${name}`])]))

if (mode === 'pre') {
  if (Object.values(tablesPresent).some(Boolean) || Object.values(rpcsPresent).some(Boolean)) {
    throw new Error('QI220 appears partially installed; inspect remote state before applying anything')
  }
  process.stdout.write(`${JSON.stringify({ mode, status: 'QI220_REMOTE_PRECHECK_OK', baseline, tablesPresent, rpcsPresent }, null, 2)}\n`)
} else {
  const missingTables = Object.entries(tablesPresent).filter(([, present]) => !present).map(([name]) => name)
  const missingRpcs = Object.entries(rpcsPresent).filter(([, present]) => !present).map(([name]) => name)
  if (missingTables.length || missingRpcs.length) {
    throw new Error(`QI220 incomplete: tables=${missingTables.join(',')} rpcs=${missingRpcs.join(',')}`)
  }

  const runs = await exactCount('playlist_import_runs')
  const activePlaylistsResponse = await fetch(`${apiUrl}/rest/v1/playlists?select=id,active_import_id`, { headers })
  if (!activePlaylistsResponse.ok) throw new Error(`playlist active-pointer check failed: HTTP ${activePlaylistsResponse.status}`)
  const activePlaylists = await activePlaylistsResponse.json()
  process.stdout.write(`${JSON.stringify({
    mode,
    status: 'QI220_REMOTE_POSTCHECK_OK',
    baseline,
    qi220: { runs, activePointers: activePlaylists.filter(row => row.active_import_id).length },
    tablesPresent,
    rpcsPresent,
  }, null, 2)}\n`)
}

