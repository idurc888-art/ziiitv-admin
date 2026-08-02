-- ============================================================================
-- ROLLBACK de 20260802000001_pair_tokens_rls_hardening.sql
--
-- Restaura public.pair_tokens exatamente ao estado de producao de 2026-08-02,
-- transcrito de schema-producao.sql (supabase db dump --linked --schema public).
--
-- Nao toca em dados. Uma transacao, segundos.
-- ============================================================================

begin;

-- 1) Remove as policies introduzidas pela mitigacao
drop policy if exists pt_anon_insert      on public.pair_tokens;
drop policy if exists pt_anon_select_live on public.pair_tokens;
drop policy if exists pt_auth_select_live on public.pair_tokens;
drop policy if exists pt_auth_link        on public.pair_tokens;

-- 2) Restaura os grants originais
grant all on table public.pair_tokens to anon;
grant all on table public.pair_tokens to authenticated;
grant all on table public.pair_tokens to service_role;

-- 3) Recria as 10 policies como estavam
create policy "pair_tokens: anon all" on public.pair_tokens
  using (true) with check (true);

create policy "Qualquer um lê pelo token" on public.pair_tokens
  for select using (true);

create policy "Celular atualiza pelo token" on public.pair_tokens
  for update using (true);

create policy "TV pode inserir token" on public.pair_tokens
  for insert with check (true);

create policy "anon pode ler pair token por token" on public.pair_tokens
  for select to authenticated, anon using (true);

create policy "anon pode atualizar pair token" on public.pair_tokens
  for update to authenticated, anon using (true) with check (true);

create policy "anon pode criar pair token" on public.pair_tokens
  for insert to authenticated, anon with check (true);

create policy "anon_select" on public.pair_tokens
  for select to anon using (true);

create policy "anon_insert" on public.pair_tokens
  for insert to anon with check (true);

create policy "anon_update_by_token" on public.pair_tokens
  for update to anon
  using (status = 'pending' and expires_at > now())
  with check (status = 'linked');

commit;
