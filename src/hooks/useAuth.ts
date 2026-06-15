// Re-exported from the AuthProvider so existing `@/hooks/useAuth` imports keep
// working while sharing a single auth context/state across the app.
export { useAuth } from '@/contexts/AuthContext'
