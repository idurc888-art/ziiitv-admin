-- ============================================================
-- Migration Enterprise: Multi-Home Manager
-- Resolve: schema, RLS, e link playlist↔home
-- ============================================================

-- 1. Adiciona config JSONB ao home_sections (bug raiz — coluna faltando)
ALTER TABLE public.home_sections 
  ADD COLUMN IF NOT EXISTS config JSONB DEFAULT NULL;

-- 2. Linka cada playlist a uma home específica
ALTER TABLE public.playlists
  ADD COLUMN IF NOT EXISTS home_id UUID REFERENCES public.homes(id) ON DELETE SET NULL;

-- 3. RLS: Admin pode ler e escrever em playlist_content (para o HomeEditor funcionar)
-- Não remove as policies existentes de owner — adiciona as de admin
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'playlist_content' AND policyname = 'Admins can view all playlist_content'
  ) THEN
    CREATE POLICY "Admins can view all playlist_content"
      ON public.playlist_content FOR SELECT
      USING (
        EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin')
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'playlist_content' AND policyname = 'Admins can modify all playlist_content'
  ) THEN
    CREATE POLICY "Admins can modify all playlist_content"
      ON public.playlist_content FOR ALL
      USING (
        EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin')
      );
  END IF;
END $$;

-- 4. RLS: Admin pode atualizar playlists de qualquer usuário
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'playlists' AND policyname = 'Admins can update all playlists'
  ) THEN
    CREATE POLICY "Admins can update all playlists"
      ON public.playlists FOR UPDATE
      USING (
        EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin')
      );
  END IF;
END $$;

-- 5. RLS: Admin pode ver todas as playlists (SELECT)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'playlists' AND policyname = 'Admins can view all playlists'
  ) THEN
    CREATE POLICY "Admins can view all playlists"
      ON public.playlists FOR SELECT
      USING (
        EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin')
      );
  END IF;
END $$;
