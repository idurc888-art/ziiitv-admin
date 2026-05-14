/**
 * m3uProcessor.ts — v2
 *
 * Regras validadas da M3U real (280k canais):
 *
 *  LIVE  → "Canais | *"            qualidade nos colchetes do nome [FHD][H265]
 *
 *  FILME → "Filmes | <gênero>"     dublado PT  (default)
 *          "Filmes | Legendados"   legendado   (EN ou PT-LEG)
 *          "Filmes | 4K"           4K dublado
 *          Mesmo título em múltiplos grupos → 1 card com seletor Dublado/Legendado/4K
 *
 *  SÉRIE → "Series | <streaming>"  fonte declarada
 *          "Series | Legendadas"   bucket genérico → descarta se já existe com streaming
 *          Episódios: SxxExx no final do nome
 *
 *  DESCARTA → "Suporte Core" e similares
 *  4K tem prioridade máxima em todas as listas
 */

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type StreamQuality = '4K' | 'FHD' | 'HD' | 'SD' | 'UNKNOWN'
export type ContentType   = 'live' | 'movie' | 'series' | 'show' | 'standup'
export type DubType       = 'D' | 'L' | null   // D=dublado, L=legendado

export const QUALITY_ORDER: StreamQuality[] = ['4K', 'FHD', 'HD', 'SD', 'UNKNOWN']

export interface Stream {
  u: string            // URL primária
  q: string            // qualidade: '4K'|'FHD'|'HD'|'SD'|'UNKNOWN' (live/movie) ou 'S01E001' (série)
  dubType?: DubType    // filmes: 'D'=dublado, 'L'=legendado (null = não informado)
  fallback?: string[]  // URLs alternativas (failover de servidor)
  h265?: boolean       // live: codec H265 — tentar por último
}

export interface Channel {
  name: string
  contentType: ContentType
  streaming: string | null
  genre: string | null
  genres: string[]
  dubType: DubType
  logo: string | null
  group: string | null
  streams: Stream[]
  seasons?: Record<string, Record<string, { dub?: string; leg?: string }>>
}

export interface RawChannel {
  name: string
  url: string
  group: string | null
  logo: string | null
}

// ─── Streamings conhecidos ────────────────────────────────────────────────────

const STREAMING_MAP: [RegExp, string][] = [
  [/globoplay/i,                'globoplay'],
  [/\bglobo\b/i,                'globo'],
  [/amazon|prime/i,             'amazon'],
  [/\bhbo\b/i,                  'hbo'],
  [/\bmax\b/i,                  'hbo'],
  [/disney\+?/i,                'disney'],
  [/netflix/i,                  'netflix'],
  [/paramount/i,                'paramount'],
  [/apple/i,                    'apple'],
  [/star\s*\+?|star\s*plus/i,   'star'],
  [/telecine/i,                 'telecine'],
  [/crunchyroll/i,              'crunchyroll'],
  [/funimation/i,               'funimation'],
  [/pluto/i,                    'pluto'],
  [/discovery/i,                'discovery'],
  [/history.*play|history\+/i,  'history'],
  [/lionsgate/i,                'lionsgate'],
  [/universal/i,                'universal'],
  [/\bamc\b/i,                  'amc'],
  [/claro/i,                    'claro'],
  [/mercado.*play/i,            'mercado'],
  [/oldflix/i,                  'oldflix'],
  [/\blooke\b/i,                'looke'],
  [/oi.*play|play.*oi/i,        'oi'],
  [/play.*plus|playplus/i,      'playplus'],
  [/brasil.*paralelo/i,         'brasilparalelo'],
  [/\buniver\b/i,               'univer'],
  [/curtaon/i,                  'curtaon'],
  [/curiosity/i,                'curiosity'],
  [/\bsbt\b/i,                  'sbt'],
  [/record/i,                   'record'],
  [/\bband\b/i,                 'band'],
  [/\bkids\b|infantil/i,        'kids'],
]

// ─── Mapa canônico group-title → streaming (cobre 5 provedores) ──────────────

function normalizeGroupKey(raw: string): string {
  return raw.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
}

const GROUP_TO_STREAMING: Record<string, string> = {
  // Netflix
  'seriesnetflix': 'netflix', 'seriesnettflix': 'netflix', 'seriesnetflixdub': 'netflix',
  'seriesnetflixleg': 'netflix', 'filmesnetflix': 'netflix',
  // HBO/Max
  'serieshbomax': 'hbo', 'serieshbo': 'hbo', 'seriesmax': 'hbo',
  'serieshbomaxdub': 'hbo', 'filmeshbo': 'hbo', 'filmesmax': 'hbo',
  // Disney+
  'seriesdisney': 'disney', 'seriesdisneyplu': 'disney', 'seriesdisneypls': 'disney',
  'seriesdisneyplusdub': 'disney', 'filmesdisney': 'disney',
  // Amazon
  'seriesamazonprimevideo': 'amazon', 'seriesprimevideo': 'amazon',
  'seriesamazon': 'amazon', 'primevideo': 'amazon', 'filmesprimevideo': 'amazon',
  // Globoplay
  'seriesgloboplay': 'globoplay', 'globoplay': 'globoplay', 'filmesgloboplay': 'globoplay',
  // Paramount+
  'seriesparamountplus': 'paramount', 'seriesparamount': 'paramount', 'filmesparamount': 'paramount',
  // Apple TV+
  'seriesappletv': 'apple', 'seriesappletvplus': 'apple', 'appletv': 'apple',
  'seriesapple': 'apple', 'filmesappletv': 'apple',
  // Star+
  'seriesstarplus': 'star', 'seriesstar': 'star', 'starplus': 'star', 'filmesstar': 'star',
  // Discovery+
  'seriesdiscoveryplus': 'discovery', 'seriesdiscovery': 'discovery',
  // Crunchyroll/Animes
  'seriescrunchyroll': 'crunchyroll', 'crunchyroll': 'crunchyroll',
  'seriesanimes': 'crunchyroll', 'animes': 'crunchyroll',
  // Telecine
  'filmestelecine': 'telecine', 'telecine': 'telecine',
  // Novelas
  'seriesnovelas': 'novelas', 'novelas': 'novelas', 'novela': 'novelas',
  // Kids
  'seriesdesenhos': 'kids', 'serieskids': 'kids', 'desenho': 'kids',
  // Starz/DirectTV
  'seriesstarzplay': 'starz', 'seriesdirectv': 'directv', 'seriesdirec': 'directv',
  // Séries genéricas
  'serieslegendadas': 'series_leg', 'serieslegendados': 'series_leg',
  'seriesdiversos': 'series_outros', 'seriesoutras': 'series_outros',
  // Filmes por gênero
  'filmesacao': 'filmes_acao', 'filmesdrama': 'filmes_drama',
  'filmescomedia': 'filmes_comedia', 'filmesterror': 'filmes_terror',
  'filmessuspense': 'filmes_suspense', 'filmescrime': 'filmes_crime', 'filmescrimes': 'filmes_crime',
  'filmes4k': 'filmes_4k', 'filmes4kuhd': 'filmes_4k',
  'filmeslegendados': 'filmes_leg', 'filmesnacionais': 'filmes_nacionais',
  'filmeslancamentos': 'filmes_lancamentos', 'filmesficcaocientifica': 'filmes_ficcao',
  'filmesmarveledc': 'filmes_marvel', 'filmesmarvel': 'filmes_marvel',
  'filmesanimacao': 'filmes_animacao', 'filmesanimacaoefamilia': 'filmes_animacao',
  'filmesaventura': 'filmes_aventura', 'filmesromance': 'filmes_romance',
  'filmesdocumentarios': 'filmes_doc', 'documentarios': 'filmes_doc',
  'filmesclassicos': 'filmes_classicos', 'filmesinfantis': 'filmes_kids',
  // Canais ao vivo
  'canaisglobo': 'canais_globo', 'canaisesportes': 'canais_esportes',
  'canaispremiere': 'canais_esportes', 'canaisespn': 'canais_esportes',
  'canaissportv': 'canais_esportes', 'canaishbo': 'canais_hbo', 'canaismax': 'canais_hbo',
  'canaissbt': 'canais_sbt', 'canaisrecord': 'canais_record',
  'canaisband': 'canais_band', 'canaisabertos': 'canais_abertos',
  'canaisnoticias': 'canais_noticias', 'canaisinfantis': 'canais_kids',
  'canaisreligiosos': 'canais_religiosos', 'canaisvariedades': 'canais_variedades',
  'canais4k': 'canais_4k',
}

function getStreamingFromGroup(groupTitle: string): string | null {
  const key = normalizeGroupKey(groupTitle)
  if (GROUP_TO_STREAMING[key]) return GROUP_TO_STREAMING[key]
  return normalizeStreaming(groupTitle)
}

// ─── Detectar dub/leg pelo nome e group-title ─────────────────────────────────

export function getVersion(name: string, groupTitle: string): DubType {
  const n = name.toLowerCase()
  const g = (groupTitle || '').toLowerCase()
  if (n.includes('[l]') || n.includes('leg') || g.includes('legend') || g.includes('leg')) return 'L'
  return 'D'
}

// ─── Parse série: extrai título + temporada + episódio ────────────────────────

const EP_REGEX = /^(.+?)\s+S(\d{1,2})E(\d{1,4})/i

export function parseSeriesEntry(name: string) {
  const match = name.match(EP_REGEX)
  if (!match) return null
  return {
    seriesTitle: match[1].trim(),
    season: parseInt(match[2]),
    episode: parseInt(match[3]),
  }
}


export function normalizeStreaming(raw: string): string | null {
  for (const [re, name] of STREAMING_MAP) {
    if (re.test(raw)) return name
  }
  return null
}

// ─── Gêneros de filme ─────────────────────────────────────────────────────────

const GENRE_MAP: [RegExp, string][] = [
  [/a[çc][aã]o|action/i,           'acao'],
  [/\bdrama\b/i,                    'drama'],
  [/suspense|thriller/i,            'suspense'],
  [/come[dt]/i,                     'comedia'],
  [/terror|horror/i,                'terror'],
  [/\bcrime\b/i,                    'crime'],
  [/romance/i,                      'romance'],
  [/marvel|dc\b|super.?her/i,       'super-heroi'],
  [/fam[ií]li/i,                    'familia'],
  [/fic[çc][aã]o|sci.?fi|scifi/i,  'ficcao'],
  [/document[aá]/i,                 'documentario'],
  [/\banime\b/i,                    'anime'],
  [/kids?|infantil/i,               'infantil'],
  [/nacion/i,                       'nacional'],
  [/cl[aá]ssic/i,                   'classico'],
  [/western|faroest/i,              'western'],
  [/guerr/i,                        'guerra'],
  [/aventur/i,                      'aventura'],
  [/mist[eé]ri/i,                   'misterio'],
  [/music/i,                        'musical'],
  [/anima[çc]/i,                    'animacao'],
  [/lan[çc]/i,                      'lancamentos'],
  [/biograf/i,                      'biografia'],
  [/hist[oó]ri/i,                   'historia'],
  [/natalin/i,                      'natalino'],
  [/fantas/i,                       'fantasia'],
  [/religi/i,                       'religioso'],
]

export function normalizeGenre(raw: string): string {
  for (const [re, name] of GENRE_MAP) {
    if (re.test(raw)) return name
  }
  return raw.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

// ─── Informações extraídas do group-title ─────────────────────────────────────

interface GroupInfo {
  contentType: ContentType
  streaming: string | null
  genre: string | null
  dubType: DubType
  quality: StreamQuality   // '4K' para "Filmes | 4K", 'UNKNOWN' para o resto
  discard: boolean
}

const BASE_GROUP: GroupInfo = {
  contentType: 'movie', streaming: null, genre: null,
  dubType: null, quality: 'UNKNOWN', discard: false,
}

export function extractGroupInfo(group: string | null): GroupInfo {
  if (!group) return BASE_GROUP

  const g = group.trim()

  // ── DESCARTAR ─────────────────────────────────────────────────────────────
  if (/suporte.?core|suport.*core|\btest(e)?\b|\bdummy\b|\bsample\b/i.test(g)) {
    return { ...BASE_GROUP, discard: true }
  }

  // ── STAND UP E SHOWS ──────────────────────────────────────────────────────
  if (/stand.?up/i.test(g)) return { ...BASE_GROUP, contentType: 'standup', genre: 'standup' }
  if (/^shows?\s*$/i.test(g)) return { ...BASE_GROUP, contentType: 'show' }

  // ── LIVE TV ───────────────────────────────────────────────────────────────
  // Detecta "Canais | Globo", "TV Aberta", "Noticias", "Ao Vivo", etc
  if (/canais?|tv(s|\b)|abert[ao]s?|\baovivo\b|ao.?vivo|jornal|esportes?/i.test(g)) {
    return { ...BASE_GROUP, contentType: 'live' }
  }

  // ── SÉRIES ────────────────────────────────────────────────────────────────
  // Detecta "Series | Netflix", "Séries Dubladas", "Netflix Séries", "Seriados"
  if (/s[eé]riad|s[eé]ries?/i.test(g)) {
    const suffix = g.replace(/s[eé]riad[oa]s?|s[eé]ries?/ig, '').replace(/^[|\/\s:\-]+|[|\/\s:\-]+$/g, '')
    if (/legend/i.test(g)) return { ...BASE_GROUP, contentType: 'series', dubType: 'L' }
    if (/dubl/i.test(g))   return { ...BASE_GROUP, contentType: 'series', dubType: 'D' }
    const streaming = getStreamingFromGroup(g) || normalizeStreaming(suffix)
    return { ...BASE_GROUP, contentType: 'series', streaming }
  }

  // ── FILMES (FALLBACK PARA VOD E EXPLICITOS) ───────────────────────────────
  if (/filmes?|cinema|lan[çc]amentos?|cine/i.test(g)) {
    const suffix = g.replace(/filmes?|cinema|lan[çc]amentos?|cine/ig, '').replace(/^[|\/\s:\-]+|[|\/\s:\-]+$/g, '')

    if (/legend/i.test(g)) return { ...BASE_GROUP, contentType: 'movie', dubType: 'L' }
    if (/\b4k\b/i.test(g)) return { ...BASE_GROUP, contentType: 'movie', dubType: 'D', quality: '4K' }
    if (/dubl/i.test(g)) return { ...BASE_GROUP, contentType: 'movie', dubType: 'D', genre: normalizeGenre(suffix) }
    
    return { ...BASE_GROUP, contentType: 'movie', dubType: 'D', genre: normalizeGenre(suffix) }
  }

  return BASE_GROUP
}

// ─── Detecção de qualidade ────────────────────────────────────────────────────

export function detectQuality(name: string): StreamQuality {
  const n = name.toUpperCase()
  if (/\b4K\b|\bUHD\b|\b2160P?\b/.test(n))            return '4K'
  if (/\bFHD\b|\bFULL[\s.-]?HD\b|\b1080P?\b/.test(n)) return 'FHD'
  if (/\bHD\b|\b720P?\b/.test(n))                      return 'HD'
  if (/\bSD\b|\b480P?\b|\b360P?\b/.test(n))            return 'SD'
  return 'UNKNOWN'
}

function detectH265(name: string): boolean {
  return /\bH\.?265\b|\bHEVC\b/i.test(name)
}

// ─── Limpeza de nome ──────────────────────────────────────────────────────────

export function cleanChannelName(raw: string): string {
  return raw
    .replace(/\|{2,}[^|]+\|{2,}/g, '')
    .replace(/\[[^\]]*\]/g, '')               // remove tudo em [...] → qualidade, codec, [L], [D]
    .replace(/\{[^}]*\}/g, '')
    .replace(/\([^)]*\)/g, '')                // remove (2011), (US), etc.
    .replace(/\b(4K|UHD|2160[Pp]?|FHD|FULL[\s.-]?HD|1080[Pp]?|HD|720[Pp]?|SD|480[Pp]?|360[Pp]?|H\.?265|H\.?264|HEVC|AVC|HDR|SDR|VOD|LEG|DUB|DUBLADO|LEGENDADO|NACIONAL|ORIGINAL|PT-BR|BR|VIP|PREMIUM|PLUS|PACK)\b/gi, '')
    // Remove prefixos numéricos "042 - " ou "CH 124 ", preservando números que fazem parte do nome
    .replace(/^\s*(?:CH|CANAL|TV)?\s*\d{1,4}\s*[-|.:_]\s*/gi, '')
    .replace(/\b(19|20)\d{2}\b/g, '')
    .replace(/\b(S|T|EP|PARTE|PART|VOL)\s*\d+\b/gi, '')
    .replace(/[|_.\-–—:]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase())
}

// ─── Extração de episódio ─────────────────────────────────────────────────────

export function extractEpisode(name: string): { cleanName: string; episode: string | null } {
  // Detecta SxxExx, TxxExx ou EPxx em qualquer posição, permitindo espaços
  const epMatch = name.match(/\s+(?:S\s*(\d{1,2})\s*E\s*(\d{1,4})|T\s*(\d{1,2})\s*E\s*(\d{1,4})|EP?\s*(\d{1,4}))(?:\s|$)/i)
  if (epMatch) {
    const idx = epMatch.index!
    const cleanName = (name.slice(0, idx) + name.slice(idx + epMatch[0].length)).trim()
    if (epMatch[1] && epMatch[2]) return { cleanName, episode: `S${epMatch[1].padStart(2,'0')}E${epMatch[2].padStart(3,'0')}` }
    if (epMatch[3] && epMatch[4]) return { cleanName, episode: `S${epMatch[3].padStart(2,'0')}E${epMatch[4].padStart(3,'0')}` }
    return { cleanName, episode: `EP${epMatch[5]!.padStart(3,'0')}` }
  }
  return { cleanName: name, episode: null }
}

// ─── Slugify ──────────────────────────────────────────────────────────────────

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

// ─── normalizeStreams — coração do processamento ───────────────────────────────

export function normalizeStreams(rawChannels: RawChannel[]): Channel[] {
  // Dedup por URL exata antes de tudo
  const seenUrls = new Set<string>()
  const deduped = rawChannels.filter(c => {
    if (seenUrls.has(c.url)) return false
    seenUrls.add(c.url)
    return true
  })
  console.log(`[M3U] ${rawChannels.length} entradas → ${deduped.length} após dedup de URL`)

  const map = new Map<string, Channel>()

  const addFallback = (stream: Stream, url: string) => {
    if (stream.u === url) return
    if (!(stream.fallback || []).includes(url)) {
      stream.fallback = [...(stream.fallback || []), url]
    }
  }

  for (const raw of deduped) {
    const gi = extractGroupInfo(raw.group)
    if (gi.discard) continue

    // ── LIVE TV ───────────────────────────────────────────────────────────────
    if (gi.contentType === 'live') {
      const cleanName = cleanChannelName(raw.name)
      if (!cleanName || cleanName.length < 2) continue

      const key = slugify(cleanName)
      const quality = detectQuality(raw.name)
      const h265 = detectH265(raw.name) || undefined

      if (map.has(key)) {
        const ch = map.get(key)!
        const existing = ch.streams.find(s => s.q === quality && !!s.h265 === !!h265)
        if (existing) {
          addFallback(existing, raw.url)
        } else {
          ch.streams.push({ u: raw.url, q: quality, h265 })
        }
        if (!ch.logo && raw.logo) ch.logo = raw.logo
      } else {
        map.set(key, {
          name: cleanName, contentType: 'live',
          streaming: null, genre: null, genres: [], dubType: null,
          logo: raw.logo || null, group: raw.group,
          streams: [{ u: raw.url, q: quality, h265 }],
        })
      }

    // ── FILMES ────────────────────────────────────────────────────────────────
    } else if (gi.contentType === 'movie') {
      const cleanName = cleanChannelName(raw.name)
      if (!cleanName || cleanName.length < 2) continue

      const key = slugify(cleanName)
      // Qualidade: do grupo ("Filmes | 4K" → '4K') ou detecta do nome
      const quality: StreamQuality = gi.quality !== 'UNKNOWN' ? gi.quality : detectQuality(raw.name)

      if (map.has(key)) {
        const ch = map.get(key)!
        // Procura stream com mesma qualidade + dubType exata → adiciona como fallback
        const existing = ch.streams.find(s => s.q === quality && s.dubType === gi.dubType)
        if (existing) {
          addFallback(existing, raw.url)
        } else {
          // Nova combinação qualidade/dubType → nova stream
          ch.streams.push({ u: raw.url, q: quality, dubType: gi.dubType })
        }
        // Merge gênero
        if (gi.genre && !ch.genres.includes(gi.genre)) {
          ch.genres.push(gi.genre)
          if (!ch.genre) ch.genre = gi.genre
        }
        if (!ch.logo && raw.logo) ch.logo = raw.logo
      } else {
        map.set(key, {
          name: cleanName, contentType: 'movie',
          streaming: null, genre: gi.genre, genres: gi.genre ? [gi.genre] : [],
          dubType: gi.dubType, logo: raw.logo || null, group: raw.group,
          streams: [{ u: raw.url, q: quality, dubType: gi.dubType }],
        })
      }

    // ── SÉRIES ────────────────────────────────────────────────────────────────
    } else if (gi.contentType === 'series') {
      // Tenta parseSeriesEntry primeiro (mais preciso)
      const parsed = parseSeriesEntry(raw.name)
      let baseName: string
      let episode: string | null
      let season: number | null = null
      let epNum: number | null = null

      if (parsed) {
        baseName = parsed.seriesTitle
        season = parsed.season
        epNum = parsed.episode
        episode = `S${String(parsed.season).padStart(2,'0')}E${String(parsed.episode).padStart(3,'0')}`
      } else {
        const extracted = extractEpisode(raw.name)
        baseName = extracted.cleanName
        episode = extracted.episode
      }

      if (!episode) {
        // Fallback para não dropar: tenta achar número solto no final, senão EP001
        const lastNum = raw.name.match(/\s+(0*\d{1,3})(?:\s|$)/)
        if (lastNum) {
          episode = `EP${lastNum[1].padStart(3, '0')}`
          baseName = raw.name.slice(0, lastNum.index).trim()
        } else {
          episode = 'EP001'
        }
      }

      const cleanName = cleanChannelName(baseName)
      if (!cleanName || cleanName.length < 2) continue

      const dubType = getVersion(raw.name, raw.group || '')
      const streaming = getStreamingFromGroup(raw.group || '') || gi.streaming
      const titleSlug = slugify(cleanName)
      const key = streaming ? `${streaming}:${titleSlug}` : `${dubType}:${titleSlug}`

      if (map.has(key)) {
        const ch = map.get(key)!
        // Popular seasons
        if (season !== null && epNum !== null) {
          if (!ch.seasons) ch.seasons = {}
          if (!ch.seasons[season]) ch.seasons[season] = {}
          const epKey = String(epNum)
          if (!ch.seasons[season][epKey]) ch.seasons[season][epKey] = {}
          if (dubType === 'L') {
            if (!ch.seasons[season][epKey].leg) ch.seasons[season][epKey].leg = raw.url
          } else {
            if (!ch.seasons[season][epKey].dub) ch.seasons[season][epKey].dub = raw.url
          }
        }
        const existingEp = ch.streams.find(s => s.q === episode && s.dubType === dubType)
        if (existingEp) {
          addFallback(existingEp, raw.url)
        } else {
          ch.streams.push({ u: raw.url, q: episode!, dubType })
        }
        if (!ch.logo && raw.logo) ch.logo = raw.logo
        if (streaming && !ch.streaming) ch.streaming = streaming
      } else {
        const seasons: Channel['seasons'] = {}
        if (season !== null && epNum !== null) {
          seasons[season] = { [String(epNum)]: dubType === 'L' ? { leg: raw.url } : { dub: raw.url } }
        }
        map.set(key, {
          name: cleanName, contentType: 'series',
          streaming: streaming || gi.streaming, genre: null, genres: [],
          dubType, logo: raw.logo || null, group: raw.group,
          streams: [{ u: raw.url, q: episode!, dubType }],
          seasons,
        })
      }

    // ── SHOWS / STANDUP ───────────────────────────────────────────────────────
    } else {
      const cleanName = cleanChannelName(raw.name)
      if (!cleanName || cleanName.length < 2) continue

      const key = `${gi.contentType}:${slugify(cleanName)}`

      if (map.has(key)) {
        const ch = map.get(key)!
        if (ch.streams.length > 0) addFallback(ch.streams[0], raw.url)
        if (!ch.logo && raw.logo) ch.logo = raw.logo
      } else {
        map.set(key, {
          name: cleanName, contentType: gi.contentType,
          streaming: null, genre: gi.genre, genres: gi.genre ? [gi.genre] : [],
          dubType: null, logo: raw.logo || null, group: raw.group,
          streams: [{ u: raw.url, q: 'UNKNOWN' }],
        })
      }
    }
  }

  // ── Ordena streams de cada canal ───────────────────────────────────────────
  for (const ch of map.values()) {
    if (ch.contentType === 'live') {
      // 4K > FHD > HD > SD; dentro do mesmo tier: não-H265 antes de H265
      ch.streams.sort((a, b) => {
        const qa = QUALITY_ORDER.indexOf(a.q as StreamQuality)
        const qb = QUALITY_ORDER.indexOf(b.q as StreamQuality)
        if (qa !== qb) return qa - qb
        return (a.h265 ? 1 : 0) - (b.h265 ? 1 : 0)
      })
    } else if (ch.contentType === 'movie') {
      // 4K primeiro, depois FHD/HD/UNKNOWN; dentro do mesmo tier: D antes de L
      ch.streams.sort((a, b) => {
        const qa = QUALITY_ORDER.indexOf(a.q as StreamQuality)
        const qb = QUALITY_ORDER.indexOf(b.q as StreamQuality)
        if (qa !== qb) return qa - qb
        const da = a.dubType === 'D' ? 0 : 1
        const db = b.dubType === 'D' ? 0 : 1
        return da - db
      })
    } else if (ch.contentType === 'series') {
      // Episódios em ordem cronológica: S01E001 → S08E012
      ch.streams.sort((a, b) => a.q.localeCompare(b.q))
    }
  }

  const result = [...map.values()]
  console.log(`[M3U] ${deduped.length} entradas → ${result.length} canais únicos`)
  return result
}

// ─── CatalogIndex — índice invertido construído 1x para lookups O(1) ─────────
// Uso recomendado no Worker: buildCatalogIndex(catalog) antes do loop de matching,
// depois lookupChannel(name, streaming, index) em cada canal.

interface IndexEntry { id: string; streaming: string | null }

export interface CatalogIndex {
  bySlug: Map<string, IndexEntry>   // slug principal → entry
  byAlt:  Map<string, IndexEntry>   // slug de alt_titles → entry
  byHint: Map<string, IndexEntry>   // slug de match_hints (≥6 chars) → entry
  raw:    any[]                     // catálogo original (usado só no token-match de fallback)
}

export function buildCatalogIndex(catalog: any[]): CatalogIndex {
  const bySlug = new Map<string, IndexEntry>()
  const byAlt  = new Map<string, IndexEntry>()
  const byHint = new Map<string, IndexEntry>()

  for (const c of catalog) {
    const entry: IndexEntry = { id: c.id, streaming: c.streaming || null }
    const s = slugify(c.title)
    if (!bySlug.has(s)) bySlug.set(s, entry)

    for (const alt of c.alt_titles || []) {
      const as = slugify(alt)
      if (!bySlug.has(as) && !byAlt.has(as)) byAlt.set(as, entry)
    }

    for (const hint of c.match_hints || []) {
      if (hint.length >= 6) {
        const hs = slugify(hint)
        if (!bySlug.has(hs) && !byAlt.has(hs) && !byHint.has(hs)) byHint.set(hs, entry)
      }
    }
  }

  return { bySlug, byAlt, byHint, raw: catalog }
}

function entryMatchesStreaming(entry: IndexEntry, streaming: string | null): boolean {
  if (!streaming) return true
  return !entry.streaming || entry.streaming === streaming
}

// lookupChannel — O(1) para slug/alt/hint, O(catalog) só no token-match de último recurso
export function lookupChannel(name: string, streaming: string | null, index: CatalogIndex): string | null {
  const baseSlug = slugify(name)

  // 1. Slug exato
  const e1 = index.bySlug.get(baseSlug)
  if (e1 && entryMatchesStreaming(e1, streaming)) return e1.id

  // 2. Alt titles
  const e2 = index.byAlt.get(baseSlug)
  if (e2 && entryMatchesStreaming(e2, streaming)) return e2.id

  // 3. Hints
  const e3 = index.byHint.get(baseSlug)
  if (e3 && entryMatchesStreaming(e3, streaming)) return e3.id

  // 4. Token match — fallback para títulos com palavras na ordem diferente
  //    Ex: "Os Vingadores" ↔ "Vingadores Os" ou parciais
  const normTokens = baseSlug.split('-').filter(t => t.length >= 3)
  if (normTokens.length >= 2) {
    const pool = streaming
      ? index.raw.filter(c => !c.streaming || c.streaming === streaming)
      : index.raw

    for (const c of pool) {
      const cTokens = slugify(c.title).split('-').filter(t => t.length >= 3)
      if (cTokens.length >= 2 && cTokens.every(t => normTokens.includes(t))) return c.id
    }
    for (const c of pool) {
      for (const alt of c.alt_titles || []) {
        const aTokens = slugify(alt).split('-').filter(t => t.length >= 3)
        if (aTokens.length >= 2 && aTokens.every(t => normTokens.includes(t))) return c.id
      }
    }
  }

  // 5. Retry sem filtro de streaming (catálogo incompleto para aquele streaming)
  if (streaming) {
    const ef = index.bySlug.get(baseSlug) ?? index.byAlt.get(baseSlug) ?? index.byHint.get(baseSlug)
    if (ef) return ef.id
  }

  return null
}

// ─── matchChannel — compatibilidade retroativa (TV app / catalogMatcher.ts) ──
// Para uso em loops hot, prefira buildCatalogIndex + lookupChannel.
export function matchChannel(
  name: string,
  streaming: string | null,
  catalog: any[]
): string | null {
  const idx = buildCatalogIndex(catalog)
  return lookupChannel(name, streaming, idx)
}
