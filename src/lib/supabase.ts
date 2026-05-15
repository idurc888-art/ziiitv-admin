import { createClient } from '@supabase/supabase-js'

const supabaseUrl      = import.meta.env.VITE_SUPABASE_URL         as string
const supabaseAnonKey  = import.meta.env.VITE_SUPABASE_ANON_KEY    as string
const supabaseAdminKey = import.meta.env.VITE_SUPABASE_SERVICE_KEY as string

// ── Singleton anon client (auth persistido no localStorage) ─────────────────
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

// ── Admin client separado, SEM persistência de sessão ───────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _supabaseAdmin: any = null
export function getSupabaseAdmin() {
  if (!_supabaseAdmin) {
    _supabaseAdmin = createClient(supabaseUrl, supabaseAdminKey || supabaseAnonKey, {
      auth: {
        storageKey: 'ziiitv-admin-service',
        persistSession: false,
        autoRefreshToken: false,
      },
    })
  }
  return _supabaseAdmin
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const supabaseAdmin: any = getSupabaseAdmin()
