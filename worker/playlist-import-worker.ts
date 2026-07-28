import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  adaptXtreamCatalog,
  matchPlaylistItems,
  normalizeEntries,
  parseM3uStream,
  type CanonicalCatalogEntry,
  type MatchDecision,
  type NormalizedPlaylistItem,
  type RawPlaylistEntry,
  type XtreamCatalogInput,
  type XtreamSeries,
} from '../src/domain/playlist/index'

const MAX_SOURCE_BYTES = 500 * 1024 * 1024
const MAX_JSON_BYTES = 128 * 1024 * 1024
const FETCH_HEADER_TIMEOUT_MS = 45_000
const READ_IDLE_TIMEOUT_MS = 30_000
const RAW_BATCH_SIZE = 500
const ITEM_BATCH_SIZE = 100
const VARIANTS_PER_ITEM_BATCH = 250
const MATCH_BATCH_SIZE = 500
const MAX_REDIRECTS = 3
const PARSER_VERSION = 'qi220-1'
const IDLE_POLL_MS = 2_000
const ERROR_BACKOFF_MS = 5_000

interface QueueMessage {
  msg_id: number
  read_ct: number
  message: { import_id?: string }
}

interface ImportRun {
  id: string
  playlist_id: string
  user_id: string
  status: string
  source_kind: 'm3u' | 'xtream'
  source_mode: 'file' | 'url' | 'api'
  storage_path: string | null
  parser_version: string
  matcher_version: string
  attempt_count: number
  source_secret: Record<string, unknown> | null
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`missing_environment:${name}`)
  return value
}

function isPrivateIpv4(address: string): boolean {
  const octets = address.split('.').map(Number)
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return true
  const [a, b, c] = octets
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 192 && b === 0 && (c === 0 || c === 2))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
    || (a === 198 && (b === 18 || b === 19))
}

function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase()
  if (isIP(normalized) === 4) return isPrivateIpv4(normalized)
  if (isIP(normalized) !== 6) return true
  if (normalized.startsWith('::ffff:')) return isPrivateIpv4(normalized.slice(7))
  return normalized === '::' || normalized === '::1'
    || normalized.startsWith('fc') || normalized.startsWith('fd')
    || /^fe[89ab]/.test(normalized)
    || normalized.startsWith('ff') || normalized.startsWith('2001:db8:')
}

async function assertPublicUrl(value: string): Promise<URL> {
  const url = new URL(value)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('source_protocol_not_allowed')
  if (url.username || url.password) throw new Error('source_url_credentials_not_allowed')
  const hostname = url.hostname.toLowerCase()
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new Error('source_host_not_allowed')
  }
  const addresses = await lookup(hostname, { all: true, verbatim: true })
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error('source_address_not_allowed')
  }
  return url
}

async function safeFetch(value: string, init: RequestInit = {}, redirectCount = 0): Promise<Response> {
  const url = await assertPublicUrl(value)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_HEADER_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      ...init,
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        'User-Agent': 'ziiiTV-import-worker/1.0',
        Accept: '*/*',
        ...init.headers,
      },
    })
    if (response.status >= 300 && response.status < 400) {
      if (redirectCount >= MAX_REDIRECTS) throw new Error('source_redirect_limit')
      const location = response.headers.get('location')
      if (!location) throw new Error('source_redirect_without_location')
      return safeFetch(new URL(location, url).toString(), init, redirectCount + 1)
    }
    if (!response.ok) throw new Error(`source_http_${response.status}`)
    return response
  } finally {
    clearTimeout(timeout)
  }
}

async function readWithIdleTimeout(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('source_read_timeout')), READ_IDLE_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

async function* responseChunks(response: Response, byteLimit = MAX_SOURCE_BYTES): AsyncGenerator<Uint8Array> {
  if (!response.body) throw new Error('source_body_missing')
  const reader = response.body.getReader()
  let received = 0
  while (true) {
    let result: ReadableStreamReadResult<Uint8Array>
    try {
      result = await readWithIdleTimeout(reader)
    } catch (error) {
      await reader.cancel().catch(() => undefined)
      throw error
    }
    const { done, value } = result
    if (done) break
    received += value.byteLength
    if (received > byteLimit) {
      await reader.cancel()
      throw new Error('source_too_large')
    }
    yield value
  }
}

async function* blobChunks(blob: Blob): AsyncGenerator<Uint8Array> {
  if (blob.size > MAX_SOURCE_BYTES) throw new Error('source_too_large')
  const reader = blob.stream().getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    yield value
  }
}

async function rpc<T>(client: SupabaseClient, name: string, parameters: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await client.rpc(name, parameters)
  if (error) throw new Error(`${name}:${error.message}`)
  return data as T
}

async function updateRun(
  client: SupabaseClient,
  importId: string,
  status: string,
  progress: number,
  stage: string,
  errorCode: string | null = null,
  errorMessage: string | null = null,
): Promise<void> {
  await rpc(client, 'worker_update_playlist_import', {
    p_import_id: importId,
    p_status: status,
    p_progress: progress,
    p_stage: stage,
    p_error_code: errorCode,
    p_error_message: errorMessage,
  })
}

async function assertNotCancelled(client: SupabaseClient, importId: string): Promise<void> {
  const cancelled = await rpc<boolean>(client, 'worker_is_playlist_import_cancelled', { p_import_id: importId })
  if (cancelled) throw new Error('import_cancelled')
}

async function stageRawEntries(client: SupabaseClient, importId: string, entries: RawPlaylistEntry[]): Promise<void> {
  for (let offset = 0; offset < entries.length; offset += RAW_BATCH_SIZE) {
    await rpc(client, 'worker_stage_raw_entries', {
      p_import_id: importId,
      p_entries: entries.slice(offset, offset + RAW_BATCH_SIZE),
    })
  }
}

function itemPayloads(items: NormalizedPlaylistItem[]): NormalizedPlaylistItem[][] {
  const fragments: NormalizedPlaylistItem[] = []
  for (const item of items) {
    if (item.variants.length === 0) {
      fragments.push(item)
      continue
    }
    for (let offset = 0; offset < item.variants.length; offset += VARIANTS_PER_ITEM_BATCH) {
      fragments.push({ ...item, variants: item.variants.slice(offset, offset + VARIANTS_PER_ITEM_BATCH) })
    }
  }
  const batches: NormalizedPlaylistItem[][] = []
  for (let offset = 0; offset < fragments.length; offset += ITEM_BATCH_SIZE) {
    batches.push(fragments.slice(offset, offset + ITEM_BATCH_SIZE))
  }
  return batches
}

async function stageNormalizedItems(client: SupabaseClient, importId: string, items: NormalizedPlaylistItem[]): Promise<void> {
  for (const batch of itemPayloads(items)) {
    await rpc(client, 'worker_stage_normalized_items', { p_import_id: importId, p_items: batch })
  }
}

async function loadCanonicalCatalog(client: SupabaseClient): Promise<CanonicalCatalogEntry[]> {
  const catalog: CanonicalCatalogEntry[] = []
  const pageSize = 1000
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await client
      .from('canonical_titles')
      .select('id,title,type,year,tmdb_id,alt_titles,match_hints')
      .range(offset, offset + pageSize - 1)
    if (error) throw new Error(`canonical_catalog:${error.message}`)
    const rows = data ?? []
    catalog.push(...rows.map((row) => ({
      id: row.id,
      title: row.title,
      type: row.type as 'movie' | 'series',
      year: Number.parseInt(String(row.year ?? ''), 10) || null,
      tmdbId: Number.parseInt(String(row.tmdb_id ?? ''), 10) || null,
      altTitles: Array.isArray(row.alt_titles) ? row.alt_titles : [],
      matchHints: Array.isArray(row.match_hints) ? row.match_hints : [],
    })))
    if (rows.length < pageSize) break
  }
  return catalog
}

async function loadManualOverrides(client: SupabaseClient, playlistId: string): Promise<{
  matches: Map<string, string>
  rejections: Set<string>
}> {
  const matches = new Map<string, string>()
  const rejections = new Set<string>()
  const pageSize = 1000
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await client
      .from('canonical_identity_overrides')
      .select('identity_key,canonical_id,decision')
      .eq('playlist_id', playlistId)
      .range(offset, offset + pageSize - 1)
    if (error) throw new Error(`canonical_overrides:${error.message}`)
    const rows = data ?? []
    for (const row of rows) {
      if (row.decision === 'rejected') rejections.add(row.identity_key)
      else if (row.canonical_id) matches.set(row.identity_key, row.canonical_id)
    }
    if (rows.length < pageSize) break
  }
  return { matches, rejections }
}

async function stageMatchDecisions(
  client: SupabaseClient,
  importId: string,
  matcherVersion: string,
  decisions: MatchDecision[],
): Promise<void> {
  for (let offset = 0; offset < decisions.length; offset += MATCH_BATCH_SIZE) {
    await rpc(client, 'worker_apply_match_decisions', {
      p_import_id: importId,
      p_matcher_version: matcherVersion,
      p_decisions: decisions.slice(offset, offset + MATCH_BATCH_SIZE),
    })
  }
}

async function loadM3uChunks(client: SupabaseClient, run: ImportRun): Promise<AsyncIterable<Uint8Array>> {
  if (run.source_mode === 'file') {
    if (!run.storage_path) throw new Error('storage_path_missing')
    const { data, error } = await client.storage.from('playlist-sources').download(run.storage_path)
    if (error || !data) throw new Error(`storage_download_failed:${error?.message || 'empty'}`)
    return blobChunks(data)
  }

  const sourceUrl = run.source_secret?.url
  if (typeof sourceUrl !== 'string') throw new Error('source_url_missing')
  const response = await safeFetch(sourceUrl)
  return responseChunks(response)
}

function apiUrl(baseUrl: string, username: string, password: string, action: string, extra: Record<string, string> = {}): string {
  const url = new URL('/player_api.php', baseUrl)
  url.searchParams.set('username', username)
  url.searchParams.set('password', password)
  url.searchParams.set('action', action)
  for (const [key, value] of Object.entries(extra)) url.searchParams.set(key, value)
  return url.toString()
}

async function fetchJson(value: string): Promise<unknown> {
  const response = await safeFetch(value, { headers: { Accept: 'application/json' } })
  const declaredLength = Number(response.headers.get('content-length') || 0)
  if (declaredLength > MAX_JSON_BYTES) throw new Error('source_too_large')
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of responseChunks(response, MAX_JSON_BYTES)) {
    chunks.push(chunk)
    size += chunk.byteLength
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new Error('source_invalid_json')
  }
}

function asArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value as Record<string, unknown>[]
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    for (const key of ['data', 'result', 'streams']) {
      if (Array.isArray(record[key])) return record[key] as Record<string, unknown>[]
    }
  }
  return []
}

async function mapConcurrent<T, R>(values: T[], concurrency: number, mapper: (value: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(values.length)
  let cursor = 0
  async function consume(): Promise<void> {
    while (cursor < values.length) {
      const index = cursor++
      output[index] = await mapper(values[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, consume))
  return output
}

async function processXtream(
  run: ImportRun,
  onEntries: (entries: RawPlaylistEntry[]) => Promise<void>,
): Promise<{ rawCount: number; warnings: string[] }> {
  const secret = run.source_secret
  const baseUrl = secret?.baseUrl
  const username = secret?.username
  const password = secret?.password
  if (typeof baseUrl !== 'string' || typeof username !== 'string' || typeof password !== 'string') {
    throw new Error('xtream_credentials_missing')
  }
  await assertPublicUrl(baseUrl)

  const [liveCategories, vodCategories, seriesCategories] = await Promise.all([
    fetchJson(apiUrl(baseUrl, username, password, 'get_live_categories')),
    fetchJson(apiUrl(baseUrl, username, password, 'get_vod_categories')),
    fetchJson(apiUrl(baseUrl, username, password, 'get_series_categories')),
  ])
  const warnings: string[] = []
  let rawCount = 0
  const common: Pick<XtreamCatalogInput, 'baseUrl' | 'username' | 'password'> = {
    baseUrl,
    username,
    password,
  }

  const live = asArray(await fetchJson(apiUrl(baseUrl, username, password, 'get_live_streams'))) as never
  const liveEntries = adaptXtreamCatalog({
    ...common,
    liveCategories: asArray(liveCategories) as never,
    live,
  })
  rawCount += liveEntries.length
  await onEntries(liveEntries)

  const vod = asArray(await fetchJson(apiUrl(baseUrl, username, password, 'get_vod_streams'))) as never
  const vodEntries = adaptXtreamCatalog({
    ...common,
    vodCategories: asArray(vodCategories) as never,
    vod,
  })
  rawCount += vodEntries.length
  await onEntries(vodEntries)

  const series = asArray(await fetchJson(apiUrl(baseUrl, username, password, 'get_series'))) as unknown as XtreamSeries[]
  const seriesCategoryRows = asArray(seriesCategories) as never
  const hydrationWindow = 24
  for (let offset = 0; offset < series.length; offset += hydrationWindow) {
    const window = series.slice(offset, offset + hydrationWindow)
    const hydrated = await mapConcurrent(window, 6, async (item) => {
      try {
        const info = await fetchJson(apiUrl(baseUrl, username, password, 'get_series_info', { series_id: String(item.series_id) }))
        const record = info && typeof info === 'object' ? info as Record<string, unknown> : {}
        return { ...item, episodes: record.episodes as XtreamSeries['episodes'] }
      } catch {
        warnings.push(`series_info_failed:${item.series_id}`)
        return item
      }
    })
    const entries = adaptXtreamCatalog({ ...common, seriesCategories: seriesCategoryRows, series: hydrated })
    rawCount += entries.length
    await onEntries(entries)
  }

  warnings.sort()
  return { rawCount, warnings }
}

function safeError(error: unknown): { code: string; message: string } {
  const message = error instanceof Error ? error.message : String(error)
  const sanitized = message
    .replace(/([?&](?:username|password)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/\/(live|movie|series)\/[^/\s]+\/[^/\s]+\//gi, '/$1/[REDACTED]/[REDACTED]/')
    .slice(0, 1000)
  return { code: sanitized.split(':')[0].slice(0, 120), message: sanitized }
}

async function processImport(client: SupabaseClient, importId: string): Promise<void> {
  const run = await rpc<ImportRun | null>(client, 'worker_get_playlist_import', { p_import_id: importId })
  if (!run) throw new Error('import_not_found')
  if (run.status !== 'queued' && run.status !== 'failed') throw new Error(`import_not_processable:${run.status}`)
  if (run.parser_version !== PARSER_VERSION) throw new Error(`parser_version_unsupported:${run.parser_version}`)

  await updateRun(client, importId, 'fetching', 5, 'fetching')
  await rpc(client, 'worker_reset_playlist_import', { p_import_id: importId })
  let parseIssueCount = 0
  let warnings: string[]
  const [catalog, overrides] = await Promise.all([
    loadCanonicalCatalog(client),
    loadManualOverrides(client, run.playlist_id),
  ])
  const stagePipelineEntries = async (entries: RawPlaylistEntry[]): Promise<void> => {
    if (entries.length === 0) return
    await assertNotCancelled(client, importId)
    await stageRawEntries(client, importId, entries)
    const normalized = normalizeEntries(entries)
    await stageNormalizedItems(client, importId, normalized.items)
    const decisions = matchPlaylistItems(normalized.items, catalog, {
      manualOverrides: overrides.matches,
      manualRejections: overrides.rejections,
      matcherVersion: run.matcher_version,
    })
    await stageMatchDecisions(client, importId, run.matcher_version, decisions)
  }

  if (run.source_kind === 'm3u') {
    const chunks = await loadM3uChunks(client, run)
    let rawCount = 0
    await updateRun(client, importId, 'parsing', 30, 'streaming_pipeline')
    const parsed = await parseM3uStream(chunks, {
      batchSize: RAW_BATCH_SIZE,
      onEntries: async (entries) => {
        rawCount += entries.length
        await stagePipelineEntries(entries)
      },
    })
    parseIssueCount = parsed.issueCount
    warnings = parsed.issues.slice(0, 50).map(issue => `m3u:${issue.line}:${issue.code}`)
    if (rawCount === 0) throw new Error('source_has_no_valid_entries')
    await updateRun(client, importId, 'normalizing', 55, 'streaming_normalized')
    await updateRun(client, importId, 'matching', 75, 'streaming_matched')
  } else {
    await updateRun(client, importId, 'parsing', 30, 'streaming_pipeline')
    const result = await processXtream(run, stagePipelineEntries)
    warnings = result.warnings
    if (result.rawCount === 0) throw new Error('source_has_no_valid_entries')
    await updateRun(client, importId, 'normalizing', 55, 'streaming_normalized')
    await updateRun(client, importId, 'matching', 75, 'streaming_matched')
  }

  await updateRun(client, importId, 'validating', 90, 'validating')
  await assertNotCancelled(client, importId)
  await rpc(client, 'worker_finalize_playlist_import', {
    p_import_id: importId,
    p_duplicate_url_count: 0,
    p_parse_issue_count: parseIssueCount,
    p_warnings: warnings,
  })
}

async function runOnce(client: SupabaseClient): Promise<boolean> {
  const messages = await rpc<QueueMessage[]>(client, 'worker_claim_playlist_import', { p_visibility_seconds: 900 })
  const queueMessage = messages?.[0]
  if (!queueMessage) return false
  const importId = queueMessage.message?.import_id
  if (!importId) {
    await rpc(client, 'worker_archive_playlist_import', { p_msg_id: queueMessage.msg_id })
    return true
  }

  try {
    await processImport(client, importId)
    await rpc(client, 'worker_archive_playlist_import', { p_msg_id: queueMessage.msg_id })
  } catch (error) {
    const safe = safeError(error)
    if (safe.code === 'import_cancelled' || safe.code === 'import_not_processable') {
      await rpc(client, 'worker_archive_playlist_import', { p_msg_id: queueMessage.msg_id })
      return true
    }
    await updateRun(client, importId, 'failed', 0, 'failed', safe.code, safe.message).catch(() => undefined)
    if (queueMessage.read_ct >= 3) {
      await rpc(client, 'worker_archive_playlist_import', { p_msg_id: queueMessage.msg_id })
    }
    throw error
  }
  return true
}

async function main(): Promise<void> {
  const client = createClient(
    requiredEnvironment('SUPABASE_URL'),
    requiredEnvironment('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
  if (process.env.WORKER_MODE !== 'continuous') {
    const processed = await runOnce(client)
    process.stdout.write(processed ? 'playlist_import_processed\n' : 'playlist_import_queue_empty\n')
    return
  }

  let stopping = false
  process.once('SIGTERM', () => { stopping = true })
  process.once('SIGINT', () => { stopping = true })
  while (!stopping) {
    try {
      const processed = await runOnce(client)
      if (!processed) await new Promise(resolve => setTimeout(resolve, IDLE_POLL_MS))
    } catch (error) {
      const safe = safeError(error)
      process.stderr.write(`playlist_import_iteration_failed:${safe.code}\n`)
      await new Promise(resolve => setTimeout(resolve, ERROR_BACKOFF_MS))
    }
  }
}

const isDirectExecution = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false

if (isDirectExecution) {
  main().catch((error) => {
    const safe = safeError(error)
    process.stderr.write(`playlist_import_failed:${safe.code}\n`)
    process.exitCode = 1
  })
}

export {
  assertPublicUrl,
  isPrivateAddress,
  itemPayloads,
  safeError,
}
