import type { RawPlaylistEntry } from './types'

interface XtreamCategory {
  category_id: string | number
  category_name: string
}

interface XtreamStreamBase {
  name?: string
  title?: string
  stream_icon?: string
  category_id?: string | number
  tmdb_id?: string | number
  tmdb?: string | number
}

export interface XtreamLiveStream extends XtreamStreamBase {
  stream_id: string | number
  container_extension?: string
}

export interface XtreamVodStream extends XtreamStreamBase {
  stream_id: string | number
  container_extension?: string
}

export interface XtreamEpisode {
  id: string | number
  episode_num?: string | number
  season?: string | number
  title?: string
  container_extension?: string
  info?: { tmdb_id?: string | number }
}

export interface XtreamSeries extends XtreamStreamBase {
  series_id: string | number
  cover?: string
  episodes?: XtreamEpisode[] | Record<string, XtreamEpisode[]>
}

export interface XtreamCatalogInput {
  baseUrl: string
  username: string
  password: string
  live?: XtreamLiveStream[]
  vod?: XtreamVodStream[]
  series?: XtreamSeries[]
  liveCategories?: XtreamCategory[]
  vodCategories?: XtreamCategory[]
  seriesCategories?: XtreamCategory[]
}

function positiveInteger(value: unknown): number | null {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function categoryMap(categories: XtreamCategory[] = []): Map<string, string> {
  return new Map(categories.map((category) => [String(category.category_id), category.category_name]))
}

function safeExtension(value: unknown, fallback: string): string {
  const normalized = String(value || fallback).toLowerCase().replace(/[^a-z0-9]/g, '')
  return normalized || fallback
}

function nameOf(stream: XtreamStreamBase): string {
  return String(stream.name || stream.title || '').trim()
}

function baseEntry(
  stream: XtreamStreamBase,
  order: number,
  type: 'live' | 'movie' | 'series',
  externalId: string,
  url: string,
  groupTitle: string | null,
  logoUrl: string | null,
  rawName = nameOf(stream),
): RawPlaylistEntry {
  return {
    id: `xtream:${type}:${externalId}:${order}`,
    source: 'xtream',
    order,
    rawName,
    url,
    groupTitle,
    tvgId: null,
    tvgName: null,
    logoUrl,
    attributes: { source: 'xtream', content_type: type },
    sourceType: type,
    externalId,
    categoryId: stream.category_id == null ? null : String(stream.category_id),
    tmdbId: positiveInteger(stream.tmdb_id ?? stream.tmdb),
  }
}

function flattenEpisodes(series: XtreamSeries): XtreamEpisode[] {
  if (Array.isArray(series.episodes)) return series.episodes
  if (!series.episodes) return []
  return Object.values(series.episodes).flat()
}

export function adaptXtreamCatalog(input: XtreamCatalogInput): RawPlaylistEntry[] {
  const base = input.baseUrl.replace(/\/+$/, '')
  const liveGroups = categoryMap(input.liveCategories)
  const vodGroups = categoryMap(input.vodCategories)
  const seriesGroups = categoryMap(input.seriesCategories)
  const entries: RawPlaylistEntry[] = []

  for (const stream of input.live ?? []) {
    const id = String(stream.stream_id)
    const extension = safeExtension(stream.container_extension, 'ts')
    entries.push(baseEntry(
      stream, entries.length, 'live', id,
      `${base}/live/${encodeURIComponent(input.username)}/${encodeURIComponent(input.password)}/${id}.${extension}`,
      liveGroups.get(String(stream.category_id)) ?? null,
      stream.stream_icon || null,
    ))
  }

  for (const stream of input.vod ?? []) {
    const id = String(stream.stream_id)
    const extension = safeExtension(stream.container_extension, 'mp4')
    entries.push(baseEntry(
      stream, entries.length, 'movie', id,
      `${base}/movie/${encodeURIComponent(input.username)}/${encodeURIComponent(input.password)}/${id}.${extension}`,
      vodGroups.get(String(stream.category_id)) ?? null,
      stream.stream_icon || null,
    ))
  }

  for (const series of input.series ?? []) {
    const seriesId = String(series.series_id)
    const episodes = flattenEpisodes(series)
    const group = seriesGroups.get(String(series.category_id)) ?? null
    for (const episode of episodes) {
      const episodeId = String(episode.id)
      const season = positiveInteger(episode.season) ?? 1
      const episodeNumber = positiveInteger(episode.episode_num) ?? 1
      const extension = safeExtension(episode.container_extension, 'mp4')
      const rawName = `${nameOf(series)} S${String(season).padStart(2, '0')}E${String(episodeNumber).padStart(2, '0')}`
      const entry = baseEntry(
        series, entries.length, 'series', `${seriesId}:${episodeId}`,
        `${base}/series/${encodeURIComponent(input.username)}/${encodeURIComponent(input.password)}/${episodeId}.${extension}`,
        group, series.cover || series.stream_icon || null, rawName,
      )
      entry.tmdbId = positiveInteger(episode.info?.tmdb_id) ?? entry.tmdbId
      entry.attributes.series_id = seriesId
      entry.attributes.episode_id = episodeId
      entries.push(entry)
    }
  }

  return entries
}
