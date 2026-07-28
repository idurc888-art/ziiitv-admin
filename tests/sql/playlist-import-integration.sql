\set ON_ERROR_STOP on
begin;

create or replace function auth.uid() returns uuid language sql stable
as $$ select '11111111-1111-1111-1111-111111111111'::uuid $$;
create or replace function auth.role() returns text language sql stable
as $$ select 'authenticated'::text $$;

insert into public.users (id, role) values ('11111111-1111-1111-1111-111111111111', 'admin');
insert into public.playlists (id, user_id, url_original, status, channel_count)
values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Fixture', 'ready', 0);
insert into public.canonical_titles (id, title, type, year)
values ('fixture-movie-3', 'Filme 3', 'movie', '2020');

do $$
declare
  v_first uuid;
  v_repeat uuid;
  v_second uuid;
  v_active uuid;
  v_status text;
  v_validation text;
  v_blocked boolean := false;
  v_count integer;
begin
  v_first := public.start_playlist_import(
    '22222222-2222-2222-2222-222222222222', 'm3u', 'file', '11111111-1111-1111-1111-111111111111/fixture/first.m3u',
    null, 'sha256:first', 'fixture:first', 'qi220-1', 'qi220-1'
  );
  v_repeat := public.start_playlist_import(
    '22222222-2222-2222-2222-222222222222', 'm3u', 'file', '11111111-1111-1111-1111-111111111111/fixture/first.m3u',
    null, 'sha256:first', 'fixture:first', 'qi220-1', 'qi220-1'
  );
  if v_first <> v_repeat then raise exception 'idempotency_failed'; end if;

  perform public.worker_update_playlist_import(v_first, 'fetching', 5, 'fetching');
  perform public.worker_reset_playlist_import(v_first);
  perform public.worker_update_playlist_import(v_first, 'parsing', 30, 'streaming_pipeline');
  perform public.worker_stage_raw_entries(v_first, jsonb_build_array(
    jsonb_build_object('id','raw:1','source','m3u','order',1,'rawName','Canal 1','url','https://example.test/1.ts','sourceType','live'),
    jsonb_build_object('id','raw:2','source','m3u','order',2,'rawName','Canal 2','url','https://example.test/2.ts','sourceType','live'),
    jsonb_build_object('id','raw:3','source','m3u','order',3,'rawName','Filme 3','url','https://example.test/3.mp4','sourceType','movie'),
    jsonb_build_object('id','raw:4','source','m3u','order',4,'rawName','Série 4','url','https://example.test/4.mkv','sourceType','series')
  ));
  perform public.worker_stage_normalized_items(v_first, jsonb_build_array(
    jsonb_build_object('identityKey','live:1','contentType','live','displayTitle','Canal 1','matchTitle','Canal 1','titleKey','canal-1','groupTitle','Canais','classificationConfidence',1,'variants',jsonb_build_array(jsonb_build_object('rawEntryId','raw:1','url','https://example.test/1.ts','quality','HD','audioVersion','unknown'))),
    jsonb_build_object('identityKey','live:2','contentType','live','displayTitle','Canal 2','matchTitle','Canal 2','titleKey','canal-2','groupTitle','Canais','classificationConfidence',1),
    jsonb_build_object('identityKey','movie:3','contentType','movie','displayTitle','Filme 3','matchTitle','Filme 3','titleKey','filme-3','groupTitle','Filmes','classificationConfidence',1),
    jsonb_build_object('identityKey','series:4','contentType','series','displayTitle','Série 4','matchTitle','Série 4','titleKey','serie-4','groupTitle','Séries','classificationConfidence',1)
  ));
  perform public.worker_apply_match_decisions(v_first, 'qi220-1', jsonb_build_array(
    jsonb_build_object(
      'identityKey','movie:3','status','review_required','candidateId','fixture-movie-3','confidence',0.9,
      'evidence',jsonb_build_object('signal','candidate_requires_review'),
      'candidates',jsonb_build_array(jsonb_build_object('canonicalId','fixture-movie-3','confidence',0.9))
    )
  ));
  perform public.worker_update_playlist_import(v_first, 'normalizing', 55, 'streaming_normalized');
  perform public.worker_update_playlist_import(v_first, 'matching', 75, 'streaming_matched');
  perform public.worker_update_playlist_import(v_first, 'validating', 90, 'validating');
  perform public.worker_finalize_playlist_import(v_first, 0, 0, '[]');
  select validation_status into v_validation from public.playlist_import_runs where id = v_first;
  if v_validation <> 'review_required' then raise exception 'review_gate_failed:%', v_validation; end if;
  perform public.resolve_playlist_identity(
    (select id from public.normalized_playlist_items where import_id = v_first and identity_key = 'movie:3'),
    'matched', 'fixture-movie-3'
  );
  select validation_status into v_validation from public.playlist_import_runs where id = v_first;
  if v_validation <> 'passed' then raise exception 'manual_review_recalculation_failed:%', v_validation; end if;
  perform public.promote_playlist_import(v_first);
  select active_import_id into v_active from public.playlists where id = '22222222-2222-2222-2222-222222222222';
  if v_active <> v_first then raise exception 'first_activation_failed'; end if;
  select count(*) into v_count from public.service_get_active_playlist_items('22222222-2222-2222-2222-222222222222', 0, 1000);
  if v_count <> 4 then raise exception 'tv_contract_failed:%', v_count; end if;
  select count(*) into v_count from public.get_active_playlist_group_counts('22222222-2222-2222-2222-222222222222');
  if v_count <> 3 then raise exception 'group_contract_failed:%', v_count; end if;

  v_second := public.start_playlist_import(
    '22222222-2222-2222-2222-222222222222', 'm3u', 'file', '11111111-1111-1111-1111-111111111111/fixture/second.m3u',
    null, 'sha256:second', 'fixture:second', 'qi220-1', 'qi220-1'
  );
  perform public.worker_update_playlist_import(v_second, 'fetching', 5, 'fetching');
  perform public.worker_reset_playlist_import(v_second);
  perform public.worker_update_playlist_import(v_second, 'parsing', 30, 'streaming_pipeline');
  perform public.worker_stage_raw_entries(v_second, jsonb_build_array(
    jsonb_build_object('id','raw:1','source','m3u','order',1,'rawName','Canal 1','url','https://example.test/1.ts','sourceType','live')
  ));
  perform public.worker_stage_normalized_items(v_second, jsonb_build_array(
    jsonb_build_object('identityKey','live:1','contentType','live','displayTitle','Canal 1','matchTitle','Canal 1','titleKey','canal-1','classificationConfidence',1)
  ));
  perform public.worker_update_playlist_import(v_second, 'normalizing', 55, 'streaming_normalized');
  perform public.worker_update_playlist_import(v_second, 'matching', 75, 'streaming_matched');
  perform public.worker_update_playlist_import(v_second, 'validating', 90, 'validating');
  perform public.worker_finalize_playlist_import(v_second, 0, 0, '[]');
  select validation_status into v_validation from public.playlist_import_runs where id = v_second;
  if v_validation <> 'review_required' then raise exception 'drop_gate_failed:%', v_validation; end if;

  begin
    perform public.promote_playlist_import(v_second);
  exception when others then
    if sqlerrm = 'activation_requires_review' then v_blocked := true; else raise; end if;
  end;
  if not v_blocked then raise exception 'unsafe_activation_was_not_blocked'; end if;

  execute $ddl$create or replace function public.is_admin() returns boolean language sql stable as 'select true'$ddl$;
  perform public.promote_playlist_import(v_second, true, 'fixture reviewed');
  perform public.rollback_playlist_import('22222222-2222-2222-2222-222222222222', v_first);
  select active_import_id into v_active from public.playlists where id = '22222222-2222-2222-2222-222222222222';
  select status into v_status from public.playlist_import_runs where id = v_second;
  if v_active <> v_first or v_status <> 'rolled_back' then raise exception 'rollback_failed'; end if;
end;
$$;

select 'QI220_MIGRATION_INTEGRATION_OK' as result;
rollback;
