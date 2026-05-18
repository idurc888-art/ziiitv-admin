-- Admin (usuário autenticado) pode ler playlist_content de suas próprias playlists
CREATE POLICY "owner select authenticated" ON playlist_content
  FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM playlists WHERE id = playlist_id AND user_id = auth.uid())
  );
