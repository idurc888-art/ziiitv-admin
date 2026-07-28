create extension pgcrypto;

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create schema vault;
create schema pgmq;
create schema storage;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text
);

create function auth.uid() returns uuid language sql stable as 'select null::uuid';
create function auth.role() returns text language sql stable as 'select null::text';

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
create function storage.foldername(text) returns text[] language sql immutable
as 'select string_to_array($1, ''/'')';

