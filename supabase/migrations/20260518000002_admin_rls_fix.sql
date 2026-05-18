-- Migration para liberar acesso total dos administradores às playlists e conteúdos
-- (Necessário para o HomeEditor funcionar corretamente sem bypass inseguro)

-- 1. Playlist Content: Admins podem ler tudo
CREATE POLICY "Admins can view all playlist_content" 
  ON public.playlist_content FOR SELECT 
  USING (
    EXISTS (
      SELECT 1 FROM public.users 
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- 2. Playlist Content: Admins podem modificar tudo (importar/upsert)
CREATE POLICY "Admins can modify all playlist_content" 
  ON public.playlist_content FOR ALL 
  USING (
    EXISTS (
      SELECT 1 FROM public.users 
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- 3. Playlists: Admins podem atualizar (update last_synced_at, content_count)
CREATE POLICY "Admins can update all playlists" 
  ON public.playlists FOR UPDATE 
  USING (
    EXISTS (
      SELECT 1 FROM public.users 
      WHERE id = auth.uid() AND role = 'admin'
    )
  );
