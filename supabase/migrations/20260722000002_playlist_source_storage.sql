insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'playlist-sources', 'playlist-sources', false, 524288000,
  array['audio/x-mpegurl', 'application/vnd.apple.mpegurl', 'application/octet-stream', 'text/plain']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists playlist_sources_owner_insert on storage.objects;
drop policy if exists playlist_sources_owner_read on storage.objects;
drop policy if exists playlist_sources_owner_delete on storage.objects;

create policy playlist_sources_owner_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'playlist-sources' and (storage.foldername(name))[1] = auth.uid()::text);

create policy playlist_sources_owner_read on storage.objects
  for select to authenticated
  using (bucket_id = 'playlist-sources' and (storage.foldername(name))[1] = auth.uid()::text);

create policy playlist_sources_owner_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'playlist-sources' and (storage.foldername(name))[1] = auth.uid()::text);
