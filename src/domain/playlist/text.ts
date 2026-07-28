import type { AudioVersion, ParsedTitle, StreamQuality } from './types'

const TECHNICAL_BLOCK = /^(?:4k|uhd|2160p?|fhd|full[ .-]?hd|1080p?|hd|720p?|sd|480p?|360p?|h\.?26[45]|hevc|avc|hdr|sdr|vod|web-?dl|webrip|bluray|remux|vip|premium|pack|pt-?br|dub(?:lado)?|leg(?:endado)?|dual|original)$/i
const TECHNICAL_TOKEN = /\b(?:4K|UHD|2160P?|FHD|FULL[ .-]?HD|1080P?|HD|720P?|SD|480P?|360P?|H\.?265|H\.?264|HEVC|AVC|HDR|SDR|VOD|WEB-?DL|WEBRIP|BLURAY|REMUX|VIP|PREMIUM|PACK|PT-?BR|DUB(?:LADO)?|LEG(?:ENDADO)?|DUAL|ORIGINAL)\b/gi
const PREFIX = /^\s*(?:NETFLIX|AMAZON(?:\s+PRIME)?|PRIME(?:\s+VIDEO)?|HBO(?:\s+MAX)?|DISNEY\+?|PARAMOUNT\+?|APPLE\s+TV\+?|GLOBOPLAY|STAR\+?|CRUNCHYROLL|TELECINE)\s*[|:–—-]\s*/i
const EPISODE_PATTERNS = [
  /\b[ST]\s*0*(\d{1,2})\s*[EX]\s*0*(\d{1,4})\b/i,
  /\b0*(\d{1,2})\s*x\s*0*(\d{1,4})\b/i,
  /\bTEMPORADA\s*0*(\d{1,2})\s*EPIS[ÓO]DIO\s*0*(\d{1,4})\b/i,
] as const
const MAX_QI220_RELEASE_YEAR = 2030

export function textKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/['’ʼ]/g, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export function detectQuality(value: string): StreamQuality {
  const upper = value.toUpperCase()
  if (/\b(?:4K|UHD|2160P?)\b/.test(upper)) return '4K'
  if (/\b(?:FHD|FULL[ .-]?HD|1080P?)\b/.test(upper)) return 'FHD'
  if (/\b(?:HD|720P?)\b/.test(upper)) return 'HD'
  if (/\b(?:SD|480P?|360P?)\b/.test(upper)) return 'SD'
  return 'UNKNOWN'
}

export function detectAudioVersion(value: string): AudioVersion {
  const upper = value.toUpperCase()
  if (/\b(?:DUAL)\b/.test(upper)) return 'dual'
  if (/\b(?:LEG|LEGENDADO|SUB|SUBTITULADO)\b/.test(upper)) return 'subtitled'
  if (/\b(?:DUB|DUBLADO|PT-?BR)\b/.test(upper)) return 'dubbed'
  if (/\bORIGINAL\b/.test(upper)) return 'original'
  return 'unknown'
}

function extractEpisode(value: string): { season: number | null; episode: number | null; matched: string | null } {
  for (const pattern of EPISODE_PATTERNS) {
    const match = value.match(pattern)
    if (match) return { season: Number(match[1]), episode: Number(match[2]), matched: match[0] }
  }
  const episodeOnly = value.match(/\b(?:EP|EPIS[ÓO]DIO)\s*\.?\s*0*(\d{1,4})\b/i)
  if (episodeOnly) return { season: null, episode: Number(episodeOnly[1]), matched: episodeOnly[0] }
  return { season: null, episode: null, matched: null }
}

function stripTechnicalBlocks(value: string): string {
  return value.replace(/([([{])([^\])}]+)([\])}])/g, (whole, _open, content: string) => {
    return TECHNICAL_BLOCK.test(content.trim()) ? ' ' : whole
  })
}

export function parseTitle(rawName: string, tvgName: string | null = null): ParsedTitle {
  const source = (tvgName || rawName).trim()
  const episodeInfo = extractEpisode(source)
  const bracketedYear = source.match(/[([]((?:19|20)\d{2})[)\]]/)
  const trailingYear = bracketedYear ? null : source.match(/(?:\s*[-–—|]\s*|\s+)((?:19|20)\d{2})$/)
  const trailingValue = trailingYear ? Number(trailingYear[1]) : null
  const previousWord = trailingYear ? source.slice(0, trailingYear.index).trim().split(/\s+/).pop()?.toLowerCase() : null
  const safeTrailingYear = trailingValue && trailingValue <= MAX_QI220_RELEASE_YEAR && !/^(?:de|do|da|of|em)$/.test(previousWord || '')
    ? trailingYear
    : null
  const yearMatch = bracketedYear || safeTrailingYear
  const year = yearMatch ? Number(yearMatch[1]) : null
  let title = source.replace(PREFIX, '')
  if (episodeInfo.matched) title = title.replace(episodeInfo.matched, ' ')
  if (yearMatch) title = title.replace(yearMatch[0], ' ')
  title = stripTechnicalBlocks(title)
    .replace(TECHNICAL_TOKEN, ' ')
    .replace(/\|+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s:–—-]+|[\s:–—-]+$/g, '')
    .trim()

  const displayTitle = title || source
  return {
    displayTitle,
    matchTitle: displayTitle,
    titleKey: textKey(displayTitle),
    year,
    season: episodeInfo.season,
    episode: episodeInfo.episode,
    quality: detectQuality(source),
    audioVersion: detectAudioVersion(`${source} ${rawName}`),
    codec: /\b(?:H\.?265|HEVC)\b/i.test(source) ? 'h265' : /\b(?:H\.?264|AVC)\b/i.test(source) ? 'h264' : null,
  }
}
