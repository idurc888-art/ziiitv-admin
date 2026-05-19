-- Canais EPG
CREATE TABLE IF NOT EXISTS public.epg_channels (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  icon_url    text,
  normalized  text,
  updated_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS epg_channels_normalized ON public.epg_channels(normalized);

-- Grade de programação
CREATE TABLE IF NOT EXISTS public.epg_schedules (
  id                 bigserial PRIMARY KEY,
  channel_id         text NOT NULL,
  channel_normalized text,
  start_ts           bigint NOT NULL,
  stop_ts            bigint NOT NULL,
  title              text NOT NULL,
  description        text
);

CREATE INDEX IF NOT EXISTS epg_schedules_lookup ON public.epg_schedules(channel_normalized, start_ts, stop_ts);

-- RLS: leitura pública, escrita apenas para autenticados (admin)
ALTER TABLE public.epg_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.epg_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "epg_channels_read"  ON public.epg_channels  FOR SELECT USING (true);
CREATE POLICY "epg_channels_write" ON public.epg_channels  FOR ALL    USING (auth.role() = 'authenticated');
CREATE POLICY "epg_schedules_read" ON public.epg_schedules FOR SELECT USING (true);
CREATE POLICY "epg_schedules_write" ON public.epg_schedules FOR ALL   USING (auth.role() = 'authenticated');
