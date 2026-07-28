import type { ParseIssue, ParseResult, RawPlaylistEntry } from './types'

const MAX_M3U_LINE_CHARS = 1024 * 1024
const MAX_REPORTED_ISSUES = 1000
const STREAM_PROTOCOLS = new Set(['http:', 'https:', 'rtmp:', 'rtsp:', 'udp:'])

function isAllowedStreamUrl(value: string): boolean {
  try {
    return STREAM_PROTOCOLS.has(new URL(value).protocol.toLowerCase())
  } catch {
    return false
  }
}

function parseAttributes(header: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  const pattern = /([\w-]+)=(?:"([^"]*)"|'([^']*)'|([^\s,]+))/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(header)) !== null) {
    attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? ''
  }
  return attributes
}

function integerOrNull(value: string | undefined): number | null {
  if (!value) return null
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function findNameSeparator(line: string): number {
  let quote: '"' | "'" | null = null
  for (let index = 0; index < line.length; index++) {
    const character = line[index]
    if ((character === '"' || character === "'") && (quote === null || quote === character)) {
      quote = quote === character ? null : character
      continue
    }
    if (character === ',' && quote === null) return index
  }
  return -1
}

export class M3uParser {
  private readonly entries: RawPlaylistEntry[] = []
  private readonly issues: ParseIssue[] = []
  private pending: Omit<RawPlaylistEntry, 'id' | 'order' | 'url'> | null = null
  private pendingLine = 0
  private lineNumber = 0
  private nextOrder = 0
  private issueCount = 0

  private recordIssue(issue: ParseIssue): void {
    this.issueCount++
    if (this.issues.length < MAX_REPORTED_ISSUES) this.issues.push(issue)
  }

  pushLine(input: string): void {
    this.lineNumber++
    if (input.length > MAX_M3U_LINE_CHARS) throw new Error('m3u_line_too_long')
    const line = input.replace(/^\uFEFF/, '').trim()
    if (!line) return

    if (line.startsWith('#EXTINF')) {
      if (this.pending) this.recordIssue({ line: this.pendingLine, code: 'missing_url' })
      const comma = findNameSeparator(line)
      const header = comma >= 0 ? line.slice(0, comma) : line
      const inlineName = comma >= 0 ? line.slice(comma + 1).trim() : ''
      const attributes = parseAttributes(header)
      const rawName = inlineName || attributes['tvg-name'] || ''
      if (!rawName) this.recordIssue({ line: this.lineNumber, code: 'missing_name' })
      this.pending = {
        source: 'm3u',
        rawName,
        groupTitle: attributes['group-title'] || null,
        tvgId: attributes['tvg-id'] || null,
        tvgName: attributes['tvg-name'] || null,
        logoUrl: attributes['tvg-logo'] || null,
        attributes,
        sourceType: null,
        externalId: null,
        categoryId: null,
        tmdbId: integerOrNull(attributes['tmdb-id']),
      }
      this.pendingLine = this.lineNumber
      return
    }

    if (line.startsWith('#')) return
    if (!this.pending) {
      this.recordIssue({ line: this.lineNumber, code: 'orphan_url' })
      return
    }
    if (!isAllowedStreamUrl(line)) {
      this.recordIssue({ line: this.lineNumber, code: 'invalid_url' })
      this.pending = null
      return
    }
    if (this.pending.rawName) {
      const order = this.nextOrder++
      this.entries.push({ ...this.pending, id: `m3u:${order}`, order, url: line })
    }
    this.pending = null
  }

  finish(): ParseResult {
    if (this.pending) {
      this.recordIssue({ line: this.pendingLine, code: 'missing_url' })
      this.pending = null
    }
    return { entries: this.drainEntries(), issues: this.issues, issueCount: this.issueCount }
  }

  bufferedEntryCount(): number {
    return this.entries.length
  }

  drainEntries(): RawPlaylistEntry[] {
    return this.entries.splice(0, this.entries.length)
  }
}

export function parseM3u(content: string): ParseResult {
  const parser = new M3uParser()
  for (const line of content.split(/\r?\n/)) parser.pushLine(line)
  return parser.finish()
}

export interface ParseM3uStreamOptions {
  batchSize?: number
  onEntries?: (entries: RawPlaylistEntry[]) => void | Promise<void>
}

export async function parseM3uStream(
  chunks: AsyncIterable<Uint8Array | string>,
  options: ParseM3uStreamOptions = {},
): Promise<ParseResult> {
  const parser = new M3uParser()
  const decoder = new TextDecoder()
  const batchSize = Math.max(1, options.batchSize ?? 500)
  let buffer = ''

  async function flushIfNeeded(force = false): Promise<void> {
    if (!options.onEntries) return
    if (!force && parser.bufferedEntryCount() < batchSize) return
    const entries = parser.drainEntries()
    if (entries.length > 0) await options.onEntries(entries)
  }

  for await (const chunk of chunks) {
    buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true })
    if (buffer.length > MAX_M3U_LINE_CHARS && !buffer.includes('\n')) throw new Error('m3u_line_too_long')
    let newline = buffer.indexOf('\n')
    while (newline >= 0) {
      parser.pushLine(buffer.slice(0, newline).replace(/\r$/, ''))
      await flushIfNeeded()
      buffer = buffer.slice(newline + 1)
      newline = buffer.indexOf('\n')
    }
  }
  buffer += decoder.decode()
  if (buffer) parser.pushLine(buffer.replace(/\r$/, ''))
  const result = parser.finish()
  if (options.onEntries && result.entries.length > 0) await options.onEntries(result.entries)
  return options.onEntries ? { ...result, entries: [] } : result
}
