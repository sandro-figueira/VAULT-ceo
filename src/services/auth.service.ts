// Authentication Service
import { supabase } from '@/lib/supabase'
import type { SignupInput, LoginInput } from '@/lib/validations'
import type { User } from '@/types'

export const authService = {
  /**
   * Sign up a new user
   */
  async signup(data: SignupInput) {
    const { email, password, fullName, companyName } = data

    // Create auth user
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
    })

    if (authError) throw authError

    // Update profile with additional info
    if (authData.user && (fullName || companyName)) {
      const { error: profileError } = await supabase
        .from('profiles')
        .update({
          full_name: fullName,
          company_name: companyName,
        } as any)
        .eq('id', authData.user.id)

      if (profileError) console.error('Profile update error:', profileError)
    }

    return authData
  },

  /**
   * Login user
   */
  async login(data: LoginInput) {
    const { email, password } = data

    console.log('Attempting login for:', email)
    const { data: authData, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      console.error('Login error:', error)
      throw error
    }

    console.log('Login successful', authData)
    return authData
  },

  /**
   * Login with Google
   */
  async loginWithGoogle() {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        // Land on a dedicated callback page (NOT a protected route) so the PKCE
        // code is exchanged deterministically before any auth guard runs.
        // origin-based → works on localhost and on the Vercel domain alike.
        redirectTo: `${window.location.origin}/auth/callback`
      }
    })

    if (error) {
      console.error('Google login error:', error)
      throw error
    }

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
