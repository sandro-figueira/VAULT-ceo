// Protected Route Component
import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'

interface ProtectedRouteProps {
  children: React.ReactNode
}

const isOAuthCallbackInProgress = () => {
  const params = new URLSearchParams(window.location.search)
  return (
    window.location.hash.includes('access_token') ||
    params.has('code') ||
    params.has('error')
  )
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session && isOAuthCallbackInProgress()) {
        return
      }
      setIsAuthenticated(!!session)
    }).catch(error => {
      console.error('Session check failed:', error)
      if (!isOAuthCallbackInProgress()) {
        setIsAuthenticated(false)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
          setIsAuthenticated(true)
        } else if (event === 'SIGNED_OUT') {
          setIsAuthenticated(false)
        } else if (event === 'INITIAL_SESSION') {
          // Don't bounce to /signup while an OAuth code/token is still being
          // exchanged — wait for the resulting SIGNED_IN event.
          if (!session && isOAuthCallbackInProgress()) return
          setIsAuthenticated(!!session)
        }
      }
    )

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  if (isAuthenticated === null) {
    // Loading state
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-16 h-16 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/signup" replace />
  }

  return <>{children}</>
}
