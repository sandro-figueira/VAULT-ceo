// Authentication Service
import { supabase, setRememberSession } from '@/lib/supabase'
import type { SignupInput, LoginInput } from '@/lib/validations'
import type { User } from '@/types'

export const authService = {
  /**
   * Sign up a new user (email + password).
   * The full name is sent as user metadata so the database trigger can persist
   * it onto the profile row automatically.
   */
  async signup(data: SignupInput) {
    const { email, password, fullName, companyName } = data

    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        // Stored on auth.users.raw_user_meta_data → read by handle_new_user().
        data: { full_name: fullName ?? null, company_name: companyName ?? null },
        // Email-confirmation links return to the app on any environment.
        emailRedirectTo: `${window.location.origin}/dashboard`,
      },
    })

    if (authError) throw authError

    // Best-effort: if the profile already exists (trigger ran), fill in extras.
    if (authData.user && (fullName || companyName)) {
      const { error: profileError } = await supabase
        .from('profiles')
        .update({ full_name: fullName, company_name: companyName } as any)
        .eq('id', authData.user.id)
      if (profileError) console.error('Profile update error:', profileError.message)
    }

    return authData
  },

  /**
   * Login with email + password.
   * @param remember when false, the session is kept only for the browser session.
   */
  async login(data: LoginInput, remember = true) {
    const { email, password } = data

    // Must run BEFORE sign-in so the session token is written to the chosen storage.
    setRememberSession(remember)

    const { data: authData, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) throw error
    return authData
  },

  /**
   * Login with Google (optional — the app works fully without it).
   */
  async loginWithGoogle() {
    setRememberSession(true)
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        // origin-based → works on localhost and on the Vercel domain alike.
        redirectTo: `${window.location.origin}/dashboard`,
      },
    })

    if (error) throw error
    return data
  },

  /**
   * Logout user
   */
  async logout() {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  },

  /**
   * Get current session
   */
  async getSession() {
    const { data, error } = await supabase.auth.getSession()
    if (error) throw error
    return data.session
  },

  /**
   * Get current user
   */
  async getCurrentUser(): Promise<User | null> {
    const { data: { user }, error } = await supabase.auth.getUser()

    if (error || !user) return null

    // Get profile data
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single()

    return {
      id: user.id,
      email: user.email!,
      fullName: profile?.full_name || null,
      companyName: profile?.company_name || null,
      phone: profile?.phone || null,
    }
  },

  /**
   * Update user profile
   */
  async updateProfile(userId: string, updates: Partial<User>) {
    const { error } = await supabase
      .from('profiles')
      .update({
        full_name: updates.fullName,
        company_name: updates.companyName,
        phone: updates.phone,
      } as any)
      .eq('id', userId)

    if (error) throw error
  },

  /**
   * Reset password
   */
  async resetPassword(email: string) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })

    if (error) throw error
  },

  /**
   * Update password
   */
  async updatePassword(newPassword: string) {
    const { error } = await supabase.auth.updateUser({
      password: newPassword,
    })

    if (error) throw error
  },
}
