-- Função chamada pela Edge Function link-playlist para fazer batch UPDATE
-- em um único statement SQL em vez de N requests individuais.
CREATE OR REPLACE FUNCTION link_channels_to_catalog(p_updates JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE channels c
  SET canonical_id = u.canonical_id
  FROM jsonb_to_recordset(p_updates) AS u(id UUID, canonical_id TEXT)
  WHERE c.id = u.id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
