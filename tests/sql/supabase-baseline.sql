create extension pgcrypto;
create role anon;
create role authenticated;
create role service_role;

create schema auth;
create schema vault;
create schema pgmq;
create schema storage;

create table public.users (
  id uuid primary key default gen_random_uuid(),
  role text
);
create table public.playlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id),
  url_original text not null default '',
  status text,
  channel_count integer,
  processed_at timestamptz,
  error_message text
);
create table public.canonical_titles (
  id text primary key,
  title text,
  type text,
  streaming text,
  tmdb_id integer,
  year text,
  rating numeric,
  overview text,
  poster text,
  backdrop text,
  genres text[],
  director text,
  age_rating text,
  duration integer,
  trailer_url text,
  alt_titles text[] default '{}',
  match_hints text[] default '{}'
);

create function auth.uid() returns uuid language sql stable as 'select null::uuid';
create function auth.role() returns text language sql stable as 'select null::text';
create function public.is_admin() returns boolean language sql stable as 'select false';

create table vault.decrypted_secrets (id uuid primary key, decrypted_secret text);
create function vault.create_secret(text, text, text) returns uuid language sql as 'select gen_random_uuid()';

create function pgmq.create(text) returns void language sql as 'select';
create function pgmq.send(text, jsonb) returns bigint language sql as 'select 1::bigint';
create function pgmq.read(text, integer, integer)
returns table(msg_id bigint, read_ct integer, enqueued_at timestamptz, vt timestamptz, message jsonb)
language sql as 'select null::bigint, null::integer, null::timestamptz, null::timestamptz, null::jsonb where false';
create function pgmq.archive(text, bigint) returns boolean language sql as 'select true';

create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null,
  name text not null
);
create function storage.foldername(text) returns text[] language sql immutable as 'select string_to_array($1, ''/'')';
