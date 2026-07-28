import { supabase } from './supabase'

export const PLAYLIST_PARSER_VERSION = 'qi220-1'
export const PLAYLIST_MATCHER_VERSION = 'qi220-1'
export const MAX_PLAYLIST_FILE_BYTES = 500 * 1024 * 1024

export type PlaylistSource =
  | { mode: 'file'; file: File }
  | { mode: 'url'; url: string }
  | { mode: 'xtream'; baseUrl: string; username: string; password: string }

function publicSourceLabel(source: PlaylistSource): string {
  if (source.mode === 'file') return `Arquivo · ${source.file.name}`
  const parsed = new URL(source.mode === 'url' ? source.url : source.baseUrl)
  return `${source.mode === 'url' ? 'M3U' : 'Xtream'} · ${parsed.hostname}`
}

function sourceFingerprint(source: PlaylistSource): string {
  if (source.mode === 'file') return `file:${source.file.name}:${source.file.size}:${source.file.lastModified}`
  const parsed = new URL(source.mode === 'url' ? source.url : source.baseUrl)
  return `${source.mode}:${parsed.protocol}//${parsed.host}`
}

function validateSource(source: PlaylistSource): void {
  if (source.mode === 'file') {
    if (source.file.size === 0) throw new Error('O arquivo está vazio.')
    if (source.file.size > MAX_PLAYLIST_FILE_BYTES) throw new Error('O arquivo excede o limite de 500 MB.')
    return
  }
  const parsed = new URL(source.mode === 'url' ? source.url : source.baseUrl)
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Use uma origem HTTP ou HTTPS.')
  if (source.mode === 'xtream' && (!source.username.trim() || !source.password)) {
    throw new Error('Informe usuário e senha Xtream.')
  }
}

export async function startPlaylistImport(source: PlaylistSource): Promise<{ playlistId: string; importId: string }> {
  validateSource(source)
  const { data: authData, error: authError } = await supabase.auth.getUser()
  const user = authData.user
  if (authError || !user) throw new Error('Sessão expirada. Entre novamente.')

  const { data: playlist, error: playlistError } = await supabase
    .from('playlists')
    .insert({
      user_id: user.id,
      url_original: publicSourceLabel(source),
      status: 'pending',
      channel_count: 0,
    })
    .select('id')
    .single()
  if (playlistError || !playlist) throw new Error(playlistError?.message || 'Não foi possível criar a playlist.')

  try {
    let storagePath: string | null = null
    let sourceSecretId: string | null = null
    let sourceKind: 'm3u' | 'xtream' = 'm3u'
    let sourceMode: 'file' | 'url' | 'api' = 'url'

    if (source.mode === 'file') {
      sourceMode = 'file'
      const safeName = source.file.name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-120) || 'playlist.m3u'
      storagePath = `${user.id}/${playlist.id}/${crypto.randomUUID()}-${safeName}`
      const { error } = await supabase.storage.from('playlist-sources').upload(storagePath, source.file, {
        cacheControl: '0', upsert: false, contentType: source.file.type || 'audio/x-mpegurl',
      })
      if (error) throw new Error(`Falha ao enviar arquivo: ${error.message}`)
    } else {
      sourceKind = source.mode === 'xtream' ? 'xtream' : 'm3u'
      sourceMode = source.mode === 'xtream' ? 'api' : 'url'
      const secret = source.mode === 'xtream'
        ? { baseUrl: source.baseUrl.trim().replace(/\/+$/, ''), username: source.username.trim(), password: source.password }
        : { url: source.url.trim() }
      const { data, error } = await supabase.rpc('store_playlist_source_secret', {
        p_playlist_id: playlist.id,
        p_secret: secret,
      })
      if (error || !data) throw new Error(error?.message || 'Não foi possível proteger a origem da lista.')
      sourceSecretId = data as string
    }

    const { data: importId, error: importError } = await supabase.rpc('start_playlist_import', {
      p_playlist_id: playlist.id,
      p_source_kind: sourceKind,
      p_source_mode: sourceMode,
      p_storage_path: storagePath,
      p_source_secret_id: sourceSecretId,
      p_source_fingerprint: sourceFingerprint(source),
      p_idempotency_key: crypto.randomUUID(),
      p_parser_version: PLAYLIST_PARSER_VERSION,
      p_matcher_version: PLAYLIST_MATCHER_VERSION,
    })
    if (importError || !importId) throw new Error(importError?.message || 'Não foi possível enfileirar a importação.')
    return { playlistId: playlist.id, importId: importId as string }
  } catch (error) {
    await supabase.from('playlists').update({
      status: 'error', error_message: 'Falha ao preparar importação QI220',
    }).eq('id', playlist.id)
    throw error
  }
}
