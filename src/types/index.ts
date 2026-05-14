export type UserRole = 'user' | 'admin'
export type PlaylistStatus = 'pending' | 'processing' | 'ready' | 'error'
export type ChannelQuality = '4K' | 'FHD' | 'HD' | 'SD'

export interface User {
  id: string
  email: string
  m3u_url: string | null
  role: UserRole
  last_processed: string | null
  created_at: string
  playlists?: { count: number }[]
}

export interface Playlist {
  id: string
  user_id: string
  url_original: string
  status: PlaylistStatus
  channel_count: number
  error_message: string | null
  processed_at: string | null
  created_at: string
  users?: Pick<User, 'email'>
}

export interface Channel {
  id: string
  playlist_id: string
  user_id: string
  name: string
  stream_url: string
  group_name: string | null
  logo_url: string | null
  canonical_id: string | null
  quality: ChannelQuality | null
  active: boolean
  created_at: string
}

export interface WatchEvent {
  id: number
  user_id: string
  channel_id: string | null
  channel_name: string
  duration_seconds: number
  progress_pct: number
  watched_at: string
  users?: Pick<User, 'email'>
  channels?: Pick<Channel, 'name' | 'group_name'>
}
