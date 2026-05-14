export const globalChannelCache: Record<string, any[]> = {}
export const globalPlaylistCache: Record<string, any> = {}

export function updateChannelInCache(playlistId: string | null, channelId: string, updates: any) {
  if (!playlistId || !globalChannelCache[playlistId]) return;
  globalChannelCache[playlistId] = globalChannelCache[playlistId].map(ch => 
     ch.id === channelId 
      ? { ...ch, ...updates, canonical_titles: { ...ch.canonical_titles, ...updates.canonical_titles } } 
      : ch
  )
}
