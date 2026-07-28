import { textKey } from './text'
import type { CanonicalCatalogEntry, MatchCandidate, MatchDecision, NormalizedPlaylistItem } from './types'

export interface MatchOptions {
  manualOverrides?: ReadonlyMap<string, string>
  manualRejections?: ReadonlySet<string>
  matcherVersion?: string
}

interface MatcherIndex {
  byId: Map<string, CanonicalCatalogEntry>
  byTmdb: Map<string, CanonicalCatalogEntry>
  byExact: Map<string, CanonicalCatalogEntry[]>
  byGram: Map<string, Set<string>>
}

function bigrams(value: string): Set<string> {
  const padded = ` ${value} `
  const result = new Set<string>()
  for (let index = 0; index < padded.length - 1; index++) result.add(padded.slice(index, index + 2))
  return result
}

function diceSimilarity(left: string, right: string): number {
  if (left === right) return 1
  if (!left || !right) return 0
  const a = bigrams(left)
  const b = bigrams(right)
  let intersection = 0
  for (const gram of a) if (b.has(gram)) intersection++
  return (2 * intersection) / (a.size + b.size)
}

function typedKey(type: string, value: string): string {
  return `${type}:${value}`
}

function buildIndex(catalog: CanonicalCatalogEntry[]): MatcherIndex {
  const index: MatcherIndex = {
    byId: new Map(), byTmdb: new Map(), byExact: new Map(), byGram: new Map(),
  }
  for (const candidate of catalog) {
    index.byId.set(candidate.id, candidate)
    if (candidate.tmdbId) index.byTmdb.set(typedKey(candidate.type, String(candidate.tmdbId)), candidate)
    const names = [candidate.title, ...candidate.altTitles, ...candidate.matchHints]
    for (const name of names) {
      const key = textKey(name)
      if (!key) continue
      const exactKey = typedKey(candidate.type, key)
      const exact = index.byExact.get(exactKey) ?? []
      if (!exact.some((entry) => entry.id === candidate.id)) exact.push(candidate)
      index.byExact.set(exactKey, exact)
      for (const gram of bigrams(key)) {
        const gramKey = typedKey(candidate.type, gram)
        const ids = index.byGram.get(gramKey) ?? new Set<string>()
        ids.add(candidate.id)
        index.byGram.set(gramKey, ids)
      }
    }
  }
  return index
}

function candidatePool(item: NormalizedPlaylistItem, index: MatcherIndex): CanonicalCatalogEntry[] {
  const exact = index.byExact.get(typedKey(item.contentType, item.titleKey))
  if (exact?.length) return exact
  const counts = new Map<string, number>()
  for (const gram of bigrams(item.titleKey)) {
    for (const id of index.byGram.get(typedKey(item.contentType, gram)) ?? []) {
      counts.set(id, (counts.get(id) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 50)
    .map(([id]) => index.byId.get(id))
    .filter((candidate): candidate is CanonicalCatalogEntry => candidate !== undefined)
}

function titleScore(itemKey: string, candidate: CanonicalCatalogEntry): { score: number; source: string } {
  const primary = textKey(candidate.title)
  if (itemKey === primary) return { score: 1, source: 'title_exact' }
  for (const value of candidate.altTitles) {
    if (itemKey === textKey(value)) return { score: 0.99, source: 'alias_exact' }
  }
  for (const value of candidate.matchHints) {
    if (itemKey === textKey(value)) return { score: 0.98, source: 'hint_exact' }
  }
  const values = [primary, ...candidate.altTitles.map(textKey), ...candidate.matchHints.map(textKey)]
  return { score: Math.max(...values.map((value) => diceSimilarity(itemKey, value))), source: 'title_similarity' }
}

function rankCandidate(item: NormalizedPlaylistItem, candidate: CanonicalCatalogEntry): MatchCandidate | null {
  if (item.contentType !== candidate.type) return null
  const title = titleScore(item.titleKey, candidate)
  let confidence = title.score * 0.82 + 0.12
  if (title.source === 'title_exact') confidence += 0.06
  else if (title.source === 'alias_exact') confidence += 0.05
  else if (title.source === 'hint_exact') confidence += 0.04
  let yearSignal: 'exact' | 'conflict' | 'missing' = 'missing'
  if (item.year && candidate.year) {
    if (item.year === candidate.year) {
      confidence += 0.06
      yearSignal = 'exact'
    } else {
      confidence -= 0.35
      yearSignal = 'conflict'
    }
  }
  confidence = Math.max(0, Math.min(1, confidence))
  return {
    canonicalId: candidate.id,
    confidence,
    evidence: {
      title_signal: title.source,
      title_score: Number(title.score.toFixed(4)),
      type: candidate.type,
      year_signal: yearSignal,
      candidate_year: candidate.year,
    },
  }
}

function matchWithIndex(
  item: NormalizedPlaylistItem,
  index: MatcherIndex,
  options: MatchOptions = {},
): MatchDecision {
  const matcherVersion = options.matcherVersion ?? 'qi220-1'
  if (item.contentType !== 'movie' && item.contentType !== 'series') {
    return {
      identityKey: item.identityKey,
      status: 'unmatched', candidateId: null, confidence: 0,
      evidence: { matcher_version: matcherVersion, reason: 'content_type_not_matchable' }, candidates: [],
    }
  }

  if (options.manualRejections?.has(item.identityKey)) {
    return {
      identityKey: item.identityKey,
      status: 'rejected', candidateId: null, confidence: 0,
      evidence: { matcher_version: matcherVersion, signal: 'manual_rejection' }, candidates: [],
    }
  }

  const manual = options.manualOverrides?.get(item.identityKey)
  const manualCandidate = manual ? index.byId.get(manual) : undefined
  if (manualCandidate?.type === item.contentType) {
    return {
      identityKey: item.identityKey,
      status: 'manually_matched', candidateId: manualCandidate.id, confidence: 1,
      evidence: { matcher_version: matcherVersion, signal: 'manual_override' }, candidates: [],
    }
  }

  if (item.tmdbId) {
    const tmdb = index.byTmdb.get(typedKey(item.contentType, String(item.tmdbId)))
    if (tmdb) {
      return {
        identityKey: item.identityKey,
        status: 'auto_matched', candidateId: tmdb.id, confidence: 1,
        evidence: { matcher_version: matcherVersion, signal: 'tmdb_id', tmdb_id: item.tmdbId }, candidates: [],
      }
    }
  }

  const candidates = candidatePool(item, index)
    .map((candidate) => rankCandidate(item, candidate))
    .filter((candidate): candidate is MatchCandidate => candidate !== null)
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, 3)
  const best = candidates[0]
  const second = candidates[1]
  const margin = best ? best.confidence - (second?.confidence ?? 0) : 0

  if (best && best.confidence >= 0.975 && margin >= 0.04 && best.evidence.year_signal !== 'conflict') {
    return {
      identityKey: item.identityKey,
      status: 'auto_matched', candidateId: best.canonicalId, confidence: best.confidence,
      evidence: { matcher_version: matcherVersion, signal: 'high_confidence', margin: Number(margin.toFixed(4)), ...best.evidence },
      candidates,
    }
  }
  if (best && best.confidence >= 0.78 && margin >= 0.03) {
    return {
      identityKey: item.identityKey,
      status: 'review_required', candidateId: best.canonicalId, confidence: best.confidence,
      evidence: { matcher_version: matcherVersion, signal: 'candidate_requires_review', margin: Number(margin.toFixed(4)), ...best.evidence },
      candidates,
    }
  }
  return {
    identityKey: item.identityKey,
    status: 'unmatched', candidateId: null, confidence: best?.confidence ?? 0,
    evidence: { matcher_version: matcherVersion, reason: best ? 'ambiguous_or_low_confidence' : 'no_candidates', margin: Number(margin.toFixed(4)) },
    candidates,
  }
}

export function matchPlaylistItem(
  item: NormalizedPlaylistItem,
  catalog: CanonicalCatalogEntry[],
  options: MatchOptions = {},
): MatchDecision {
  return matchWithIndex(item, buildIndex(catalog), options)
}

export function matchPlaylistItems(
  items: NormalizedPlaylistItem[],
  catalog: CanonicalCatalogEntry[],
  options: MatchOptions = {},
): MatchDecision[] {
  const index = buildIndex(catalog)
  return items.map((item) => matchWithIndex(item, index, options))
}
