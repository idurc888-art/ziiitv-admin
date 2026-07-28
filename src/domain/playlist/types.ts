export type SourceKind = 'm3u' | 'xtream'
export type ContentType = 'live' | 'movie' | 'series' | 'unknown'
export type StreamQuality = '4K' | 'FHD' | 'HD' | 'SD' | 'UNKNOWN'
export type AudioVersion = 'dubbed' | 'subtitled' | 'dual' | 'original' | 'unknown'

export interface RawPlaylistEntry {
  id: string
  source: SourceKind
  order: number
  rawName: string
  url: string
  groupTitle: string | null
  tvgId: string | null
  tvgName: string | null
  logoUrl: string | null
  attributes: Record<string, string>
  sourceType: Exclude<ContentType, 'unknown'> | null
  externalId: string | null
  categoryId: string | null
  tmdbId: number | null
}

export interface ClassificationEvidence {
  signal: 'source_type' | 'url_path' | 'episode_pattern' | 'provider_group' | 'generic_group' | 'insufficient'
  value: string
  confidence: number
}

export interface ClassifiedEntry {
  raw: RawPlaylistEntry
  contentType: ContentType
  confidence: number
  evidence: ClassificationEvidence[]
}

export interface ParsedTitle {
  displayTitle: string
  matchTitle: string
  titleKey: string
  year: number | null
  season: number | null
  episode: number | null
  quality: StreamQuality
  audioVersion: AudioVersion
  codec: 'h265' | 'h264' | null
}

export interface StreamVariant {
  rawEntryId: string
  url: string
  quality: StreamQuality
  audioVersion: AudioVersion
  codec: 'h265' | 'h264' | null
  season: number | null
  episode: number | null
}

export interface NormalizedPlaylistItem {
  identityKey: string
  contentType: ContentType
  displayTitle: string
  matchTitle: string
  titleKey: string
  year: number | null
  groupTitle: string | null
  tvgId: string | null
  logoUrl: string | null
  platform: string | null
  tmdbId: number | null
  classificationConfidence: number
  classificationEvidence: ClassificationEvidence[]
  variants: StreamVariant[]
  rawEntryIds: string[]
}

export interface CanonicalCatalogEntry {
  id: string
  title: string
  type: 'movie' | 'series'
  year: number | null
  tmdbId: number | null
  altTitles: string[]
  matchHints: string[]
}

export interface MatchCandidate {
  canonicalId: string
  confidence: number
  evidence: Record<string, unknown>
}

export interface MatchDecision {
  identityKey: string
  status: 'auto_matched' | 'review_required' | 'unmatched' | 'manually_matched' | 'rejected'
  candidateId: string | null
  confidence: number
  evidence: Record<string, unknown>
  candidates: MatchCandidate[]
}

export interface ParseIssue {
  line: number
  code: 'orphan_url' | 'missing_url' | 'missing_name' | 'invalid_url'
}

export interface ParseResult {
  entries: RawPlaylistEntry[]
  issues: ParseIssue[]
  issueCount: number
}

export interface NormalizeResult {
  items: NormalizedPlaylistItem[]
  metrics: {
    raw: number
    output: number
    unknown: number
    duplicateUrls: number
    issues: number
  }
}
