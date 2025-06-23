import { type EmailOtpType } from '@supabase/supabase-js'
import { type NextRequest } from 'next/server'

import { createClient } from '@/lib/utils/supabase/server'
import { redirect } from 'next/navigation'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null
  const next = searchParams.get('next') ?? '/'

  console.log('Auth confirm hit:', { token_hash: !!token_hash, type, next })

  if (token_hash && type) {
    const supabase = await createClient()

    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash,
    })
    if (!error) {
      // redirect user to specified redirect URL or root of app
      console.log('OTP verification successful, redirecting to:', next)
      redirect(next)
    } else {
      console.error('OTP verification error:', error)
    }
  } else {
    console.log('Missing token_hash or type')
  }

  // redirect the user to an error page with some instructions
  console.log('Redirecting to error page')
  redirect('/error')
}