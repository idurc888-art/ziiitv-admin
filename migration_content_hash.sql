-- ============================================
-- MIGRATION: content_hash para dedup de playlists
-- ============================================

ALTER TABLE public.playlists
  ADD COLUMN IF NOT EXISTS content_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_playlists_content_hash
  ON public.playlists(content_hash)
  WHERE content_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_playlists_url_original
  ON public.playlists(url_original);

-- ============================================
-- MIGRATION: campos TMDB em canonical_titles
-- Opção A: poster/backdrop salvos como PATH relativo (/abc.jpg)
-- A TV monta a URL: https://image.tmdb.org/t/p/w342{path}
-- ============================================

ALTER TABLE public.canonical_titles
  ADD COLUMN IF NOT EXISTS backdrop  TEXT,     -- path relativo TMDB ex: /abc123.jpg
  ADD COLUMN IF NOT EXISTS overview  TEXT,
  ADD COLUMN IF NOT EXISTS tmdb_id   INTEGER,
  ADD COLUMN IF NOT EXISTS year      TEXT,
  ADD COLUMN IF NOT EXISTS priority  BOOLEAN DEFAULT FALSE;

-- Índice para busca por streaming
CREATE INDEX IF NOT EXISTS idx_canonical_titles_streaming
  ON public.canonical_titles(streaming);

-- ============================================
-- MIGRATION: campos streaming/content_type em channels
-- ============================================

ALTER TABLE public.channels
  ADD COLUMN IF NOT EXISTS streaming    TEXT,
  ADD COLUMN IF NOT EXISTS content_type TEXT;

-- ============================================
-- MIGRATION: FK channels → playlists com CASCADE
-- DECLARE deve vir antes de BEGIN em PL/pgSQL
-- ============================================

DO $$
DECLARE
  fk_name TEXT;
BEGIN
  SELECT conname INTO fk_name
    FROM pg_constraint
   WHERE conrelid  = 'public.channels'::regclass
     AND confrelid = 'public.playlists'::regclass
     AND contype   = 'f'
   LIMIT 1;

  IF fk_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.channels DROP CONSTRAINT ' || quote_ident(fk_name);
  END IF;
END $$;

ALTER TABLE public.channels
  ADD CONSTRAINT fk_channels_playlist
  FOREIGN KEY (playlist_id)
  REFERENCES public.playlists(id)
  ON DELETE CASCADE;

-- ============================================
-- MIGRATION: FK watch_events → channels com SET NULL
-- ============================================

DO $$
DECLARE
  fk_name TEXT;
BEGIN
  SELECT conname INTO fk_name
    FROM pg_constraint
   WHERE conrelid  = 'public.watch_events'::regclass
     AND confrelid = 'public.channels'::regclass
     AND contype   = 'f'
   LIMIT 1;

  IF fk_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.watch_events DROP CONSTRAINT ' || quote_ident(fk_name);
  END IF;
END $$;

ALTER TABLE public.watch_events
  ADD CONSTRAINT fk_watch_events_channel
  FOREIGN KEY (channel_id)
  REFERENCES public.channels(id)
  ON DELETE SET NULL;
