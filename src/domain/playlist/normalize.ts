import { classifyEntry, type ProviderGroupRule, platformFromGroup } from './classifier'
import { parseTitle, textKey } from './text'
import type { NormalizeResult, NormalizedPlaylistItem, ParseIssue, RawPlaylistEntry, StreamVariant } from './types'

function identityFor(raw: RawPlaylistEntry, type: NormalizedPlaylistItem['contentType'], titleKey: string, year: number | null): string {
  if (type === 'live' && raw.tvgId) return `live:tvg:${textKey(raw.tvgId)}`
  if (raw.source === 'xtream' && type === 'series' && raw.attributes.series_id) {
    return `series:xtream:${raw.attributes.series_id}`
  }
  if (raw.source === 'xtream' && raw.externalId) return `${type}:xtream:${raw.externalId}`
  const yearPart = year ? `:${year}` : ''
  const groupPart = type === 'unknown' ? `:${textKey(raw.groupTitle || 'sem-grupo')}` : ''
  return `${type}:${titleKey || raw.id}${yearPart}${groupPart}`
}

function variantKey(variant: StreamVariant): string {
  return [variant.url, variant.season ?? '', variant.episode ?? '', variant.audioVersion, variant.quality].join('|')
}

export function normalizeEntries(
  entries: RawPlaylistEntry[],
  issues: ParseIssue[] = [],
  rules?: ProviderGroupRule[],
): NormalizeResult {
  const itemMap = new Map<string, NormalizedPlaylistItem>()
  const seenUrls = new Set<string>()
  let duplicateUrls = 0

  for (const raw of entries) {
    const classification = classifyEntry(raw, rules)
    const title = parseTitle(raw.rawName, raw.tvgName)
    const identityKey = identityFor(raw, classification.contentType, title.titleKey, title.year)
    const variant: StreamVariant = {
      rawEntryId: raw.id,
      url: raw.url,
      quality: title.quality,
      audioVersion: title.audioVersion,
      codec: title.codec,
      season: title.season,
      episode: title.episode,
    }

    if (seenUrls.has(raw.url)) duplicateUrls++
    else seenUrls.add(raw.url)

    const existing = itemMap.get(identityKey)
    if (existing) {
      const keys = new Set(existing.variants.map(variantKey))
      if (!keys.has(variantKey(variant))) existing.variants.push(variant)
      existing.rawEntryIds.push(raw.id)
      if (!existing.logoUrl && raw.logoUrl) existing.logoUrl = raw.logoUrl
      if (!existing.platform) existing.platform = platformFromGroup(raw.groupTitle)
      continue
    }

    itemMap.set(identityKey, {
      identityKey,
      contentType: classification.contentType,
      displayTitle: title.displayTitle,
      matchTitle: title.matchTitle,
      titleKey: title.titleKey,
      year: title.year,
      groupTitle: raw.groupTitle,
      tvgId: raw.tvgId,
      logoUrl: raw.logoUrl,
      platform: platformFromGroup(raw.groupTitle),
      tmdbId: raw.tmdbId,
      classificationConfidence: classification.confidence,
      classificationEvidence: classification.evidence,
      variants: [variant],
      rawEntryIds: [raw.id],
    })
  }

  const items = [...itemMap.values()]
  return {
    items,
    metrics: {
      raw: entries.length,
      output: items.length,
      unknown: items.filter((item) => item.contentType === 'unknown').length,
      duplicateUrls,
      issues: issues.length,
    },
  }
}
