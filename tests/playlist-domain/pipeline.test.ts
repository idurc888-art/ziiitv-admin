import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { adaptXtreamCatalog, classifyEntry, ingestM3u, matchPlaylistItem, normalizeEntries, parseM3u, parseM3uStream, parseTitle, type CanonicalCatalogEntry, type RawPlaylistEntry } from '../../src/domain/playlist/index'

function raw(overrides: Partial<RawPlaylistEntry>): RawPlaylistEntry {
  return {
    id: 'test:0', source: 'm3u', order: 0, rawName: 'Item', url: 'https://example.test/item.ts',
    groupTitle: null, tvgId: null, tvgName: null, logoUrl: null, attributes: {}, sourceType: null,
    externalId: null, categoryId: null, tmdbId: null, ...overrides,
  }
}

const catalog: CanonicalCatalogEntry[] = [
  { id: 'filme-moana', title: 'Moana', type: 'movie', year: 2016, tmdbId: 277834, altTitles: [], matchHints: [] },
  { id: 'filme-moana-2', title: 'Moana 2', type: 'movie', year: 2024, tmdbId: 1241982, altTitles: [], matchHints: [] },
  { id: 'filme-it-1990', title: 'It', type: 'movie', year: 1990, tmdbId: 19614, altTitles: [], matchHints: [] },
  { id: 'filme-it-2017', title: 'It', type: 'movie', year: 2017, tmdbId: 346364, altTitles: [], matchHints: [] },
  { id: 'serie-the-boys', title: 'The Boys', type: 'series', year: 2019, tmdbId: 76479, altTitles: [], matchHints: [] },
  { id: 'filme-the-boys-in-the-band', title: 'The Boys in the Band', type: 'movie', year: 2020, tmdbId: 617708, altTitles: [], matchHints: [] },
]

test('preserva números legítimos de sequências e títulos', () => {
  assert.equal(parseTitle('Moana 2 [FHD]').displayTitle, 'Moana 2')
  assert.equal(parseTitle('Blade Runner 2049 4K').displayTitle, 'Blade Runner 2049')
})

test('separa ano de remake sem colidir identidades', () => {
  const entries = [
    raw({ id: 'a', rawName: 'It (1990)', url: 'https://example.test/a.mp4', groupTitle: 'Filmes' }),
    raw({ id: 'b', rawName: 'It (2017)', url: 'https://example.test/b.mp4', groupTitle: 'Filmes' }),
  ]
  const result = normalizeEntries(entries)
  assert.equal(result.items.length, 2)
  assert.deepEqual(result.items.map((item) => item.year), [1990, 2017])
})

test('não infere plataforma pela palavra Star no título', () => {
  const result = normalizeEntries([raw({ rawName: 'Star Wars', groupTitle: 'Filmes | Ficção' })])
  assert.equal(result.items[0].platform, null)
})

test('mantém grupo desconhecido como unknown', () => {
  const entry = raw({ rawName: 'Conteúdo sem pista', groupTitle: 'Diversos' })
  assert.equal(classifyEntry(entry).contentType, 'unknown')
})

test('classificação não depende da ordem das entradas', () => {
  const series = raw({ id: 's', rawName: 'Minha Série S01E01', url: 'https://example.test/s.mp4' })
  const unknown = raw({ id: 'u', rawName: 'Outro conteúdo', url: 'https://example.test/u.mp4' })
  assert.equal(normalizeEntries([series, unknown]).items.find((item) => item.rawEntryIds.includes('u'))?.contentType, 'unknown')
  assert.equal(normalizeEntries([unknown, series]).items.find((item) => item.rawEntryIds.includes('u'))?.contentType, 'unknown')
})

test('mantém relação entre episódio e URL', () => {
  const entries = [
    raw({ id: 'e1', rawName: 'The Show S01E01 DUB', url: 'https://example.test/e1.mp4', groupTitle: 'Séries' }),
    raw({ id: 'e2', rawName: 'The Show S01E02 LEG', url: 'https://example.test/e2.mp4', groupTitle: 'Séries' }),
  ]
  const item = normalizeEntries(entries).items[0]
  assert.equal(item.variants.length, 2)
  assert.deepEqual(item.variants.map(({ season, episode, url }) => ({ season, episode, url })), [
    { season: 1, episode: 1, url: 'https://example.test/e1.mp4' },
    { season: 1, episode: 2, url: 'https://example.test/e2.mp4' },
  ])
})

test('agrupa variantes live pelo tvg-id sem apagar o número do canal', () => {
  const entries = [
    raw({ id: 'l1', rawName: 'Premiere 2 HD', tvgId: 'premiere-2', url: 'https://example.test/hd.ts', groupTitle: 'Canais | Esportes' }),
    raw({ id: 'l2', rawName: 'Premiere 2 FHD', tvgId: 'premiere-2', url: 'https://example.test/fhd.ts', groupTitle: 'Canais | Esportes' }),
  ]
  const result = normalizeEntries(entries)
  assert.equal(result.items.length, 1)
  assert.equal(result.items[0].displayTitle, 'Premiere 2')
  assert.equal(result.items[0].variants.length, 2)
})

test('parser preserva atributos e relata entradas órfãs', () => {
  const parsed = parseM3u(`#EXTM3U\nhttps://example.test/orphan.ts\n#EXTINF:-1 tvg-id="globo-sp" tvg-name="Globo SP" group-title="Canais | Abertos",Globo, SP HD\nhttps://example.test/globo.ts`)
  assert.equal(parsed.entries.length, 1)
  assert.equal(parsed.entries[0].rawName, 'Globo, SP HD')
  assert.equal(parsed.entries[0].tvgName, 'Globo SP')
  assert.equal(parsed.issues[0].code, 'orphan_url')
})

test('arquivo M3U produz métricas sem descartar unmatched', () => {
  const result = ingestM3u(`#EXTM3U\n#EXTINF:-1 group-title="Diversos",Obra Desconhecida\nhttps://example.test/unknown.mp4`)
  assert.equal(result.normalized.metrics.raw, 1)
  assert.equal(result.normalized.metrics.output, 1)
  assert.equal(result.normalized.metrics.unknown, 1)
})

test('tipo Xtream explícito vence heurística de grupo', () => {
  const entry = raw({ source: 'xtream', sourceType: 'movie', groupTitle: 'Canais Diversos', rawName: 'Filme X' })
  const classified = classifyEntry(entry)
  assert.equal(classified.contentType, 'movie')
  assert.equal(classified.confidence, 1)
})

test('parser incremental preserva linhas divididas entre chunks', async () => {
  async function* chunks() {
    yield '#EXTM3U\n#EXTINF:-1 tvg-id="canal-1" group-title="Canais | Abertos",Can'
    yield new TextEncoder().encode('al 1 FHD\r\nhttps://example.test/live/1.ts\n')
  }
  const parsed = await parseM3uStream(chunks())
  assert.equal(parsed.entries.length, 1)
  assert.equal(parsed.entries[0].rawName, 'Canal 1 FHD')
  assert.equal(parsed.entries[0].url, 'https://example.test/live/1.ts')
})

test('adaptador Xtream preserva tipo, categoria e ID autoritativos', () => {
  const entries = adaptXtreamCatalog({
    baseUrl: 'https://provider.example', username: 'user', password: 'pass',
    liveCategories: [{ category_id: '7', category_name: 'Esportes' }],
    vodCategories: [{ category_id: '7', category_name: 'Filmes' }],
    live: [{ stream_id: 10, name: 'Canal 10', category_id: 7 }],
    vod: [{ stream_id: 20, name: 'Moana 2', category_id: 7, tmdb_id: 1241982 }],
  })
  assert.equal(entries[0].sourceType, 'live')
  assert.equal(entries[0].groupTitle, 'Esportes')
  assert.equal(entries[1].sourceType, 'movie')
  assert.equal(entries[1].groupTitle, 'Filmes')
  assert.equal(entries[1].tmdbId, 1241982)
})

test('adaptador Xtream mantém episódio, URL e identidade externa relacionados', () => {
  const entries = adaptXtreamCatalog({
    baseUrl: 'https://provider.example', username: 'user', password: 'pass',
    seriesCategories: [{ category_id: '9', category_name: 'Séries | Netflix' }],
    series: [{
      series_id: 30, name: 'The Show', category_id: 9,
      episodes: { '1': [
        { id: 301, season: 1, episode_num: 1, container_extension: 'mkv' },
        { id: 302, season: 1, episode_num: 2, container_extension: 'mkv' },
      ] },
    }],
  })
  const normalized = normalizeEntries(entries)
  assert.equal(entries.length, 2)
  assert.equal(normalized.items.length, 1)
  assert.equal(normalized.items[0].variants.length, 2)
  assert.equal(entries[0].externalId, '30:301')
  assert.match(entries[0].url, /\/series\/user\/pass\/301\.mkv$/)
})

test('matching distingue sequência pelo número', () => {
  const item = normalizeEntries([raw({ rawName: 'Moana 2', groupTitle: 'Filmes', url: 'https://example.test/moana2.mp4' })]).items[0]
  const decision = matchPlaylistItem(item, catalog)
  assert.equal(decision.status, 'auto_matched')
  assert.equal(decision.candidateId, 'filme-moana-2')
})

test('matching usa ano para distinguir remakes', () => {
  const item = normalizeEntries([raw({ rawName: 'It (1990)', groupTitle: 'Filmes', url: 'https://example.test/it.mp4' })]).items[0]
  const decision = matchPlaylistItem(item, catalog)
  assert.equal(decision.status, 'auto_matched')
  assert.equal(decision.candidateId, 'filme-it-1990')
})

test('matching por TMDB ID tem prioridade máxima', () => {
  const item = normalizeEntries([raw({ rawName: 'Título do Provedor', groupTitle: 'Filmes', tmdbId: 1241982 })]).items[0]
  const decision = matchPlaylistItem(item, catalog)
  assert.equal(decision.status, 'auto_matched')
  assert.equal(decision.candidateId, 'filme-moana-2')
  assert.equal(decision.confidence, 1)
})

test('matching não confunde títulos parecidos e tipos diferentes', () => {
  const item = normalizeEntries([raw({ rawName: 'The Boys', groupTitle: 'Séries', url: 'https://example.test/the-boys.mp4' })]).items[0]
  const decision = matchPlaylistItem(item, catalog)
  assert.equal(decision.candidateId, 'serie-the-boys')
})

test('matching ambíguo sem ano vai para revisão em vez de auto-match', () => {
  const item = normalizeEntries([raw({ rawName: 'It', groupTitle: 'Filmes', url: 'https://example.test/it-unknown.mp4' })]).items[0]
  const decision = matchPlaylistItem(item, catalog)
  assert.notEqual(decision.status, 'auto_matched')
})

test('override manual auditável vence heurística', () => {
  const item = normalizeEntries([raw({ rawName: 'Moana II', groupTitle: 'Filmes', url: 'https://example.test/moana-ii.mp4' })]).items[0]
  const decision = matchPlaylistItem(item, catalog, { manualOverrides: new Map([[item.identityKey, 'filme-moana-2']]) })
  assert.equal(decision.status, 'manually_matched')
  assert.equal(decision.candidateId, 'filme-moana-2')
})

test('rejeição manual auditável impede rematch automático futuro', () => {
  const item = normalizeEntries([raw({ rawName: 'Moana 2', groupTitle: 'Filmes' })]).items[0]
  const decision = matchPlaylistItem(item, catalog, { manualRejections: new Set([item.identityKey]) })
  assert.equal(decision.status, 'rejected')
  assert.equal(decision.candidateId, null)
})

test('corpus misto preserva sequência, remake, episódios e rejeita URL perigosa', async () => {
  const content = await readFile(new URL('../fixtures/playlists/provider-mixed.m3u', import.meta.url), 'utf8')
  const parsed = parseM3u(content)
  const normalized = normalizeEntries(parsed.entries, parsed.issues)
  assert.equal(parsed.entries.length, 8)
  assert.equal(parsed.issues.filter(issue => issue.code === 'invalid_url').length, 1)
  assert.ok(normalized.items.some(item => item.displayTitle === 'Moana 2'))
  assert.ok(normalized.items.some(item => item.displayTitle === 'Blade Runner 2049' && item.year === null))
  assert.ok(normalized.items.some(item => item.displayTitle === 'Duna' && item.year === 2021))
  assert.equal(normalized.items.find(item => item.displayTitle === 'The Show')?.variants.length, 2)
  assert.equal(normalized.items.find(item => item.displayTitle === 'Catálogo sem tipo')?.contentType, 'unknown')
})

test('corpus malformado contabiliza órfã, ausência de URL e esquema inválido', async () => {
  const content = await readFile(new URL('../fixtures/playlists/malformed.m3u', import.meta.url), 'utf8')
  const parsed = parseM3u(content)
  assert.equal(parsed.entries.length, 1)
  assert.deepEqual(parsed.issues.map(issue => issue.code), ['orphan_url', 'missing_url', 'invalid_url'])
})

test('linha M3U sem limite é interrompida antes de consumir a fonte inteira', async () => {
  async function* oversized() { yield `#EXTINF:-1,${'A'.repeat(1024 * 1024 + 1)}` }
  await assert.rejects(parseM3uStream(oversized()), /m3u_line_too_long/)
})

test('parser streaming entrega lotes estáveis sem acumular entradas no resultado', async () => {
  const source = Array.from({ length: 1201 }, (_, index) =>
    `#EXTINF:-1 group-title="Canais",Canal ${index + 1}\nhttps://provider.example/live/${index + 1}.ts`
  ).join('\n')
  async function* chunks() {
    for (let offset = 0; offset < source.length; offset += 777) yield source.slice(offset, offset + 777)
  }
  const batches: RawPlaylistEntry[][] = []
  const parsed = await parseM3uStream(chunks(), { batchSize: 500, onEntries: entries => { batches.push(entries) } })
  assert.deepEqual(batches.map(batch => batch.length), [500, 500, 201])
  assert.equal(parsed.entries.length, 0)
  assert.equal(parsed.issueCount, 0)
  assert.equal(batches[0][0].id, 'm3u:0')
  assert.equal(batches[2][200].id, 'm3u:1200')
})

test('detalhes de parse são limitados sem perder a contagem total', () => {
  const parsed = parseM3u(Array.from({ length: 1200 }, (_, index) => `https://provider.example/orphan-${index}.ts`).join('\n'))
  assert.equal(parsed.issueCount, 1200)
  assert.equal(parsed.issues.length, 1000)
})
