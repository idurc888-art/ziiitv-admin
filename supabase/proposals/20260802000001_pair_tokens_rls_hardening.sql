-- ============================================================================
-- MITIGACAO A — endurecimento de RLS em public.pair_tokens
--
-- STATUS: PROPOSTA. NAO APLICADA.
-- Ao aprovar, mover para supabase/migrations/ e aplicar com `supabase db push`.
--
-- Escopo:  SOMENTE pair_tokens. tv_sessions NAO e tocada.
-- Dados:   nenhum INSERT/UPDATE/DELETE. Apenas DDL de permissao.
-- Reverte: 20260802000002_pair_tokens_rls_rollback.sql
--
-- Contexto: 10 policies permissivas acumuladas fora de versao davam ao papel
-- `anon` (chave publica, presente no bundle de toda TV) SELECT/INSERT/UPDATE/
-- DELETE irrestritos sobre a tabela. Ver docs/db/POLICIES-pair_tokens.md
-- no repo ziiitv-admin-pro.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) Derruba as 10 policies permissivas
-- ---------------------------------------------------------------------------
drop policy if exists "pair_tokens: anon all"              on public.pair_tokens;
drop policy if exists "Qualquer um lê pelo token"          on public.pair_tokens;
drop policy if exists "Celular atualiza pelo token"        on public.pair_tokens;
drop policy if exists "TV pode inserir token"              on public.pair_tokens;
drop policy if exists "anon pode ler pair token por token" on public.pair_tokens;
drop policy if exists "anon pode atualizar pair token"     on public.pair_tokens;
drop policy if exists "anon pode criar pair token"         on public.pair_tokens;
drop policy if exists "anon_select"                        on public.pair_tokens;
drop policy if exists "anon_insert"                        on public.pair_tokens;
drop policy if exists "anon_update_by_token"               on public.pair_tokens;

-- Higiene: as policies restritivas declaradas na migration de baseline
-- (20260517000000) foram removidas de producao por DDL manual e nao existem
-- mais. Os drops abaixo sao no-op, garantem idempotencia.
drop policy if exists "pair_tokens_owner_read"             on public.pair_tokens;
drop policy if exists "pair_tokens_owner_update"           on public.pair_tokens;

-- ---------------------------------------------------------------------------
-- 2) Grants minimos (hoje e GRANT ALL, que inclui DELETE e TRUNCATE)
-- ---------------------------------------------------------------------------
revoke all on table public.pair_tokens from anon;
revoke all on table public.pair_tokens from authenticated;

grant select, insert         on table public.pair_tokens to anon;
grant select, insert, update on table public.pair_tokens to authenticated;
-- service_role mantem GRANT ALL (worker, Edge Functions, admin server-side)

alter table public.pair_tokens enable row level security;

-- ---------------------------------------------------------------------------
-- 3) anon: cria apenas token pendente e sem credencial
--    Usado por: ziiiTV src/services/pairingService.ts:159 (createPairToken)
-- ---------------------------------------------------------------------------
create policy pt_anon_insert on public.pair_tokens
  for insert to anon
  with check (
    status = 'pending'
    and playlist_url  is null
    and playlist_type is null
    and xtream_host   is null
    and xtream_user   is null
    and xtream_pass   is null
    and user_id       is null
    and linked_at     is null
  );

-- ---------------------------------------------------------------------------
-- 4) anon: le apenas token dentro da validade (default expires_at = now()+10min)
--    Usado por: pairingService.ts:187 (polling), usePairing.ts:139 (Realtime),
--               ziiitv-admin src/pages/LinkPage.tsx:54 (leitura pre-login)
--    Necessario tambem para o `Prefer: return=representation` do INSERT.
-- ---------------------------------------------------------------------------
create policy pt_anon_select_live on public.pair_tokens
  for select to anon
  using (expires_at > now());

-- ---------------------------------------------------------------------------
-- 5) authenticated: le token vivo (LinkPage apos retorno do OAuth)
-- ---------------------------------------------------------------------------
create policy pt_auth_select_live on public.pair_tokens
  for select to authenticated
  using (expires_at > now());

-- ---------------------------------------------------------------------------
-- 6) authenticated: vincula um token pendente, e nada alem disso
--    Usado por: ziiitv-admin src/pages/LinkPage.tsx:159
--
--    O `user_id = auth.uid()` amarra a vinculacao a quem esta logado.
--    LinkPage.tsx:163 envia `user_id: userId || null`, e `userId` vem de
--    session.user.id — sempre preenchido no step 'form'.
--    Se preferir risco zero na primeira aplicacao, trocar o with check por:
--        with check (status = 'linked')
--    e amarrar o user_id num segundo passo.
-- ---------------------------------------------------------------------------
create policy pt_auth_link on public.pair_tokens
  for update to authenticated
  using      (status = 'pending' and expires_at > now())
  with check (status = 'linked'  and user_id = auth.uid());

commit;

-- ============================================================================
-- Estado final de public.pair_tokens
--
--   anon           : SELECT (so token vivo) + INSERT (so pendente e limpo)
--   authenticated  : SELECT (so token vivo) + INSERT + UPDATE (so pending->linked)
--   service_role   : inalterado (GRANT ALL, bypassa RLS)
--
--   anon UPDATE    : REMOVIDO
--   anon DELETE    : REMOVIDO
--
-- Trigger on_pair_token_linked / handle_pair_token_linked() preservado —
-- roda como security definer e nao e afetado por RLS.
-- ============================================================================
