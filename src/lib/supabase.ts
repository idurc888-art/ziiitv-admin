import { createClient } from '@supabase/supabase-js'

const supabaseUrl     = import.meta.env.VITE_SUPABASE_URL      as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _supabase: any = null
export function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        storageKey: 'ziiitv-admin-auth',
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  }
  return _supabase
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const supabase: any = getSupabase()
