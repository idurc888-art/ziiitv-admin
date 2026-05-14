import { createClient } from '@supabase/supabase-js'

const supabaseUrl      = import.meta.env.VITE_SUPABASE_URL         as string
const supabaseAnonKey  = import.meta.env.VITE_SUPABASE_ANON_KEY    as string
const supabaseAdminKey = import.meta.env.VITE_SUPABASE_SERVICE_KEY as string

// ── Singleton anon client (auth persistido no localStorage) ─────────────────
let _supabase: ReturnType<typeof createClient> | null = null
export function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        storageKey: 'ziiitv-admin-auth',   // chave única — evita Multiple GoTrueClient
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  }
  return _supabase
}
export const supabase = getSupabase()

// ── Admin client separado, SEM persistência de sessão ───────────────────────
// Usa storageKey diferente para nunca conflitar com o anon client
let _supabaseAdmin: ReturnType<typeof createClient> | null = null
export function getSupabaseAdmin() {
  if (!_supabaseAdmin) {
    _supabaseAdmin = createClient(supabaseUrl, supabaseAdminKey || supabaseAnonKey, {
      auth: {
        storageKey: 'ziiitv-admin-service',  // chave diferente do anon
        persistSession: false,
        autoRefreshToken: false,
      },
    })
  }
  return _supabaseAdmin
}
export const supabaseAdmin = getSupabaseAdmin()
