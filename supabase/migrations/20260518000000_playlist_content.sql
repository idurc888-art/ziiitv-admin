-- Catálogo de conteúdo sincronizado pela TV após carregar M3U Xtream
-- A TV é o único cliente com IP residencial capaz de baixar a lista
CREATE TABLE IF NOT EXISTS playlist_content (
  id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  playlist_id     uuid        NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  logo_url        text        NOT NULL DEFAULT '',
  group_title     text        NOT NULL DEFAULT '',
  content_type    text        NOT NULL CHECK (content_type IN ('live', 'movie', 'series')),
  stream_id       text        NOT NULL DEFAULT '',
  episode_count   int         NOT NULL DEFAULT 1,
  synced_at       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS playlist_content_unique
  ON playlist_content (playlist_id, content_type, name);

CREATE INDEX IF NOT EXISTS playlist_content_playlist_id
  ON playlist_content (playlist_id);

CREATE INDEX IF NOT EXISTS playlist_content_type
  ON playlist_content (playlist_id, content_type);

-- Modo de apresentação: auto = usa categoryMapper, curated = usa shows do admin
ALTER TABLE playlists
  ADD COLUMN IF NOT EXISTS presentation_mode text NOT NULL DEFAULT 'auto'
    CHECK (presentation_mode IN ('auto', 'curated')),
  ADD COLUMN IF NOT EXISTS last_synced_at    timestamptz,
  ADD COLUMN IF NOT EXISTS content_count     int NOT NULL DEFAULT 0;

-- RLS: só o dono da playlist pode ver/modificar seu conteúdo
ALTER TABLE playlist_content ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner read"  ON playlist_content FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM playlists WHERE id = playlist_id AND user_id = auth.uid())
  );

CREATE POLICY "owner write" ON playlist_content FOR ALL
  USING (
    EXISTS (SELECT 1 FROM playlists WHERE id = playlist_id AND user_id = auth.uid())
  );
