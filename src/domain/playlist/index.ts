export * from './types'
export * from './text'
export * from './m3u'
export * from './classifier'
export * from './normalize'
export * from './xtream'
export * from './matcher'

import { parseM3u } from './m3u'
import { normalizeEntries } from './normalize'

export function ingestM3u(content: string) {
  const parsed = parseM3u(content)
  return { parsed, normalized: normalizeEntries(parsed.entries, parsed.issues) }
}
