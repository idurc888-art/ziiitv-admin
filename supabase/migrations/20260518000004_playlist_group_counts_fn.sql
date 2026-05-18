CREATE OR REPLACE FUNCTION get_playlist_group_counts(p_playlist_id UUID)
RETURNS TABLE (group_title TEXT, content_type TEXT, playlist_id UUID, count BIGINT)
LANGUAGE SQL SECURITY DEFINER
SET search_path = public
AS $$
  SELECT group_title, content_type, playlist_id, COUNT(*) AS count
  FROM playlist_content
  WHERE playlist_id = p_playlist_id
    AND group_title != ''
  GROUP BY group_title, content_type, playlist_id
  ORDER BY count DESC;
$$;
