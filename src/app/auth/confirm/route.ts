'use server'

import { type EmailOtpType } from '@supabase/supabase-js'
import { type NextRequest } from 'next/server'

import { createSupabaseServerClient } from '@/lib/utils/supabase/server'
import { logger } from '@/lib/server_utilities'
import { redirect } from 'next/navigation'
import { sanitizeRedirectPath } from '@/lib/utils/sanitizeRedirectPath'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null
  const next = sanitizeRedirectPath(searchParams.get('next') ?? '/', origin)

  if (token_hash && type) {
    // Recovery is special: PASSWORD_RECOVERY only fires on the client that
    // *itself* calls verifyOtp (the JWT carries amr.method='otp' with no
    // recovery marker, so a cookie-hydrated client sees SIGNED_IN instead).
    // Forward the token to /reset-password and let the form's useEffect
    // call verifyOtp client-side; the event then fires on the browser
    // client and trips the form's existing gate.
    if (type === 'recovery') {
      const params = new URLSearchParams({ token_hash, type })
      redirect(`${next}?${params.toString()}`)
    }

    const supabase = await createSupabaseServerClient()

    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash,
    })
    if (!error) {
      // redirect user to specified redirect URL or root of app
      redirect(next)
    } else {
      logger.error('OTP verification error', { error: error.message })
    }
  }

  // redirect the user to an error page with some instructions
  redirect('/error')
}