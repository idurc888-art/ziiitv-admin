-- home_sections e homes: somente usuários com role=admin.
-- Autenticação não equivale a autorização administrativa.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'home_sections' AND policyname = 'Authenticated full access home_sections'
  ) THEN
    CREATE POLICY "Authenticated full access home_sections"
      ON public.home_sections FOR ALL
      TO authenticated
      USING (public.is_admin())
      WITH CHECK (public.is_admin());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'homes' AND policyname = 'Authenticated full access homes'
  ) THEN
    CREATE POLICY "Authenticated full access homes"
      ON public.homes FOR ALL
      TO authenticated
      USING (public.is_admin())
      WITH CHECK (public.is_admin());
  END IF;
END $$;
