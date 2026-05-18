-- Adiciona 'xtream_group' e 'canonical' (legado) aos tipos válidos de home_sections
ALTER TABLE public.home_sections
  DROP CONSTRAINT IF EXISTS home_sections_type_check;

ALTER TABLE public.home_sections
  ADD CONSTRAINT home_sections_type_check CHECK (
    type IN (
      'by_streaming',
      'live_featured',
      'continue_watching',
      'recently_added',
      'editorial',
      'canonical',
      'canonical_movies',
      'canonical_series',
      'xtream_group'
    )
  );
