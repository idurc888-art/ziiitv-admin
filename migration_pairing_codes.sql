-- ============================================
-- MIGRATION: Adicionar pairing_codes
-- ============================================

-- Tabela de códigos de pareamento
CREATE TABLE IF NOT EXISTS public.pairing_codes (
  code TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '30 days',
  last_used_at TIMESTAMPTZ
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_pairing_codes_user_id ON public.pairing_codes(user_id);
CREATE INDEX IF NOT EXISTS idx_pairing_codes_expires_at ON public.pairing_codes(expires_at);

-- RLS
ALTER TABLE public.pairing_codes ENABLE ROW LEVEL SECURITY;

-- Usuários veem apenas seus códigos
CREATE POLICY "Users can view own codes" ON public.pairing_codes
  FOR SELECT USING (auth.uid() = user_id);

-- Admins veem tudo
CREATE POLICY "Admins can view all codes" ON public.pairing_codes
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'
    )
  );
