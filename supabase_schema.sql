-- ============================================
-- ziiiTV — Schema Completo do Supabase
-- ============================================
-- Execute este arquivo no SQL Editor do Supabase Dashboard
-- Cria: tabelas, índices, RLS, policies, triggers

-- ============================================
-- 1. EXTENSÕES
-- ============================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- 2. TABELA: users (estende auth.users)
-- ============================================
-- Metadata adicional dos usuários
CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  m3u_url TEXT,
  last_processed TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 3. TABELA: playlists
-- ============================================
CREATE TABLE IF NOT EXISTS public.playlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  url_original TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'ready', 'error')),
  channel_count INTEGER DEFAULT 0,
  error_message TEXT,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 3.1 TABELA: pairing_codes
-- ============================================
CREATE TABLE IF NOT EXISTS public.pairing_codes (
  code TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '30 days',
  last_used_at TIMESTAMPTZ
);

-- ============================================
-- 4. TABELA: channels
-- ============================================
CREATE TABLE IF NOT EXISTS public.channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id UUID NOT NULL REFERENCES public.playlists(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  streams JSONB NOT NULL DEFAULT '[]',
  group_name TEXT,
  logo_url TEXT,
  canonical_id TEXT REFERENCES public.canonical_titles(id) ON DELETE SET NULL,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 5. TABELA: canonical_titles (Catálogo de 399 títulos)
-- ============================================
CREATE TABLE IF NOT EXISTS public.canonical_titles (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  alt_titles TEXT[] DEFAULT '{}',
  type TEXT NOT NULL CHECK (type IN ('movie', 'series')),
  streaming TEXT NOT NULL,
  match_hints TEXT[] DEFAULT '{}',
  genres TEXT[] DEFAULT '{}',
  tmdb_id INTEGER,
  year TEXT,
  rating NUMERIC(3,1),
  overview TEXT,
  poster TEXT,
  backdrop TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 6. TABELA: watch_history
-- ============================================
CREATE TABLE IF NOT EXISTS public.watch_history (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  channel_id UUID REFERENCES public.channels(id) ON DELETE SET NULL,
  channel_name TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  progress_pct INTEGER DEFAULT 0 CHECK (progress_pct >= 0 AND progress_pct <= 100),
  watched_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 6. ÍNDICES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON public.users(role);

CREATE INDEX IF NOT EXISTS idx_playlists_user_id ON public.playlists(user_id);
CREATE INDEX IF NOT EXISTS idx_playlists_status ON public.playlists(status);
CREATE INDEX IF NOT EXISTS idx_playlists_created_at ON public.playlists(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pairing_codes_user_id ON public.pairing_codes(user_id);
CREATE INDEX IF NOT EXISTS idx_pairing_codes_expires_at ON public.pairing_codes(expires_at);

CREATE INDEX IF NOT EXISTS idx_canonical_titles_slug ON public.canonical_titles(slug);
CREATE INDEX IF NOT EXISTS idx_canonical_titles_streaming ON public.canonical_titles(streaming);
CREATE INDEX IF NOT EXISTS idx_canonical_titles_type ON public.canonical_titles(type);

CREATE INDEX IF NOT EXISTS idx_channels_playlist_id ON public.channels(playlist_id);
CREATE INDEX IF NOT EXISTS idx_channels_user_id ON public.channels(user_id);
CREATE INDEX IF NOT EXISTS idx_channels_canonical_id ON public.channels(canonical_id);
CREATE INDEX IF NOT EXISTS idx_channels_active ON public.channels(active);

CREATE INDEX IF NOT EXISTS idx_watch_history_user_id ON public.watch_history(user_id);
CREATE INDEX IF NOT EXISTS idx_watch_history_channel_id ON public.watch_history(channel_id);
CREATE INDEX IF NOT EXISTS idx_watch_history_watched_at ON public.watch_history(watched_at DESC);

-- ============================================
-- 7. ROW LEVEL SECURITY (RLS)
-- ============================================
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.playlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.watch_history ENABLE ROW LEVEL SECURITY;

-- ============================================
-- 8. POLICIES: users
-- ============================================
-- Usuários podem ver e atualizar seus próprios dados
CREATE POLICY "Users can view own profile" 
  ON public.users FOR SELECT 
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" 
  ON public.users FOR UPDATE 
  USING (auth.uid() = id);

-- Admins podem ver todos os usuários
CREATE POLICY "Admins can view all users" 
  ON public.users FOR SELECT 
  USING (
    EXISTS (
      SELECT 1 FROM public.users 
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- ============================================
-- 9. POLICIES: playlists
-- ============================================
-- Usuários podem ver suas próprias playlists
CREATE POLICY "Users can view own playlists" 
  ON public.playlists FOR SELECT 
  USING (auth.uid() = user_id);

-- Usuários podem inserir suas próprias playlists
CREATE POLICY "Users can insert own playlists" 
  ON public.playlists FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

-- Usuários podem atualizar suas próprias playlists
CREATE POLICY "Users can update own playlists" 
  ON public.playlists FOR UPDATE 
  USING (auth.uid() = user_id);

-- Admins podem ver todas as playlists
CREATE POLICY "Admins can view all playlists" 
  ON public.playlists FOR SELECT 
  USING (
    EXISTS (
      SELECT 1 FROM public.users 
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- ============================================
-- 10. POLICIES: channels
-- ============================================
-- Usuários podem ver seus próprios canais
CREATE POLICY "Users can view own channels" 
  ON public.channels FOR SELECT 
  USING (auth.uid() = user_id);

-- Usuários podem inserir seus próprios canais
CREATE POLICY "Users can insert own channels" 
  ON public.channels FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

-- Admins podem ver todos os canais
CREATE POLICY "Admins can view all channels" 
  ON public.channels FOR SELECT 
  USING (
    EXISTS (
      SELECT 1 FROM public.users 
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- ============================================
-- 11. POLICIES: watch_history
-- ============================================
-- Usuários podem ver seu próprio histórico
CREATE POLICY "Users can view own watch history" 
  ON public.watch_history FOR SELECT 
  USING (auth.uid() = user_id);

-- Usuários podem inserir seu próprio histórico
CREATE POLICY "Users can insert own watch history" 
  ON public.watch_history FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

-- Admins podem ver todo o histórico
CREATE POLICY "Admins can view all watch history" 
  ON public.watch_history FOR SELECT 
  USING (
    EXISTS (
      SELECT 1 FROM public.users 
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- ============================================
-- 12. TRIGGER: sync auth.users → public.users
-- ============================================
-- Quando um usuário é criado no auth.users, cria automaticamente em public.users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, role)
  VALUES (NEW.id, NEW.email, 'user')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop trigger se já existir
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Criar trigger
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ============================================
-- 13. FUNÇÃO: atualizar updated_at automaticamente
-- ============================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Aplicar trigger em users
DROP TRIGGER IF EXISTS update_users_updated_at ON public.users;
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Aplicar trigger em playlists
DROP TRIGGER IF EXISTS update_playlists_updated_at ON public.playlists;
CREATE TRIGGER update_playlists_updated_at
  BEFORE UPDATE ON public.playlists
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- FIM DO SCHEMA
-- ============================================
-- Próximos passos:
-- 1. Criar usuário admin via Authentication > Users > Add user
-- 2. Atualizar role para 'admin' na tabela users
-- 3. Testar login no app
