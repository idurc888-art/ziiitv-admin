import type { ClassifiedEntry, ClassificationEvidence, ContentType, RawPlaylistEntry } from './types'

export interface ProviderGroupRule {
  pattern: RegExp
  contentType: Exclude<ContentType, 'unknown'>
  platform?: string
}

export const DEFAULT_GROUP_RULES: ProviderGroupRule[] = [
  { pattern: /\b(?:s[eé]ries?|seriados?|novelas?|doramas?|animes?)\b/i, contentType: 'series' },
  { pattern: /\b(?:filmes?|movies?|cinema|vod|lan[çc]amentos?)\b/i, contentType: 'movie' },
  { pattern: /\b(?:canais?|ao\s*vivo|live|esportes?|not[ií]cias?|abertos?|ppv|futebol)\b/i, contentType: 'live' },
]

function addEvidence(target: ClassificationEvidence[], evidence: ClassificationEvidence): void {
  target.push(evidence)
}

export function classifyEntry(raw: RawPlaylistEntry, rules: ProviderGroupRule[] = DEFAULT_GROUP_RULES): ClassifiedEntry {
  const evidence: ClassificationEvidence[] = []
  if (raw.sourceType) {
    addEvidence(evidence, { signal: 'source_type', value: raw.sourceType, confidence: 1 })
  }

  const pathType = raw.url.match(/\/(live|movie|series)\//i)?.[1]?.toLowerCase() as ContentType | undefined
  if (pathType) addEvidence(evidence, { signal: 'url_path', value: pathType, confidence: 0.98 })

  if (/\b(?:[ST]\s*\d{1,2}\s*[EX]\s*\d{1,4}|\d{1,2}\s*x\s*\d{1,4})\b/i.test(raw.rawName)) {
    addEvidence(evidence, { signal: 'episode_pattern', value: 'series', confidence: 0.96 })
  }

  if (raw.groupTitle) {
    for (const rule of rules) {
      if (rule.pattern.test(raw.groupTitle)) {
        addEvidence(evidence, { signal: 'generic_group', value: rule.contentType, confidence: 0.88 })
      }
    }
  }

  const ranked = [...evidence].sort((a, b) => b.confidence - a.confidence)
  const winner = ranked[0]
  if (!winner) {
    return {
      raw,
      contentType: 'unknown',
      confidence: 0,
      evidence: [{ signal: 'insufficient', value: 'unknown', confidence: 0 }],
    }
  }
  const topTypes = new Set(ranked.filter(item => item.confidence === winner.confidence).map(item => item.value))
  if (topTypes.size > 1) {
    return {
      raw,
      contentType: 'unknown',
      confidence: 0,
      evidence: [...ranked, { signal: 'insufficient', value: 'conflicting_signals', confidence: 0 }],
    }
  }
  return { raw, contentType: winner.value as ContentType, confidence: winner.confidence, evidence: ranked }
}

export function platformFromGroup(groupTitle: string | null): string | null {
  if (!groupTitle) return null
  const mappings: Array<[RegExp, string]> = [
    [/\bnetflix\b/i, 'netflix'],
    [/\b(?:amazon|prime video)\b/i, 'amazon'],
    [/\b(?:hbo(?:\s+max)?|max\s+originals?)\b/i, 'hbo'],
    [/\bdisney\+?\b/i, 'disney'],
    [/\bparamount\+?\b/i, 'paramount'],
    [/\bapple tv\+?\b/i, 'apple'],
    [/\bgloboplay\b/i, 'globoplay'],
    [/\bcrunchyroll\b/i, 'crunchyroll'],
  ]
  return mappings.find(([pattern]) => pattern.test(groupTitle))?.[1] ?? null
}
