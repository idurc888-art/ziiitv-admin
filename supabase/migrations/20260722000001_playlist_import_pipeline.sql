create extension if not exists pgcrypto;
create extension if not exists pgmq;
create extension if not exists supabase_vault with schema vault;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

do $$
begin
  perform pgmq.create('playlist_imports');
exception
  when duplicate_table then null;
end;
$$;

create table public.playlist_import_runs (
  id uuid primary key default gen_random_uuid(),
  playlist_id uuid not null references public.playlists(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  status text not null default 'queued' check (status in (
    'queued', 'fetching', 'parsing', 'normalizing', 'matching', 'validating',
    'ready_for_activation', 'active', 'superseded', 'failed', 'cancelled', 'rolled_back'
  )),
  source_kind text not null check (source_kind in ('m3u', 'xtream')),
  source_mode text not null check (source_mode in ('file', 'url', 'api')),
  storage_path text,
  source_secret_id uuid,
  source_fingerprint text,
  idempotency_key text not null,
  parser_version text not null,
  matcher_version text not null,
  progress smallint not null default 0 check (progress between 0 and 100),
  current_stage text,
  attempt_count integer not null default 0,
  heartbeat_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  activated_at timestamptz,
  activated_by uuid references public.users(id) on delete set null,
  activation_forced boolean not null default false,
  activation_reason text,
  cancelled_at timestamptz,
  validation_status text not null default 'pending' check (validation_status in ('pending', 'passed', 'review_required')),
  activation_blockers jsonb not null default '[]'::jsonb,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (playlist_id, idempotency_key),
  check (
    (source_kind = 'm3u' and source_mode in ('file', 'url'))
    or (source_kind = 'xtream' and source_mode = 'api')
  ),
  check (
    (source_mode = 'file' and storage_path is not null and source_secret_id is null)
    or (source_mode in ('url', 'api') and storage_path is null and source_secret_id is not null)
  )
);

alter table public.playlists
  add column if not exists active_import_id uuid references public.playlist_import_runs(id) on delete set null;

create table private.playlist_source_secrets (
  id uuid primary key default gen_random_uuid(),
  playlist_id uuid not null references public.playlists(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  vault_secret_id uuid not null unique,
  created_at timestamptz not null default now()
);

create table private.raw_playlist_entries (
  id bigint generated always as identity primary key,
  import_id uuid not null references public.playlist_import_runs(id) on delete cascade,
  source_entry_id text not null,
  source_kind text not null check (source_kind in ('m3u', 'xtream')),
  source_order integer not null,
  raw_name text not null,
  stream_url text not null,
  stream_url_hash text not null,
  group_title text,
  tvg_id text,
  tvg_name text,
  logo_url text,
  attributes jsonb not null default '{}'::jsonb,
  source_type text check (source_type in ('live', 'movie', 'series')),
  external_id text,
  category_id text,
  tmdb_id integer,
  created_at timestamptz not null default now(),
  unique (import_id, source_entry_id)
);

create table public.normalized_playlist_items (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.playlist_import_runs(id) on delete cascade,
  playlist_id uuid not null references public.playlists(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  identity_key text not null,
  content_type text not null check (content_type in ('live', 'movie', 'series', 'unknown')),
  display_title text not null,
  match_title text not null,
  title_key text not null,
  release_year integer,
  group_title text,
  tvg_id text,
  logo_url text,
  platform text,
  source_tmdb_id integer,
  classification_confidence numeric(5,4) not null check (classification_confidence between 0 and 1),
  classification_evidence jsonb not null default '[]'::jsonb,
  canonical_id text references public.canonical_titles(id) on delete set null,
  match_status text not null default 'unmatched' check (match_status in (
    'auto_matched', 'review_required', 'unmatched', 'rejected', 'manually_matched'
  )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (import_id, identity_key)
);

create table private.playlist_item_variants (
  id bigint generated always as identity primary key,
  item_id uuid not null references public.normalized_playlist_items(id) on delete cascade,
  raw_entry_id text not null,
  stream_url text not null,
  stream_url_hash text not null,
  quality text not null check (quality in ('4K', 'FHD', 'HD', 'SD', 'UNKNOWN')),
  audio_version text not null check (audio_version in ('dubbed', 'subtitled', 'dual', 'original', 'unknown')),
  codec text check (codec in ('h265', 'h264')),
  season_number integer check (season_number is null or season_number > 0),
  episode_number integer check (episode_number is null or episode_number > 0),
  health_status text not null default 'unchecked' check (health_status in ('unchecked', 'healthy', 'degraded', 'dead')),
  created_at timestamptz not null default now(),
  unique (item_id, raw_entry_id, stream_url_hash)
);

create table public.canonical_match_decisions (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.playlist_import_runs(id) on delete cascade,
  item_id uuid not null references public.normalized_playlist_items(id) on delete cascade,
  candidate_id text references public.canonical_titles(id) on delete set null,
  status text not null check (status in ('auto_matched', 'review_required', 'rejected', 'manually_matched')),
  confidence numeric(5,4) not null check (confidence between 0 and 1),
  evidence jsonb not null default '{}'::jsonb,
  matcher_version text not null,
  decided_by uuid references public.users(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (item_id, candidate_id, matcher_version)
);

create table public.canonical_identity_overrides (
  id uuid primary key default gen_random_uuid(),
  playlist_id uuid not null references public.playlists(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  identity_key text not null,
  canonical_id text references public.canonical_titles(id) on delete cascade,
  decision text not null default 'matched' check (decision in ('matched', 'rejected')),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (playlist_id, identity_key),
  check (
    (decision = 'matched' and canonical_id is not null)
    or (decision = 'rejected' and canonical_id is null)
  )
);

create table public.playlist_import_metrics (
  import_id uuid primary key references public.playlist_import_runs(id) on delete cascade,
  raw_count integer not null default 0,
  normalized_count integer not null default 0,
  live_count integer not null default 0,
  movie_count integer not null default 0,
  series_count integer not null default 0,
  unknown_count integer not null default 0,
  duplicate_url_count integer not null default 0,
  parse_issue_count integer not null default 0,
  auto_match_count integer not null default 0,
  review_count integer not null default 0,
  unmatched_count integer not null default 0,
  previous_normalized_count integer,
  change_ratio numeric(12,6),
  warnings jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table public.provider_group_rules (
  id uuid primary key default gen_random_uuid(),
  provider_key text not null,
  pattern text not null,
  content_type text not null check (content_type in ('live', 'movie', 'series')),
  platform text,
  priority integer not null default 100,
  active boolean not null default true,
  rule_version integer not null default 1,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider_key, pattern, rule_version)
);

create index playlist_import_runs_playlist_created_idx
  on public.playlist_import_runs (playlist_id, created_at desc);
create index playlist_import_runs_status_idx
  on public.playlist_import_runs (status, created_at);
create index raw_playlist_entries_import_order_idx
  on private.raw_playlist_entries (import_id, source_order);
create index raw_playlist_entries_import_type_idx
  on private.raw_playlist_entries (import_id, source_type);
create index normalized_items_import_type_idx
  on public.normalized_playlist_items (import_id, content_type);
create index normalized_items_playlist_active_idx
  on public.normalized_playlist_items (playlist_id, import_id);
create index normalized_items_canonical_idx
  on public.normalized_playlist_items (canonical_id) where canonical_id is not null;
create index playlist_variants_item_episode_idx
  on private.playlist_item_variants (item_id, season_number, episode_number);
create index match_decisions_review_idx
  on public.canonical_match_decisions (status, created_at) where status = 'review_required';
create index canonical_identity_overrides_playlist_idx
  on public.canonical_identity_overrides (playlist_id, identity_key);
create index playlist_source_secrets_playlist_idx
  on private.playlist_source_secrets (playlist_id, created_at desc);

alter table public.playlist_import_runs enable row level security;
alter table public.normalized_playlist_items enable row level security;
alter table public.canonical_match_decisions enable row level security;
alter table public.canonical_identity_overrides enable row level security;
alter table public.playlist_import_metrics enable row level security;
alter table public.provider_group_rules enable row level security;

create policy playlist_import_runs_owner_read on public.playlist_import_runs
  for select using (user_id = auth.uid());
create policy playlist_import_runs_admin_all on public.playlist_import_runs
  for all using (public.is_admin()) with check (public.is_admin());

create policy normalized_playlist_items_owner_read on public.normalized_playlist_items
  for select using (user_id = auth.uid());
create policy normalized_playlist_items_admin_all on public.normalized_playlist_items
  for all using (public.is_admin()) with check (public.is_admin());

create policy canonical_match_decisions_owner_read on public.canonical_match_decisions
  for select using (
    exists (
      select 1 from public.playlist_import_runs run
      where run.id = canonical_match_decisions.import_id and run.user_id = auth.uid()
    )
  );
create policy canonical_match_decisions_admin_all on public.canonical_match_decisions
  for all using (public.is_admin()) with check (public.is_admin());

create policy canonical_identity_overrides_owner_read on public.canonical_identity_overrides
  for select using (user_id = auth.uid());
create policy canonical_identity_overrides_admin_all on public.canonical_identity_overrides
  for all using (public.is_admin()) with check (public.is_admin());

create policy playlist_import_metrics_owner_read on public.playlist_import_metrics
  for select using (
    exists (
      select 1 from public.playlist_import_runs run
      where run.id = playlist_import_metrics.import_id and run.user_id = auth.uid()
    )
  );
create policy playlist_import_metrics_admin_read on public.playlist_import_metrics
  for select using (public.is_admin());

create policy provider_group_rules_authenticated_read on public.provider_group_rules
  for select to authenticated using (active or public.is_admin());
create policy provider_group_rules_admin_all on public.provider_group_rules
  for all using (public.is_admin()) with check (public.is_admin());

revoke all on all tables in schema private from public, anon, authenticated;
grant select, insert, update, delete on all tables in schema private to service_role;
grant usage, select on all sequences in schema private to service_role;

create or replace function public.touch_playlist_import_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger playlist_import_runs_touch_updated_at
before update on public.playlist_import_runs
for each row execute function public.touch_playlist_import_updated_at();

create trigger normalized_playlist_items_touch_updated_at
before update on public.normalized_playlist_items
for each row execute function public.touch_playlist_import_updated_at();

create trigger canonical_identity_overrides_touch_updated_at
before update on public.canonical_identity_overrides
for each row execute function public.touch_playlist_import_updated_at();

create trigger provider_group_rules_touch_updated_at
before update on public.provider_group_rules
for each row execute function public.touch_playlist_import_updated_at();

create or replace function public.start_playlist_import(
  p_playlist_id uuid,
  p_source_kind text,
  p_source_mode text,
  p_storage_path text,
  p_source_secret_id uuid,
  p_source_fingerprint text,
  p_idempotency_key text,
  p_parser_version text,
  p_matcher_version text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_import_id uuid;
  v_created boolean := false;
begin
  if v_user_id is null then raise exception 'authentication_required'; end if;
  if not exists (
    select 1 from public.playlists
    where id = p_playlist_id and user_id = v_user_id
  ) then
    raise exception 'playlist_not_found';
  end if;
  if p_source_secret_id is not null and not exists (
    select 1 from private.playlist_source_secrets secret
    where secret.id = p_source_secret_id
      and secret.playlist_id = p_playlist_id
      and secret.user_id = v_user_id
  ) then
    raise exception 'source_secret_not_found';
  end if;

  select id into v_import_id
  from public.playlist_import_runs
  where playlist_id = p_playlist_id and idempotency_key = p_idempotency_key;

  if v_import_id is not null then return v_import_id; end if;

  insert into public.playlist_import_runs (
    playlist_id, user_id, source_kind, source_mode, storage_path, source_secret_id,
    source_fingerprint, idempotency_key, parser_version, matcher_version, current_stage
  ) values (
    p_playlist_id, v_user_id, p_source_kind, p_source_mode, p_storage_path, p_source_secret_id,
    p_source_fingerprint, p_idempotency_key, p_parser_version, p_matcher_version, 'queued'
  )
  on conflict (playlist_id, idempotency_key) do nothing
  returning id into v_import_id;

  if v_import_id is null then
    select id into v_import_id from public.playlist_import_runs
    where playlist_id = p_playlist_id and idempotency_key = p_idempotency_key;
    return v_import_id;
  end if;
  v_created := true;

  if v_created then
    perform pgmq.send('playlist_imports', jsonb_build_object('import_id', v_import_id));
  end if;
  return v_import_id;
end;
$$;

create or replace function public.store_playlist_source_secret(p_playlist_id uuid, p_secret jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_vault_id uuid;
  v_source_id uuid;
begin
  if v_user_id is null then raise exception 'authentication_required'; end if;
  if not exists (
    select 1 from public.playlists where id = p_playlist_id and user_id = v_user_id
  ) then
    raise exception 'playlist_not_found';
  end if;
  if p_secret is null or jsonb_typeof(p_secret) <> 'object' then
    raise exception 'invalid_source_secret';
  end if;

  select vault.create_secret(
    p_secret::text,
    'playlist-source-' || p_playlist_id::text || '-' || gen_random_uuid()::text,
    'ziiiTV playlist source credentials'
  ) into v_vault_id;

  insert into private.playlist_source_secrets (playlist_id, user_id, vault_secret_id)
  values (p_playlist_id, v_user_id, v_vault_id)
  returning id into v_source_id;
  return v_source_id;
end;
$$;

create or replace function public.worker_get_playlist_import(p_import_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', run.id,
    'playlist_id', run.playlist_id,
    'user_id', run.user_id,
    'status', run.status,
    'source_kind', run.source_kind,
    'source_mode', run.source_mode,
    'storage_path', run.storage_path,
    'parser_version', run.parser_version,
    'matcher_version', run.matcher_version,
    'attempt_count', run.attempt_count,
    'source_secret', case
      when decrypted.decrypted_secret is null then null
      else decrypted.decrypted_secret::jsonb
    end
  )
  from public.playlist_import_runs run
  left join private.playlist_source_secrets source on source.id = run.source_secret_id
  left join vault.decrypted_secrets decrypted on decrypted.id = source.vault_secret_id
  where run.id = p_import_id;
$$;

create or replace function public.worker_claim_playlist_import(p_visibility_seconds integer default 900)
returns table (
  msg_id bigint,
  read_ct integer,
  enqueued_at timestamptz,
  visible_at timestamptz,
  message jsonb
)
language sql
security definer
set search_path = ''
as $$
  select q.msg_id, q.read_ct, q.enqueued_at, q.vt, q.message
  from pgmq.read('playlist_imports', greatest(p_visibility_seconds, 60), 1) q;
$$;

create or replace function public.worker_archive_playlist_import(p_msg_id bigint)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select pgmq.archive('playlist_imports', p_msg_id);
$$;

create or replace function public.worker_is_playlist_import_cancelled(p_import_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select status = 'cancelled' from public.playlist_import_runs where id = p_import_id
  ), true);
$$;

create or replace function public.worker_reset_playlist_import(p_import_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.playlist_import_runs
    where id = p_import_id and status = 'fetching'
  ) then
    raise exception 'import_not_fetching';
  end if;

  delete from public.normalized_playlist_items where import_id = p_import_id;
  delete from private.raw_playlist_entries where import_id = p_import_id;
  delete from public.playlist_import_metrics where import_id = p_import_id;
  update public.playlist_import_runs set
    validation_status = 'pending', activation_blockers = '[]'::jsonb,
    completed_at = null, error_code = null, error_message = null
  where id = p_import_id;
end;
$$;

create or replace function public.worker_stage_raw_entries(p_import_id uuid, p_entries jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not exists (
    select 1 from public.playlist_import_runs
    where id = p_import_id and status = 'parsing'
  ) then
    raise exception 'import_not_parsing';
  end if;

  insert into private.raw_playlist_entries (
    import_id, source_entry_id, source_kind, source_order, raw_name, stream_url,
    stream_url_hash, group_title, tvg_id, tvg_name, logo_url, attributes,
    source_type, external_id, category_id, tmdb_id
  )
  select
    p_import_id,
    entry->>'id',
    entry->>'source',
    (entry->>'order')::integer,
    entry->>'rawName',
    entry->>'url',
    encode(extensions.digest(entry->>'url', 'sha256'), 'hex'),
    nullif(entry->>'groupTitle', ''),
    nullif(entry->>'tvgId', ''),
    nullif(entry->>'tvgName', ''),
    nullif(entry->>'logoUrl', ''),
    coalesce(entry->'attributes', '{}'::jsonb),
    nullif(entry->>'sourceType', ''),
    nullif(entry->>'externalId', ''),
    nullif(entry->>'categoryId', ''),
    nullif(entry->>'tmdbId', '')::integer
  from jsonb_array_elements(p_entries) entry
  on conflict (import_id, source_entry_id) do update set
    source_kind = excluded.source_kind,
    source_order = excluded.source_order,
    raw_name = excluded.raw_name,
    stream_url = excluded.stream_url,
    stream_url_hash = excluded.stream_url_hash,
    group_title = excluded.group_title,
    tvg_id = excluded.tvg_id,
    tvg_name = excluded.tvg_name,
    logo_url = excluded.logo_url,
    attributes = excluded.attributes,
    source_type = excluded.source_type,
    external_id = excluded.external_id,
    category_id = excluded.category_id,
    tmdb_id = excluded.tmdb_id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.worker_stage_normalized_items(p_import_id uuid, p_items jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.playlist_import_runs%rowtype;
  v_item jsonb;
  v_variant jsonb;
  v_item_id uuid;
  v_count integer := 0;
begin
  select * into v_run from public.playlist_import_runs where id = p_import_id;
  if v_run.id is null then raise exception 'import_not_found'; end if;
  if v_run.status not in ('parsing', 'normalizing') then raise exception 'import_not_normalizing'; end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    insert into public.normalized_playlist_items (
      import_id, playlist_id, user_id, identity_key, content_type, display_title,
      match_title, title_key, release_year, group_title, tvg_id, logo_url, platform, source_tmdb_id,
      classification_confidence, classification_evidence
    ) values (
      p_import_id, v_run.playlist_id, v_run.user_id, v_item->>'identityKey',
      v_item->>'contentType', v_item->>'displayTitle', v_item->>'matchTitle',
      v_item->>'titleKey', nullif(v_item->>'year', '')::integer,
      nullif(v_item->>'groupTitle', ''), nullif(v_item->>'tvgId', ''),
      nullif(v_item->>'logoUrl', ''), nullif(v_item->>'platform', ''),
      nullif(v_item->>'tmdbId', '')::integer,
      (v_item->>'classificationConfidence')::numeric,
      coalesce(v_item->'classificationEvidence', '[]'::jsonb)
    )
    on conflict (import_id, identity_key) do update set
      content_type = excluded.content_type,
      display_title = excluded.display_title,
      match_title = excluded.match_title,
      title_key = excluded.title_key,
      release_year = excluded.release_year,
      group_title = excluded.group_title,
      tvg_id = excluded.tvg_id,
      logo_url = coalesce(public.normalized_playlist_items.logo_url, excluded.logo_url),
      platform = coalesce(public.normalized_playlist_items.platform, excluded.platform),
      source_tmdb_id = excluded.source_tmdb_id,
      classification_confidence = excluded.classification_confidence,
      classification_evidence = excluded.classification_evidence
    returning id into v_item_id;

    for v_variant in select value from jsonb_array_elements(coalesce(v_item->'variants', '[]'::jsonb))
    loop
      insert into private.playlist_item_variants (
        item_id, raw_entry_id, stream_url, stream_url_hash, quality, audio_version,
        codec, season_number, episode_number
      ) values (
        v_item_id, v_variant->>'rawEntryId', v_variant->>'url',
        encode(extensions.digest(v_variant->>'url', 'sha256'), 'hex'),
        v_variant->>'quality', v_variant->>'audioVersion', nullif(v_variant->>'codec', ''),
        nullif(v_variant->>'season', '')::integer, nullif(v_variant->>'episode', '')::integer
      )
      on conflict (item_id, raw_entry_id, stream_url_hash) do update set
        quality = excluded.quality,
        audio_version = excluded.audio_version,
        codec = excluded.codec,
        season_number = excluded.season_number,
        episode_number = excluded.episode_number;
    end loop;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.worker_apply_match_decisions(
  p_import_id uuid,
  p_matcher_version text,
  p_decisions jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_decision jsonb;
  v_item_id uuid;
  v_status text;
  v_candidate_id text;
  v_count integer := 0;
begin
  if not exists (
    select 1 from public.playlist_import_runs
    where id = p_import_id and status in ('parsing', 'matching')
  ) then
    raise exception 'import_not_matching';
  end if;

  for v_decision in select value from jsonb_array_elements(p_decisions)
  loop
    v_status := v_decision->>'status';
    v_candidate_id := nullif(v_decision->>'candidateId', '');
    update public.normalized_playlist_items set
      canonical_id = case when v_status in ('auto_matched', 'manually_matched') then v_candidate_id else null end,
      match_status = v_status
    where import_id = p_import_id and identity_key = v_decision->>'identityKey'
    returning id into v_item_id;
    if v_item_id is null then raise exception 'normalized_item_not_found'; end if;

    if v_candidate_id is not null then
      insert into public.canonical_match_decisions (
        import_id, item_id, candidate_id, status, confidence, evidence, matcher_version,
        decided_at
      ) values (
        p_import_id, v_item_id, v_candidate_id, v_status,
        (v_decision->>'confidence')::numeric,
        coalesce(v_decision->'evidence', '{}'::jsonb) || jsonb_build_object(
          'candidates', coalesce(v_decision->'candidates', '[]'::jsonb)
        ), p_matcher_version,
        case when v_status = 'manually_matched' then now() else null end
      )
      on conflict (item_id, candidate_id, matcher_version) do update set
        status = excluded.status,
        confidence = excluded.confidence,
        evidence = excluded.evidence,
        decided_at = excluded.decided_at;
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.resolve_playlist_identity(
  p_item_id uuid,
  p_action text,
  p_canonical_id text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.normalized_playlist_items%rowtype;
  v_run public.playlist_import_runs%rowtype;
  v_candidate_type text;
  v_review_count integer;
  v_blockers jsonb;
begin
  select * into v_item from public.normalized_playlist_items where id = p_item_id for update;
  if v_item.id is null then raise exception 'item_not_found'; end if;
  select * into v_run from public.playlist_import_runs where id = v_item.import_id for update;
  if auth.uid() <> v_run.user_id and not public.is_admin() then raise exception 'forbidden'; end if;
  if v_run.status <> 'ready_for_activation' then raise exception 'import_not_reviewable'; end if;
  if p_action not in ('matched', 'rejected') then raise exception 'invalid_review_action'; end if;

  if p_action = 'matched' then
    select type into v_candidate_type from public.canonical_titles where id = p_canonical_id;
    if v_candidate_type is null then raise exception 'canonical_not_found'; end if;
    if v_candidate_type <> v_item.content_type then raise exception 'canonical_type_mismatch'; end if;
  elsif p_canonical_id is not null then
    raise exception 'rejection_cannot_have_candidate';
  end if;

  insert into public.canonical_identity_overrides (
    playlist_id, user_id, identity_key, canonical_id, decision, created_by
  ) values (
    v_item.playlist_id, v_item.user_id, v_item.identity_key,
    case when p_action = 'matched' then p_canonical_id else null end,
    p_action, auth.uid()
  )
  on conflict (playlist_id, identity_key) do update set
    canonical_id = excluded.canonical_id,
    decision = excluded.decision,
    created_by = excluded.created_by,
    updated_at = now();

  update public.normalized_playlist_items set
    canonical_id = case when p_action = 'matched' then p_canonical_id else null end,
    match_status = case when p_action = 'matched' then 'manually_matched' else 'rejected' end
  where id = p_item_id;

  insert into public.canonical_match_decisions (
    import_id, item_id, candidate_id, status, confidence, evidence,
    matcher_version, decided_by, decided_at
  ) values (
    v_item.import_id, v_item.id,
    case when p_action = 'matched' then p_canonical_id else null end,
    case when p_action = 'matched' then 'manually_matched' else 'rejected' end,
    case when p_action = 'matched' then 1 else 0 end,
    jsonb_build_object('signal', 'manual_review'), v_run.matcher_version, auth.uid(), now()
  )
  on conflict (item_id, candidate_id, matcher_version) do update set
    status = excluded.status,
    confidence = excluded.confidence,
    evidence = excluded.evidence,
    decided_by = excluded.decided_by,
    decided_at = excluded.decided_at;

  update public.playlist_import_metrics metrics set
    auto_match_count = counts.auto_count,
    review_count = counts.review_count,
    unmatched_count = counts.unmatched_count
  from (
    select
      count(*) filter (where match_status in ('auto_matched', 'manually_matched'))::integer as auto_count,
      count(*) filter (where match_status = 'review_required')::integer as review_count,
      count(*) filter (where match_status in ('unmatched', 'rejected'))::integer as unmatched_count
    from public.normalized_playlist_items where import_id = v_item.import_id
  ) counts
  where metrics.import_id = v_item.import_id;

  select count(*) into v_review_count from public.normalized_playlist_items
    where import_id = v_item.import_id and match_status = 'review_required';
  select coalesce(jsonb_agg(blocker), '[]'::jsonb) into v_blockers
  from jsonb_array_elements(v_run.activation_blockers) blocker
  where blocker->>'code' <> 'ambiguous_match_review_pending';
  if v_review_count > 0 then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'ambiguous_match_review_pending', 'review_count', v_review_count
    ));
  end if;
  update public.playlist_import_runs set
    activation_blockers = v_blockers,
    validation_status = case when jsonb_array_length(v_blockers) = 0 then 'passed' else 'review_required' end
  where id = v_item.import_id;
end;
$$;

create or replace function public.worker_update_playlist_import(
  p_import_id uuid,
  p_status text,
  p_progress integer,
  p_stage text,
  p_error_code text default null,
  p_error_message text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.playlist_import_runs set
    status = p_status,
    progress = least(greatest(p_progress, 0), 100),
    current_stage = p_stage,
    heartbeat_at = now(),
    started_at = coalesce(started_at, now()),
    attempt_count = case when p_status = 'fetching' then attempt_count + 1 else attempt_count end,
    error_code = p_error_code,
    error_message = left(p_error_message, 1000),
    completed_at = case when p_status in ('failed', 'cancelled') then now() else completed_at end
  where id = p_import_id;
  if not found then raise exception 'import_not_found'; end if;
end;
$$;

create or replace function public.worker_finalize_playlist_import(
  p_import_id uuid,
  p_duplicate_url_count integer,
  p_parse_issue_count integer,
  p_warnings jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_raw integer;
  v_normalized integer;
  v_unknown integer;
  v_previous integer;
  v_change_ratio numeric(12,6);
  v_blockers jsonb := '[]'::jsonb;
  v_duplicate_url_count integer;
  v_review integer;
begin
  if not exists (
    select 1 from public.playlist_import_runs
    where id = p_import_id and status = 'validating'
  ) then
    raise exception 'import_not_validating';
  end if;

  select count(*) into v_raw from private.raw_playlist_entries where import_id = p_import_id;
  select count(*) into v_normalized from public.normalized_playlist_items where import_id = p_import_id;
  select count(*) into v_unknown from public.normalized_playlist_items
    where import_id = p_import_id and content_type = 'unknown';
  select count(*) into v_review from public.normalized_playlist_items
    where import_id = p_import_id and match_status = 'review_required';
  select greatest(count(*) - count(distinct stream_url_hash), 0)::integer into v_duplicate_url_count
    from private.raw_playlist_entries where import_id = p_import_id;
  if v_raw = 0 or v_normalized = 0 then raise exception 'empty_import'; end if;

  select previous_metrics.normalized_count into v_previous
  from public.playlist_import_runs run
  join public.playlists playlist on playlist.id = run.playlist_id
  left join public.playlist_import_metrics previous_metrics on previous_metrics.import_id = playlist.active_import_id
  where run.id = p_import_id;

  if v_previous is not null then
    v_change_ratio := abs(v_normalized - v_previous)::numeric / greatest(v_previous, 1);
    if v_normalized < v_previous * 0.5 then
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'catalog_drop_over_50_percent', 'previous', v_previous, 'current', v_normalized
      ));
    end if;
  end if;
  if greatest(p_parse_issue_count, 0) > greatest(100, ceil(v_raw * 0.05)::integer) then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'parse_issue_ratio_high', 'issues', greatest(p_parse_issue_count, 0), 'raw', v_raw
    ));
  end if;
  if v_unknown > v_normalized * 0.5 then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'unknown_ratio_high', 'unknown', v_unknown, 'normalized', v_normalized
    ));
  end if;
  if v_review > 0 then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'ambiguous_match_review_pending', 'review_count', v_review
    ));
  end if;

  insert into public.playlist_import_metrics (
    import_id, raw_count, normalized_count, live_count, movie_count, series_count,
    unknown_count, duplicate_url_count, parse_issue_count, auto_match_count,
    review_count, unmatched_count, previous_normalized_count, change_ratio, warnings
  )
  select
    p_import_id, v_raw, v_normalized,
    count(*) filter (where content_type = 'live'),
    count(*) filter (where content_type = 'movie'),
    count(*) filter (where content_type = 'series'),
    count(*) filter (where content_type = 'unknown'),
    greatest(v_duplicate_url_count, greatest(p_duplicate_url_count, 0)), greatest(p_parse_issue_count, 0),
    count(*) filter (where match_status in ('auto_matched', 'manually_matched')),
    count(*) filter (where match_status = 'review_required'),
    count(*) filter (where match_status in ('unmatched', 'rejected')),
    v_previous, v_change_ratio,
    coalesce(p_warnings, '[]'::jsonb)
  from public.normalized_playlist_items where import_id = p_import_id
  on conflict (import_id) do update set
    raw_count = excluded.raw_count,
    normalized_count = excluded.normalized_count,
    live_count = excluded.live_count,
    movie_count = excluded.movie_count,
    series_count = excluded.series_count,
    unknown_count = excluded.unknown_count,
    duplicate_url_count = excluded.duplicate_url_count,
    parse_issue_count = excluded.parse_issue_count,
    auto_match_count = excluded.auto_match_count,
    review_count = excluded.review_count,
    unmatched_count = excluded.unmatched_count,
    previous_normalized_count = excluded.previous_normalized_count,
    change_ratio = excluded.change_ratio,
    warnings = excluded.warnings;

  update public.playlist_import_runs set
    status = 'ready_for_activation', progress = 100, current_stage = 'ready_for_activation',
    validation_status = case when jsonb_array_length(v_blockers) = 0 then 'passed' else 'review_required' end,
    activation_blockers = v_blockers,
    heartbeat_at = now(), completed_at = now(), error_code = null, error_message = null
  where id = p_import_id;
end;
$$;

create or replace function public.promote_playlist_import(
  p_import_id uuid,
  p_force boolean default false,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.playlist_import_runs%rowtype;
  v_previous uuid;
begin
  select * into v_run from public.playlist_import_runs where id = p_import_id for update;
  if v_run.id is null then raise exception 'import_not_found'; end if;
  if v_run.status <> 'ready_for_activation' then raise exception 'import_not_ready'; end if;
  if auth.role() <> 'service_role' and auth.uid() <> v_run.user_id and not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if v_run.validation_status = 'review_required' and not p_force then
    raise exception 'activation_requires_review';
  end if;
  if p_force then
    if auth.role() <> 'service_role' and not public.is_admin() then raise exception 'force_requires_admin'; end if;
    if nullif(btrim(p_reason), '') is null then raise exception 'force_reason_required'; end if;
  end if;

  select active_import_id into v_previous from public.playlists where id = v_run.playlist_id for update;
  update public.playlist_import_runs
    set status = 'superseded'
    where id = v_previous and id <> p_import_id and status = 'active';
  update public.playlists
    set active_import_id = p_import_id, status = 'ready', channel_count = (
      select normalized_count from public.playlist_import_metrics where import_id = p_import_id
    ), processed_at = now(), error_message = null
    where id = v_run.playlist_id;
  update public.playlist_import_runs
    set status = 'active', activated_at = now(), activated_by = auth.uid(),
      activation_forced = p_force, activation_reason = nullif(btrim(p_reason), ''), updated_at = now()
    where id = p_import_id;
end;
$$;

create or replace function public.rollback_playlist_import(p_playlist_id uuid, p_target_import_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target public.playlist_import_runs%rowtype;
  v_current uuid;
begin
  select * into v_target from public.playlist_import_runs
    where id = p_target_import_id and playlist_id = p_playlist_id for update;
  if v_target.id is null or v_target.status not in ('superseded', 'rolled_back') then
    raise exception 'rollback_target_invalid';
  end if;
  if auth.role() <> 'service_role' and auth.uid() <> v_target.user_id and not public.is_admin() then
    raise exception 'forbidden';
  end if;

  select active_import_id into v_current from public.playlists where id = p_playlist_id for update;
  update public.playlist_import_runs set status = 'rolled_back' where id = v_current and status = 'active';
  update public.playlist_import_runs set status = 'active', activated_at = now() where id = p_target_import_id;
  update public.playlists set
    active_import_id = p_target_import_id,
    channel_count = (select normalized_count from public.playlist_import_metrics where import_id = p_target_import_id),
    processed_at = now()
  where id = p_playlist_id;
end;
$$;

create or replace function public.cancel_playlist_import(p_import_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.playlist_import_runs%rowtype;
begin
  select * into v_run from public.playlist_import_runs where id = p_import_id for update;
  if v_run.id is null then raise exception 'import_not_found'; end if;
  if auth.uid() <> v_run.user_id and not public.is_admin() then raise exception 'forbidden'; end if;
  if v_run.status in ('active', 'superseded', 'rolled_back') then raise exception 'published_import_cannot_be_cancelled'; end if;
  if v_run.status in ('failed', 'cancelled') then return; end if;

  update public.playlist_import_runs set
    status = 'cancelled', current_stage = 'cancelled', cancelled_at = now(), completed_at = now()
  where id = p_import_id;
end;
$$;

create or replace function public.service_get_active_playlist_items(
  p_playlist_id uuid,
  p_offset integer default 0,
  p_limit integer default 1000
)
returns table (
  id uuid,
  name text,
  streams jsonb,
  group_name text,
  logo_url text,
  canonical_id text,
  content_type text,
  streaming text,
  canonical_titles jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    item.id,
    item.display_title,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'u', variant.stream_url,
        'q', variant.quality,
        'l', case
          when variant.season_number is not null and variant.episode_number is not null
            then 'S' || lpad(variant.season_number::text, 2, '0') || 'E' || lpad(variant.episode_number::text, 2, '0')
          else variant.quality
        end
      ) order by variant.season_number nulls first, variant.episode_number nulls first, variant.quality)
      from private.playlist_item_variants variant
      where variant.item_id = item.id and variant.health_status <> 'dead'
    ), '[]'::jsonb),
    item.group_title,
    item.logo_url,
    item.canonical_id,
    item.content_type,
    item.platform,
    case when canonical.id is null then null else jsonb_build_object(
      'title', canonical.title,
      'type', canonical.type,
      'streaming', canonical.streaming,
      'tmdb_id', canonical.tmdb_id,
      'year', canonical.year,
      'rating', canonical.rating,
      'overview', canonical.overview,
      'poster', canonical.poster,
      'backdrop', canonical.backdrop,
      'genres', canonical.genres,
      'director', canonical.director,
      'age_rating', canonical.age_rating,
      'duration', canonical.duration,
      'trailer_url', canonical.trailer_url
    ) end
  from public.playlists playlist
  join public.normalized_playlist_items item on item.import_id = playlist.active_import_id
  left join public.canonical_titles canonical on canonical.id = item.canonical_id
  where playlist.id = p_playlist_id
  order by item.content_type, item.id
  offset greatest(p_offset, 0)
  limit least(greatest(p_limit, 1), 1000);
$$;

create or replace function public.get_active_playlist_group_counts(p_playlist_id uuid)
returns table (
  playlist_id uuid,
  group_title text,
  content_type text,
  count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.playlists playlist
    where playlist.id = p_playlist_id
      and (playlist.user_id = auth.uid() or public.is_admin())
  ) then
    raise exception 'forbidden';
  end if;

  return query
  select item.playlist_id, coalesce(item.group_title, 'Sem grupo'), item.content_type, count(*)
  from public.playlists playlist
  join public.normalized_playlist_items item on item.import_id = playlist.active_import_id
  where playlist.id = p_playlist_id
  group by item.playlist_id, coalesce(item.group_title, 'Sem grupo'), item.content_type
  order by item.content_type, coalesce(item.group_title, 'Sem grupo');
end;
$$;

revoke all on function public.start_playlist_import(uuid, text, text, text, uuid, text, text, text, text) from public;
grant execute on function public.start_playlist_import(uuid, text, text, text, uuid, text, text, text, text) to authenticated;
revoke all on function public.store_playlist_source_secret(uuid, jsonb) from public, anon;
grant execute on function public.store_playlist_source_secret(uuid, jsonb) to authenticated;

revoke all on function public.worker_get_playlist_import(uuid) from public, anon, authenticated;
revoke all on function public.worker_claim_playlist_import(integer) from public, anon, authenticated;
revoke all on function public.worker_archive_playlist_import(bigint) from public, anon, authenticated;
revoke all on function public.worker_is_playlist_import_cancelled(uuid) from public, anon, authenticated;
revoke all on function public.worker_reset_playlist_import(uuid) from public, anon, authenticated;
revoke all on function public.worker_stage_raw_entries(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.worker_stage_normalized_items(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.worker_apply_match_decisions(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.worker_update_playlist_import(uuid, text, integer, text, text, text) from public, anon, authenticated;
revoke all on function public.worker_finalize_playlist_import(uuid, integer, integer, jsonb) from public, anon, authenticated;

grant execute on function public.worker_get_playlist_import(uuid) to service_role;
grant execute on function public.worker_claim_playlist_import(integer) to service_role;
grant execute on function public.worker_archive_playlist_import(bigint) to service_role;
grant execute on function public.worker_is_playlist_import_cancelled(uuid) to service_role;
grant execute on function public.worker_reset_playlist_import(uuid) to service_role;
grant execute on function public.worker_stage_raw_entries(uuid, jsonb) to service_role;
grant execute on function public.worker_stage_normalized_items(uuid, jsonb) to service_role;
grant execute on function public.worker_apply_match_decisions(uuid, text, jsonb) to service_role;
grant execute on function public.worker_update_playlist_import(uuid, text, integer, text, text, text) to service_role;
grant execute on function public.worker_finalize_playlist_import(uuid, integer, integer, jsonb) to service_role;

revoke all on function public.promote_playlist_import(uuid, boolean, text) from public, anon;
revoke all on function public.rollback_playlist_import(uuid, uuid) from public, anon;
revoke all on function public.cancel_playlist_import(uuid) from public, anon;
revoke all on function public.resolve_playlist_identity(uuid, text, text) from public, anon;
revoke all on function public.service_get_active_playlist_items(uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.get_active_playlist_group_counts(uuid) from public, anon;
grant execute on function public.promote_playlist_import(uuid, boolean, text) to authenticated, service_role;
grant execute on function public.rollback_playlist_import(uuid, uuid) to authenticated, service_role;
grant execute on function public.cancel_playlist_import(uuid) to authenticated, service_role;
grant execute on function public.resolve_playlist_identity(uuid, text, text) to authenticated, service_role;
grant execute on function public.service_get_active_playlist_items(uuid, integer, integer) to service_role;
grant execute on function public.get_active_playlist_group_counts(uuid) to authenticated, service_role;
