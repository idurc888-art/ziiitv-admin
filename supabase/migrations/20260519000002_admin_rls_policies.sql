-- Função helper para checar se o usuário atual é admin
-- SECURITY DEFINER: roda como owner do DB, sem recursão de RLS
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

-- ── users ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_self_read"  ON public.users;
DROP POLICY IF EXISTS "users_admin_read" ON public.users;

CREATE POLICY "users_self_read"  ON public.users FOR SELECT USING (id = auth.uid());
CREATE POLICY "users_admin_read" ON public.users FOR SELECT USING (public.is_admin());

-- ── channels ──────────────────────────────────────────────────────────────────
ALTER TABLE public.channels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "channels_own_read"   ON public.channels;
DROP POLICY IF EXISTS "channels_admin_read" ON public.channels;
DROP POLICY IF EXISTS "channels_own_write"  ON public.channels;
DROP POLICY IF EXISTS "channels_admin_write" ON public.channels;

CREATE POLICY "channels_own_read"    ON public.channels FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "channels_admin_read"  ON public.channels FOR SELECT USING (public.is_admin());
CREATE POLICY "channels_own_write"   ON public.channels FOR ALL    USING (user_id = auth.uid());
CREATE POLICY "channels_admin_write" ON public.channels FOR ALL    USING (public.is_admin());

-- ── watch_history ─────────────────────────────────────────────────────────────
ALTER TABLE public.watch_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "watch_history_own_read"   ON public.watch_history;
DROP POLICY IF EXISTS "watch_history_admin_read" ON public.watch_history;
DROP POLICY IF EXISTS "watch_history_own_write"  ON public.watch_history;

CREATE POLICY "watch_history_own_read"   ON public.watch_history FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "watch_history_admin_read" ON public.watch_history FOR SELECT USING (public.is_admin());
CREATE POLICY "watch_history_own_write"  ON public.watch_history FOR ALL    USING (user_id = auth.uid());

-- ── canonical_titles ──────────────────────────────────────────────────────────
ALTER TABLE public.canonical_titles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "canonical_titles_public_read" ON public.canonical_titles;
DROP POLICY IF EXISTS "canonical_titles_admin_write" ON public.canonical_titles;

CREATE POLICY "canonical_titles_public_read" ON public.canonical_titles FOR SELECT USING (true);
CREATE POLICY "canonical_titles_admin_write" ON public.canonical_titles FOR ALL    USING (public.is_admin());
