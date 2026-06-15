// Supabase Client Configuration
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

// The app uses EXCLUSIVELY these two env vars — no hardcoded URLs/domains.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase environment variables. Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.'
  )
}

// Ensure the URL has a protocol (accepts "ref.supabase.co" or full URL).
const url = supabaseUrl.startsWith('http') ? supabaseUrl : `https://${supabaseUrl}`

// "Lembrar sessão" support: when the user opts out, the session token is stored
// in sessionStorage (cleared when the browser closes) instead of localStorage.
// The flag itself is a non-sensitive preference. Falls back gracefully if web
// storage is unavailable (SSR/build).
const REMEMBER_FLAG = 'vault.remember'

export function setRememberSession(remember: boolean) {
  try { localStorage.setItem(REMEMBER_FLAG, remember ? 'true' : 'false') } catch { /* noop */ }
}

const sessionAwareStorage = {
  getItem: (key: string): string | null => {
    try { return localStorage.getItem(key) ?? sessionStorage.getItem(key) } catch { return null }
  },
  setItem: (key: string, value: string): void => {
    try {
      if (localStorage.getItem(REMEMBER_FLAG) === 'false') {
        sessionStorage.setItem(key, value)
        localStorage.removeItem(key)
      } else {
        localStorage.setItem(key, value)
        sessionStorage.removeItem(key)
      }
    } catch { /* noop */ }
  },
  removeItem: (key: string): void => {
    try { localStorage.removeItem(key); sessionStorage.removeItem(key) } catch { /* noop */ }
  },
}

export const supabase = createClient<Database>(url, supabaseAnonKey, {
  auth: {
    storage: sessionAwareStorage,
    autoRefreshToken: true,   // refresh expiring tokens automatically
    persistSession: true,     // keep the user logged in across reloads
    detectSessionInUrl: true, // handle the OAuth redirect (?code=) automatically
    flowType: 'pkce',
  },
})
