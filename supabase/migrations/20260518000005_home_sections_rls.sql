-- home_sections e homes: acesso total para usuários autenticados no admin panel
-- O admin panel já controla quem pode logar, então authenticated = admin

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'home_sections' AND policyname = 'Authenticated full access home_sections'
  ) THEN
    CREATE POLICY "Authenticated full access home_sections"
      ON public.home_sections FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
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
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
