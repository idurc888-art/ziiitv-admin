import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const migrationUrl = new URL('../../supabase/migrations/20260722000001_playlist_import_pipeline.sql', import.meta.url)
const sql = await readFile(migrationUrl, 'utf8')

test('migração isola segredos e dados brutos do cliente', () => {
  assert.match(sql, /create table private\.playlist_source_secrets/i)
  assert.match(sql, /create table private\.raw_playlist_entries/i)
  assert.match(sql, /create table private\.playlist_item_variants/i)
  assert.match(sql, /revoke all on all tables in schema private from public, anon, authenticated/i)
  assert.match(sql, /vault\.create_secret/i)
  assert.doesNotMatch(sql, /create table public\.playlist_source_secrets/i)
})

test('idempotência é limitada à playlist e enfileira apenas a criação vencedora', () => {
  assert.match(sql, /unique \(playlist_id, idempotency_key\)/i)
  assert.match(sql, /on conflict \(playlist_id, idempotency_key\) do nothing/i)
  assert.match(sql, /if v_created then\s+perform pgmq\.send/is)
})

test('worker é exclusivo do service role', () => {
  for (const name of [
    'worker_get_playlist_import', 'worker_claim_playlist_import', 'worker_archive_playlist_import',
    'worker_reset_playlist_import', 'worker_is_playlist_import_cancelled', 'worker_stage_raw_entries', 'worker_stage_normalized_items',
    'worker_apply_match_decisions', 'worker_update_playlist_import', 'worker_finalize_playlist_import',
  ]) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${name}\\(`, 'i'), name)
    assert.match(sql, new RegExp(`grant execute on function public\\.${name}\\([^;]+to service_role`, 'i'), name)
  }
})

test('cancelamento é cooperativo e não pode atingir versão publicada', () => {
  assert.match(sql, /cancel_playlist_import/i)
  assert.match(sql, /published_import_cannot_be_cancelled/i)
  assert.match(sql, /worker_is_playlist_import_cancelled/i)
})

test('ativação troca somente o ponteiro ativo sob lock e mantém rollback', () => {
  assert.match(sql, /select active_import_id into v_previous[\s\S]+for update/i)
  assert.match(sql, /set active_import_id = p_import_id/i)
  assert.match(sql, /status = 'superseded'/i)
  assert.match(sql, /create or replace function public\.rollback_playlist_import/i)
  assert.match(sql, /set\s+active_import_id = p_target_import_id/i)
})

test('anomalias bloqueiam promoção silenciosa e force exige auditoria administrativa', () => {
  assert.match(sql, /catalog_drop_over_50_percent/i)
  assert.match(sql, /parse_issue_ratio_high/i)
  assert.match(sql, /unknown_ratio_high/i)
  assert.match(sql, /activation_requires_review/i)
  assert.match(sql, /force_requires_admin/i)
  assert.match(sql, /force_reason_required/i)
  assert.match(sql, /activation_forced = p_force/i)
})

test('contrato da TV lê apenas a versão ativa e mantém variantes privadas', () => {
  assert.match(sql, /service_get_active_playlist_items/i)
  assert.match(sql, /join public\.normalized_playlist_items item on item\.import_id = playlist\.active_import_id/i)
  assert.match(sql, /from private\.playlist_item_variants variant/i)
  assert.match(sql, /grant execute on function public\.service_get_active_playlist_items\([^;]+to service_role/i)
  assert.match(sql, /revoke all on function public\.service_get_active_playlist_items\([^;]+from public, anon, authenticated/i)
})

test('curadoria do admin agrega grupos somente da versão ativa', () => {
  assert.match(sql, /get_active_playlist_group_counts/i)
  assert.match(sql, /join public\.normalized_playlist_items item on item\.import_id = playlist\.active_import_id/i)
  assert.match(sql, /playlist\.user_id = auth\.uid\(\) or public\.is_admin\(\)/i)
})

test('revisão manual é auditável, persistente e recalcula o gate', () => {
  assert.match(sql, /resolve_playlist_identity/i)
  assert.match(sql, /decision in \('matched', 'rejected'\)/i)
  assert.match(sql, /ambiguous_match_review_pending/i)
  assert.match(sql, /validation_status = case when jsonb_array_length\(v_blockers\) = 0/i)
})
