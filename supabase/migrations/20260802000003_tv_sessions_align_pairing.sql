-- ============================================================================
-- Alinha public.tv_sessions ao contrato ja usado pelo trigger
-- handle_pair_token_linked() e pelo app da TV (pairingService.ts).
--
-- Motivo: o trigger inseria colunas inexistentes (xtream_user, xtream_pass,
-- user_id, last_seen_at), nao preenchia pair_token (NOT NULL) e usava
-- ON CONFLICT (device_id) sem constraint correspondente. Resultado: toda
-- vinculacao abortava com 42703 e tv_sessions ficou com 0 linhas.
--
-- Tabela vazia no momento da aplicacao -> rename e constraint sem migracao.
-- Nenhuma mudanca necessaria no codigo da TV.
-- ============================================================================

begin;

-- 1) Vocabulario alinhado com pair_tokens, com o trigger e com a TV
alter table public.tv_sessions rename column xtream_username to xtream_user;
alter table public.tv_sessions rename column xtream_password to xtream_pass;

-- 2) Colunas que trigger e TV ja usam
alter table public.tv_sessions
  add column if not exists user_id uuid references public.users(id) on delete set null,
  add column if not exists last_seen_at timestamptz default now();

-- 3) Uma sessao por aparelho.
--    Exigido pelo ON CONFLICT (device_id) do trigger e pelo
--    Prefer: resolution=merge-duplicates do upsertTvSession() da TV.
create unique index if not exists tv_sessions_device_id_key
  on public.tv_sessions (device_id);

-- 4) A sessao sobrevive ao token, que expira em 10 min.
alter table public.tv_sessions alter column pair_token drop not null;

-- 5) Sessao persistente nao pode nascer expirando em 15 min.
alter table public.tv_sessions alter column expires_at drop default;

-- 6) Trigger consistente com o schema acima
create or replace function public.handle_pair_token_linked()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'linked' and (old.status is distinct from 'linked') then
    insert into tv_sessions (
      device_id, pair_token, device_name, status,
      playlist_url, playlist_type,
      xtream_host, xtream_user, xtream_pass,
      user_id, paired_at, last_seen_at
    )
    values (
      new.device_id, new.token, new.device_name, 'paired',
      new.playlist_url, new.playlist_type,
      new.xtream_host, new.xtream_user, new.xtream_pass,
      new.user_id, now(), now()
    )
    on conflict (device_id) do update set
      pair_token    = excluded.pair_token,
      device_name   = coalesce(excluded.device_name, tv_sessions.device_name),
      status        = 'paired',
      playlist_url  = excluded.playlist_url,
      playlist_type = excluded.playlist_type,
      xtream_host   = excluded.xtream_host,
      xtream_user   = excluded.xtream_user,
      xtream_pass   = excluded.xtream_pass,
      user_id       = excluded.user_id,
      paired_at     = now(),
      last_seen_at  = now();
  end if;
  return new;
end;
$$;

commit;
