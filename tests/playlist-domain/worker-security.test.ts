import assert from 'node:assert/strict'
import test from 'node:test'
import type { NormalizedPlaylistItem } from '../../src/domain/playlist/index'
import { assertPublicUrl, isPrivateAddress, itemPayloads, safeError } from '../../worker/playlist-import-worker'

test('bloqueia endereços privados, loopback, link-local e documentação', () => {
  for (const address of [
    '127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1', '169.254.1.1',
    '100.64.0.1', '192.0.2.1', '198.51.100.1', '203.0.113.1', '::1', 'fe80::1',
    'fd00::1', '2001:db8::1',
  ]) assert.equal(isPrivateAddress(address), true, address)

  assert.equal(isPrivateAddress('8.8.8.8'), false)
  assert.equal(isPrivateAddress('2606:4700:4700::1111'), false)
})

test('rejeita protocolos e credenciais embutidas antes da rede', async () => {
  await assert.rejects(assertPublicUrl('file:///etc/passwd'), /source_protocol_not_allowed/)
  await assert.rejects(assertPublicUrl('http://user:secret@example.com/list.m3u'), /source_url_credentials_not_allowed/)
  await assert.rejects(assertPublicUrl('http://localhost/list.m3u'), /source_host_not_allowed/)
})

test('remove credenciais Xtream dos erros persistidos', () => {
  const safe = safeError(new Error('fetch:https://provider.test/player_api.php?username=alice&password=secret'))
  assert.doesNotMatch(safe.message, /alice|secret/)
  assert.match(safe.message, /\[REDACTED\]/)

  const pathSafe = safeError(new Error('failed:https://provider.test/movie/alice/secret/10.mp4'))
  assert.doesNotMatch(pathSafe.message, /alice|secret/)
})

test('fragmenta variantes sem partir a identidade', () => {
  const item: NormalizedPlaylistItem = {
    identityKey: 'series:fixture', contentType: 'series', displayTitle: 'Fixture', matchTitle: 'Fixture',
    titleKey: 'fixture', year: null, groupTitle: 'Séries', tvgId: null, logoUrl: null, platform: null,
    tmdbId: null, classificationConfidence: 1, classificationEvidence: [], rawEntryIds: [],
    variants: Array.from({ length: 501 }, (_, index) => ({
      rawEntryId: `episode:${index + 1}`, url: `https://provider.test/series/${index + 1}.mkv`,
      quality: 'FHD' as const, audioVersion: 'original' as const, codec: null,
      season: 1, episode: index + 1,
    })),
  }
  const batches = itemPayloads([item])
  assert.deepEqual(batches.flat().map((fragment) => fragment.variants.length), [250, 250, 1])
  assert.ok(batches.flat().every((fragment) => fragment.identityKey === item.identityKey))
})
