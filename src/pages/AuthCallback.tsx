// OAuth Callback Page
//
// Dedicated landing page for the OAuth (PKCE) redirect. Google → Supabase
// redirects here with a `?code=...` (or `?error=...`). The Supabase client
// (detectSessionInUrl: true) exchanges the code for a session automatically;
// this page waits for that to finish, surfaces any error, and only then routes
// the user to the dashboard. Keeping this OUT of <ProtectedRoute> avoids the
// route guard redirecting away and discarding the code mid-exchange.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'

const AuthCallback = () => {
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    // Supabase forwards provider errors as query params (e.g. access_denied).
    const providerError = params.get('error_description') || params.get('error')
    if (providerError) {
      setError(decodeURIComponent(providerError))
      return
    }

    let settled = false
    const goToDashboard = () => {
      if (settled) return
      settled = true
      navigate('/dashboard', { replace: true })
    }

    // The session may already be ready (detectSessionInUrl exchanged the code).
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) goToDashboard()
    })

    // Otherwise wait for the exchange to complete.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session) {
        goToDashboard()
      }
    })

    // Fallback: if no session materializes, the exchange failed (bad/expired
    // code, redirect URL not allow-listed in Supabase…). Show a friendly error
    // instead of bouncing silently.
    const timer = setTimeout(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (session) {
        goToDashboard()
      } else if (!settled) {
        setError('Não foi possível concluir o login. Tente novamente.')
      }
    }, 8000)

    return () => {
      subscription.unsubscribe()
      clearTimeout(timer)
    }
  }, [navigate])

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      {error ? (
        <div className="text-center space-y-4 max-w-sm">
          <p className="text-lg font-medium">Não foi possível entrar</p>
          <p className="text-sm text-muted-foreground">{error}</p>
          <button
            onClick={() => navigate('/login', { replace: true })}
            className="text-sm text-primary font-semibold hover:underline"
          >
            Voltar para o login
          </button>
        </div>
      ) : (
        <div className="text-center space-y-3">
          <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin mx-auto" />
          <p className="text-sm text-muted-foreground">Concluindo login...</p>
        </div>
      )}
    </div>
  )
}

export default AuthCallback
