import { supabase } from '@/lib/supabase'
import type { ImportedTransaction } from '@/utils/parsers'

export const gmailService = {
  /**
   * Triggers Google OAuth requesting gmail.readonly scope.
   * Redirects back to /import?tab=gmail after consent.
   */
  async connectGmail() {
    // Flag checked on /import after OAuth returns — avoids relying on query params
    // being preserved through the Supabase redirect (they sometimes aren't).
    localStorage.setItem('gmail_oauth_pending', '1')
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        scopes: 'https://www.googleapis.com/auth/gmail.readonly',
        // Always use the live origin. Relying on VITE_APP_URL risked redirecting
        // to http://localhost:8080 in production if that env var leaked into Vercel.
        redirectTo: `${window.location.origin}/import`,
        queryParams: {
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    })
    if (error) {
      localStorage.removeItem('gmail_oauth_pending')
      throw error
    }
    return data
  },

  /**
   * Returns provider tokens from the current session.
   * provider_token = short-lived access token (~1h)
   * provider_refresh_token = long-lived, used to renew access token
   */
  async getTokens(): Promise<{ accessToken: string | null; refreshToken: string | null }> {
    const { data } = await supabase.auth.getSession()
    return {
      accessToken: data.session?.provider_token ?? null,
      refreshToken: data.session?.provider_refresh_token ?? null,
    }
  },

  /**
   * Whether the user has a Gmail token (either access or refresh).
   */
  async isConnected(): Promise<boolean> {
    const { accessToken, refreshToken } = await gmailService.getTokens()
    return !!(accessToken || refreshToken)
  },

  /**
   * Saves the refresh token to the user's profile so it persists across sessions.
   * Called automatically after OAuth redirect.
   */
  async saveRefreshToken(userId: string) {
    const { refreshToken } = await gmailService.getTokens()
    if (!refreshToken) return

    await supabase
      .from('profiles')
      .update({ gmail_refresh_token: refreshToken } as any)
      .eq('id', userId)
  },

  /**
   * Loads the persisted refresh token from the profile (fallback when session expires).
   */
  async loadRefreshToken(userId: string): Promise<string | null> {
    const { data } = await supabase
      .from('profiles')
      .select('gmail_refresh_token')
      .eq('id', userId)
      .single()
    return (data as any)?.gmail_refresh_token ?? null
  },

  /**
   * Calls the parse-gmail Edge Function.
   * Automatically uses refresh_token if access_token is missing/expired.
   * Uses incremental scan (days since last scan) when available.
   * Returns ImportedTransaction[] ready for the review table.
   */
  async parseEmails(
    userId: string,
    days = 90
  ): Promise<{ transactions: ImportedTransaction[]; scanned: number; isIncremental: boolean; effectiveDays: number }> {
    let { accessToken, refreshToken } = await gmailService.getTokens()

    // Fallback: load persisted refresh token from DB
    if (!refreshToken) {
      refreshToken = await gmailService.loadRefreshToken(userId)
    }

    if (!accessToken && !refreshToken) {
      throw new Error('Gmail não conectado. Clique em "Conectar Gmail" primeiro.')
    }

    // Incremental scan: only fetch new emails since last scan
    let effectiveDays = days
    let isIncremental = false
    if (userId) {
      const lastScanInfo = await gmailService.getLastScan(userId)
      if (lastScanInfo) {
        const msSince = Date.now() - new Date(lastScanInfo.scannedAt).getTime()
        const daysSince = Math.ceil(msSince / (1000 * 60 * 60 * 24))
        if (daysSince < days) {
          effectiveDays = Math.max(daysSince + 1, 1)
          isIncremental = true
        }
      }
    }

    const { data, error } = await supabase.functions.invoke('parse-gmail', {
      body: {
        provider_token: accessToken,
        provider_refresh_token: refreshToken,
        days: effectiveDays,
      },
    })

    if (error) throw error
    if (data?.error) throw new Error(data.error)

    // If Edge Function refreshed the token, persist the new one
    if (data?.token_refreshed && data?.new_access_token && userId) {
      // Edge Function got a new access token — save the refresh token for future use
      await gmailService.saveRefreshToken(userId)
    }

    const transactions: ImportedTransaction[] = (data.transactions ?? []).map((t: any) => ({
      date: t.date,
      amount: t.amount,
      description: t.description,
      type: t.type,
      category: t.category,
      source_id: t.source_id,
      confidence: t.confidence,
      installment: t.installment,
      isRecurring: t.isRecurring,
      raw: { source: t.source },
    }))

    // Log the scan
    await gmailService.logScan(userId, {
      days,
      emailsScanned: data.scanned ?? 0,
      transactionsFound: transactions.length,
    })

    return { transactions, scanned: data.scanned ?? 0, isIncremental, effectiveDays }
  },

  /**
   * Saves a scan log entry.
   */
  async logScan(userId: string, info: {
    days: number
    emailsScanned: number
    transactionsFound: number
    transactionsImported?: number
    durationMs?: number
  }) {
    await supabase
      .from('gmail_scan_logs' as any)
      .insert({
        user_id: userId,
        days_range: info.days,
        emails_scanned: info.emailsScanned,
        transactions_found: info.transactionsFound,
        transactions_imported: info.transactionsImported ?? 0,
        duration_ms: info.durationMs ?? null,
      })
  },

  /**
   * Gets the last scan log for the user.
   */
  async getLastScan(userId: string): Promise<{
    scannedAt: string
    emailsScanned: number
    transactionsFound: number
  } | null> {
    const { data } = await supabase
      .from('gmail_scan_logs' as any)
      .select('scanned_at, emails_scanned, transactions_found')
      .eq('user_id', userId)
      .order('scanned_at', { ascending: false })
      .limit(1)
      .single()

    if (!data) return null
    return {
      scannedAt: (data as any).scanned_at,
      emailsScanned: (data as any).emails_scanned,
      transactionsFound: (data as any).transactions_found,
    }
  },
}
