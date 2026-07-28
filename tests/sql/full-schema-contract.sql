\set ON_ERROR_STOP on

do $$
declare
  expected text[] := array[
    'users', 'playlists', 'pairing_codes', 'channels', 'canonical_titles',
    'watch_history', 'watch_events', 'homes', 'home_sections', 'section_items',
    'enrich_jobs', 'pair_tokens', 'tv_sessions', 'copa_matches', 'copa_standings',
    'playlist_content', 'epg_channels', 'epg_schedules', 'playlist_import_runs',
    'normalized_playlist_items', 'canonical_match_decisions',
    'canonical_identity_overrides', 'playlist_import_metrics', 'provider_group_rules'
  ];
  item text;
begin
  foreach item in array expected loop
    if to_regclass('public.' || item) is null then
      raise exception 'missing required table: %', item;
    end if;
  end loop;
end $$;

do $$
declare
  item text;
begin
  foreach item in array array[
    'users', 'playlists', 'pairing_codes', 'channels', 'canonical_titles',
    'watch_history', 'watch_events', 'homes', 'home_sections', 'section_items',
    'enrich_jobs', 'pair_tokens', 'tv_sessions', 'copa_matches', 'copa_standings',
    'playlist_content', 'epg_channels', 'epg_schedules', 'playlist_import_runs',
    'normalized_playlist_items', 'canonical_match_decisions',
    'canonical_identity_overrides', 'playlist_import_metrics', 'provider_group_rules'
  ] loop
    if not coalesce((select relrowsecurity from pg_class where oid = ('public.' || item)::regclass), false) then
      raise exception 'RLS disabled on required table: %', item;
    end if;
  end loop;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.column_privileges
    where table_schema = 'public'
      and table_name in ('pair_tokens', 'tv_sessions')
      and grantee in ('anon', 'authenticated')
      and column_name in ('playlist_url', 'xtream_host', 'xtream_user', 'xtream_pass')
  ) then
    raise exception 'playlist credential columns are exposed';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'homes'
      and qual like '%is_admin%'
  ) then
    raise exception 'homes has no admin authorization policy';
  end if;

  if to_regprocedure('public.start_playlist_import(uuid,text,text,text,uuid,text,text,text,text)') is null then
    raise exception 'start_playlist_import RPC missing';
  end if;
  if to_regprocedure('public.promote_playlist_import(uuid,boolean,text)') is null then
    raise exception 'promote_playlist_import RPC missing';
  end if;
  if to_regprocedure('public.service_get_active_playlist_items(uuid,integer,integer)') is null then
    raise exception 'TV active-version RPC missing';
  end if;
end $$;

select 'QI220_FULL_SCHEMA_BOOTSTRAP_OK';
